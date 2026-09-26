"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ResumeContent } from "@intro-builder/shared/schemas";
import type { SemanticOperation } from "@intro-builder/shared/schemas";
import { hashValue } from "@intro-builder/shared/utils";

import { buildMutationOperations } from "@/lib/resume-mutations/editor-adapter";

/**
 * 编辑器写会话：把「表单内容」变成「受 revision 保护的提交」。
 *
 * 这一层解决 P03 的核心问题 —— **本地输入状态与已保存正文是两个东西**：
 *
 * - RHF 始终是输入的唯一真相；本 hook **从不** `form.reset()`。
 *   收到回执时只推进「已确认基准（baseline + revision）」，因此回执到达前用户
 *   继续输入的字符、改过的标题、换过的模板都不会被擦掉。
 * - 每次提交由「baseline → 当前表单」的差量算出语义命令，带稳定 `mutationId`
 *   与 `expectedRevision`。重试复用同一个 ID 与同一份 payload，服务端据此幂等重放。
 * - 冲突时**保留**本地 dirty 内容并暂停覆盖式重试；由调用方决定显式解决方式。
 *
 * 为什么不复用 `use-resume-autosave`：那套接口是 `onSave(content, title)`，
 * 整份内容覆盖写，天然没有并发保护，也无法表达「这次改的是哪几个字段」。
 * 它保留给尚未切换的路径；编辑器走本模块。
 */

export type MutationSessionBaseline = {
  content: ResumeContent;
  revision: number;
  title: string;
  templateId: string;
};

/** 提交来源。取值与提交模块的 `CommitPrincipal["source"]` 对齐。 */
export type MutationSource =
  | "manual"
  | "collab"
  | "agent"
  | "polish"
  | "restore"
  | "template"
  | "style";

export type MutationSessionStatus =
  | "idle"
  | "pending"
  | "saving"
  /** 服务端明确拒绝（非法命令、越权等），需要用户干预。 */
  | "rejected"
  /** revision 或前置条件冲突：本地内容保留，未保存。 */
  | "conflict"
  /** 网络/未知错误，可重试。 */
  | "error";

export type CommitSubmission = {
  mutationId: string;
  expectedRevision: number;
  operations: SemanticOperation[];
  /** 来源（由调用方或 setNextSource 标注）。服务端仍会校验并决定 actor。 */
  source?: MutationSource;
};

/** 服务端提交结果，与 CommitOutcome 对齐但只保留客户端需要的部分。 */
export type SubmitAccepted = {
  status: "committed";
  revision: number;
  /** 服务端生成的修订快照 ID；用于把这次修改关联到历史记录。 */
  versionId?: string;
  /** 服务端实际落盘的正文。缺省时调用方退回使用本地快照。 */
  nextContent?: unknown;
  /**
   * 本次提交的幂等键。
   *
   * 必须回传：撤销要用它作为 `undoOf`（条件撤销的「撤销谁」），
   * 而它只存在于服务端回执里 —— 客户端自己生成的那个只用于本次请求，
   * 服务端可能因幂等而复用别的值。
   */
  mutationId?: string;
};

export type SubmitResult =
  | SubmitAccepted
  | { status: "conflict"; currentRevision: number }
  | { status: "rejected"; code: string }
  | { status: "no_change"; currentRevision: number };

export type UseResumeMutationSessionOptions = {
  initial: MutationSessionBaseline;
  /** 读取当前表单内容（RHF 的 getValues）。 */
  getContent: () => ResumeContent;
  /** 读取当前行的 title / templateId。 */
  getRow: () => { title: string; templateId: string };
  /** 真正提交。由调用方接到 Server Action。 */
  submit: (submission: CommitSubmission) => Promise<SubmitResult>;
  debounceMs?: number;
  newMutationId?: () => string;
  /** 生成操作 ID 的能力；注入以便测试稳定。 */
  newOpId?: () => string;
  /**
   * 换模板时读取该模板的默认排版（用于重置）。
   *
   * 做成回调是因为本 hook 不认识模板注册表（那是服务端资源）。
   * 返回 `null` 表示「只换模板、保留用户调好的排版」。
   */
  resolveTemplateStyle?: (templateId: string) => Record<string, unknown> | null;
};

export type MutationSession = {
  status: MutationSessionStatus;
  revision: number;
  /** 已确认基准；供需要「服务端已落盘内容」的调用方读取。 */
  getBaseline: () => MutationSessionBaseline;
  /** 标记有本地改动，安排一次提交（去抖）。 */
  schedule: () => void;
  /** 立刻提交并把在途请求等到真实回执。冲突时 reject。 */
  flush: () => Promise<void>;
  /** 最近一次冲突的当前 revision；无冲突时为 null。 */
  conflictRevision: number | null;
  /** 用服务端最新内容重置基准后重试（显式解决冲突）。 */
  rebase: (baseline: MutationSessionBaseline) => void;
  /** 清掉冲突标记，允许重新尝试（保持本地输入）。 */
  clearConflict: () => void;
  /** 服务端（例如 Agent）已落盘一次提交：推进基准并同步表单。 */
  applyRemoteCommit: (next: {
    content: ResumeContent;
    revision: number;
    /** 把内容写进表单；仅在本地无 dirty 改动时会被调用。 */
    applyContent: (content: ResumeContent) => void;
  }) => void;
  /** 最近一次错误，供 UI 展示。 */
  lastError: unknown;
  /**
   * 声明**下一次**提交的来源（默认 manual）。
   *
   * 用途：协作同步通过 `form.setValue` 把远端改动写进表单，形式上与用户自己输入
   * 无法区分。若不额外标注，这些改动会被记成「个人本地输入」——留痕里就会出现
   * 「是 owner 手打的」这种错误归因。协作方在应用远端改动前调用本方法，
   * 提交层就会用 `collab` 来源记录。
   *
   * 只影响紧随其后的一次提交，避免一次标注长期生效把它之后的真实手动输入也误标。
   */
  setNextSource: (source: MutationSource) => void;
  /**
   * 成功提交的次数（含 no_change）。
   *
   * UI 用它区分「从未保存过」与「刚保存完」：status 回到 idle 也可能是
   * 「本来就没事要存」，不能据此宣布「已保存」。
   */
  committedCount: number;
  /**
   * 读取最近一次**真正落盘**的回执（revision + versionId）。
   *
   * 刻意做成同步访问器而不是 React state：调用方是「await flush() 之后立刻要
   * 用这次提交的回执」（例如 Agent 应用后打开差异视图），而 `setState` 触发的
   * 重渲染发生在 await 返回之后 —— 那一刻通过 state/ref 读到的仍是旧值，
   * 回执会永远是 null，功能静默失效。因此这里用 ref 保存、同步读取。
   *
   * 没有回执时返回 null；调用方不得据此伪造版本 id。
   */
  getLastReceipt: () => MutationReceipt | null;
};

export type MutationReceipt = {
  revision: number;
  versionId: string;
  committedAt: string;
  /**
   * 服务端回执里的幂等键。
   *
   * 撤销链路（`resume-mutations/undo.ts` 的 `buildUndoCommand`）需要它作为
   * `undoOf`。此前这个类型只有三个字段，导致撤销**拿不到要撤销哪一次提交** ——
   * 条件撤销链路因此断在这里。
   */
  mutationId: string;
};

const FLUSH_TIMEOUT_MS = 30_000;

export function useResumeMutationSession(
  options: UseResumeMutationSessionOptions,
): MutationSession {
  const {
    initial,
    getContent,
    getRow,
    submit,
    debounceMs = 2000,
    newMutationId = defaultMutationId,
    newOpId = defaultOpId,
    resolveTemplateStyle,
  } = options;

  const baselineRef = useRef<MutationSessionBaseline>(initial);
  const [revision, setRevision] = useState(initial.revision);
  const [status, setStatus] = useState<MutationSessionStatus>("idle");
  const [conflictRevision, setConflictRevision] = useState<number | null>(null);
  const [lastError, setLastError] = useState<unknown>(null);
  const [committedCount, setCommittedCount] = useState(0);
  /** 同步可读的回执（见 getLastReceipt 的说明）。 */
  const lastReceiptRef = useRef<MutationReceipt | null>(null);
  /** 下一次提交的来源；消费一次后复位为 manual。 */
  const nextSourceRef = useRef<MutationSource>("manual");

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const pendingFlushRef = useRef<Array<{ resolve: () => void; reject: (e: unknown) => void }>>([]);
  /**
   * 上一次发送的请求。
   *
   * 重试必须复用**同一个 mutationId 和同一份 payload**。只复用 ID 是不够的：
   * 每次重试都会重新生成 operation id，服务端算出的 requestHash 就会变，
   * 于是「同 ID 同 payload」的幂等判定失败，重试被当成「同 ID 异 payload」拒绝
   * （或更糟：被当成新请求重复改文档）。因此这里把整份 operations 原样留下。
   */
  const lastAttemptRef = useRef<{
    mutationId: string;
    semanticHash: string;
    operations: SemanticOperation[];
  } | null>(null);
  const saveAgainRef = useRef(false);
  const dirtyRef = useRef(false);
  /**
   * 本地改动代数。收到回执时用它判断「发送之后用户是否又改过」——
   * 判定的目的不是去 reset 表单（我们从不这么做），而是决定要不要立刻再存一次。
   */
  const localGenerationRef = useRef(0);
  const unmountedRef = useRef(false);
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * 推进「已确认基准」。
   *
   * 这里统一做快照，是为了让**所有**调用点都安全：只要有人不小心把表单的活引用
   * 传进来，也不会让基准随用户后续输入漂移。
   */
  const setBaseline = useCallback((next: MutationSessionBaseline) => {
    baselineRef.current = { ...next, content: snapshotContent(next.content) };
    setRevision(next.revision);
  }, []);

  const resolveFlush = useCallback(() => {
    const waiters = pendingFlushRef.current;
    pendingFlushRef.current = [];
    if (flushTimeoutRef.current) {
      clearTimeout(flushTimeoutRef.current);
      flushTimeoutRef.current = null;
    }
    for (const waiter of waiters) waiter.resolve();
  }, []);

  const rejectFlush = useCallback((error: unknown) => {
    const waiters = pendingFlushRef.current;
    pendingFlushRef.current = [];
    if (flushTimeoutRef.current) {
      clearTimeout(flushTimeoutRef.current);
      flushTimeoutRef.current = null;
    }
    for (const waiter of waiters) waiter.reject(error);
  }, []);

  const clearDebounce = useCallback(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
  }, []);

  /**
   * 一次提交尝试。
   *
   * 关键点：发送前**重新**从表单取值算差量，因此「在途期间的新编辑」会被算进
   * 下一次提交，而不是被这次回执抹掉。
   */
  const persist = useCallback(async () => {
    if (inFlightRef.current) {
      saveAgainRef.current = true;
      return;
    }

    const baseline = baselineRef.current;
    const row = getRow();
    // 换模板时把该模板的默认排版一并带上，让「切模板 = 切排版」的心智模型成立
    // （旧 setTemplate 默认重置；此前统一提交路径硬编码 false 导致该行为静默失效）。
    const styleReset =
      row.templateId !== baseline.templateId && resolveTemplateStyle
        ? (() => {
            const style = resolveTemplateStyle(row.templateId);
            return style ? { templateId: row.templateId, style } : null;
          })()
        : null;

    const diff = buildMutationOperations({
      baseline: baseline.content,
      next: getContent(),
      newOpId,
      baselineRow: { title: baseline.title, templateId: baseline.templateId },
      nextRow: { title: row.title, templateId: row.templateId },
      templateStyleReset: styleReset,
    });

    if (!diff.ok) {
      // 缺少稳定身份或结构异常：这是需要用户刷新/初始化的问题，
      // 不能靠重试解决。保留本地输入，交给 UI 提示。
      dirtyRef.current = true;
      setStatus("rejected");
      setLastError(new Error(diff.message));
      rejectFlush(new Error(diff.message));
      return;
    }

    if (diff.operations.length === 0) {
      dirtyRef.current = false;
      setStatus("idle");
      resolveFlush();
      return;
    }

    /*
     * 幂等：与上一次**语义相同**的请求必须复用同一个 mutationId 和同一份 payload。
     *
     * 语义哈希刻意剔除 operation id —— id 每次生成都不同，把它算进去会让
     * 「内容没变的重试」被判成新请求。
     */
    const semanticHash = hashValue({
      expectedRevision: baseline.revision,
      operations: stripOperationIds(diff.operations),
    });
    const reuse = lastAttemptRef.current?.semanticHash === semanticHash ? lastAttemptRef.current : null;
    const mutationId = reuse?.mutationId ?? newMutationId();
    /** 复用时就原样重发上次的 operations，保证 payload 逐字节相同。 */
    const operations = reuse?.operations ?? diff.operations;
    lastAttemptRef.current = { mutationId, semanticHash, operations };

    const sentGeneration = localGenerationRef.current;
    /**
     * 发送瞬间的表单**快照**。
     *
     * 必须深拷贝：`form.getValues()` 返回的是 RHF 表单状态对象本身的引用，
     * 后续 `setValue` 会把它一起改掉。若直接存引用，「已确认基准」会跟着用户
     * 之后的输入一起变，于是 diff 恒为空、编辑永远提交不上去
     * —— 表现为「一直在保存中，但内容没落盘」。
     */
    const sentContent = snapshotContent(getContent());

    inFlightRef.current = true;
    setStatus("saving");
    try {
      // 消费来源标注：只对紧随其后的一次提交生效。
      const source = nextSourceRef.current;
      nextSourceRef.current = "manual";
      const result = await submit({
        mutationId,
        expectedRevision: baseline.revision,
        operations,
        source,
      });
      if (unmountedRef.current) return;

      if (result.status === "conflict") {
        // 保留本地 dirty 内容，暂停覆盖式重试，等用户/页面显式解决。
        dirtyRef.current = true;
        setStatus("conflict");
        setConflictRevision(result.currentRevision);
        rejectFlush(new MutationConflictError(result.currentRevision));
        return;
      }
      if (result.status === "rejected") {
        dirtyRef.current = true;
        setStatus("rejected");
        setLastError(new Error(result.code));
        rejectFlush(new Error(result.code));
        return;
      }

      // 成功（含 no_change）：推进已确认基准。**不动表单。**
      const nextContent =
        result.status === "committed" && result.nextContent
          ? (result.nextContent as ResumeContent)
          : sentContent;
      const committedRow = getRow();
      setBaseline({
        content: nextContent,
        revision: result.status === "committed" ? result.revision : result.currentRevision,
        title: committedRow.title,
        templateId: committedRow.templateId,
      });
      lastAttemptRef.current = null;
      setConflictRevision(null);
      setLastError(null);
      setCommittedCount((count) => count + 1);
      if (result.status === "committed" && result.versionId) {
        lastReceiptRef.current = {
          revision: result.revision,
          versionId: result.versionId,
          committedAt: new Date().toISOString(),
          // 服务端回执里的键优先；缺省时退回本次请求用的键（服务端会做幂等校验）。
          mutationId: result.mutationId ?? mutationId,
        };
      }

      const changedSinceSend = localGenerationRef.current !== sentGeneration;
      if (changedSinceSend) {
        // 用户在这次在途期间又改了：保留其输入，立刻再存一次。
        dirtyRef.current = true;
        saveAgainRef.current = true;
        setStatus("pending");
      } else {
        dirtyRef.current = false;
        setStatus("idle");
        resolveFlush();
      }
    } catch (error) {
      if (unmountedRef.current) return;
      dirtyRef.current = true;
      setStatus("error");
      setLastError(error);
      rejectFlush(error);
    } finally {
      inFlightRef.current = false;
      if (saveAgainRef.current && !unmountedRef.current) {
        saveAgainRef.current = false;
        void persistRef.current?.();
      }
    }
  }, [
    getContent,
    getRow,
    newMutationId,
    newOpId,
    rejectFlush,
    resolveFlush,
    resolveTemplateStyle,
    setBaseline,
    submit,
  ]);

  const persistRef = useRef<typeof persist | undefined>(undefined);
  useEffect(() => {
    persistRef.current = persist;
  }, [persist]);

  const schedule = useCallback(() => {
    localGenerationRef.current += 1;
    dirtyRef.current = true;
    setStatus((current) => (current === "conflict" ? current : "pending"));
    clearDebounce();
    const generation = localGenerationRef.current;
    debounceTimer.current = setTimeout(() => {
      // 去抖窗口内又有输入时，让最后一次触发去真正提交。
      if (generation !== localGenerationRef.current) return;
      void persistRef.current?.();
    }, debounceMs);
  }, [clearDebounce, debounceMs]);

  const flush = useCallback(() => {
    clearDebounce();
    if (!dirtyRef.current && !inFlightRef.current && !saveAgainRef.current) {
      return Promise.resolve();
    }
    const result = new Promise<void>((resolve, reject) => {
      pendingFlushRef.current.push({ resolve, reject });
      // 兜底：网络卡住时不能让调用方永久等待。
      if (!flushTimeoutRef.current) {
        flushTimeoutRef.current = setTimeout(() => {
          rejectFlush(new Error("保存超时，请稍后重试"));
        }, FLUSH_TIMEOUT_MS);
      }
    });
    void persistRef.current?.();
    return result;
  }, [clearDebounce, rejectFlush]);

  const rebase = useCallback(
    (next: MutationSessionBaseline) => {
      setBaseline({ ...next, content: snapshotContent(next.content) });
      setConflictRevision(null);
      lastAttemptRef.current = null;
      setStatus("pending");
      // 基准换了，本地输入仍然保留；立刻尝试把它存下去。
      void persistRef.current?.();
    },
    [setBaseline],
  );

  const clearConflict = useCallback(() => {
    setConflictRevision(null);
    setStatus((current) => (current === "conflict" ? "pending" : current));
  }, []);

  const applyRemoteCommit = useCallback(
    (next: { content: ResumeContent; revision: number; applyContent: (content: ResumeContent) => void }) => {
      const hadLocalEdits = dirtyRef.current || inFlightRef.current;
      setBaseline({
        content: snapshotContent(next.content),
        revision: next.revision,
        title: baselineRef.current.title,
        templateId: baselineRef.current.templateId,
      });
      if (!hadLocalEdits) {
        // 本地没有未保存输入：可以安全地把服务端内容写进表单。
        next.applyContent(next.content);
        localGenerationRef.current += 1;
      }
      // 有本地输入时**不动表单**：那些输入比新基准更新，不能被覆盖。
    },
    [setBaseline],
  );

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      clearDebounce();
      if (flushTimeoutRef.current) clearTimeout(flushTimeoutRef.current);
    };
  }, [clearDebounce]);

  return {
    status,
    revision,
    getBaseline: () => baselineRef.current,
    schedule,
    flush,
    conflictRevision,
    rebase,
    clearConflict,
    applyRemoteCommit,
    lastError,
    committedCount,
    getLastReceipt: () => lastReceiptRef.current,
    setNextSource: (source: MutationSource) => {
      nextSourceRef.current = source;
    },
  };
}

export class MutationConflictError extends Error {
  readonly currentRevision: number;
  constructor(currentRevision: number) {
    super("内容已在别处更新，请刷新或比较后再保存");
    this.name = "MutationConflictError";
    this.currentRevision = currentRevision;
  }
}

/**
 * 剔除 operation id 后的稳定视图，用于判断「这次要提交的内容是否与上次相同」。
 *
 * 注意只剔除顶层 `id`，保留 `target` / `condition` / `value`：
 * 条件哈希变了就代表目标已变，那本来就该算新请求。
 */
function stripOperationIds(operations: SemanticOperation[]): unknown[] {
  return operations.map((operation) => {
    const copy: Record<string, unknown> = { ...(operation as unknown as Record<string, unknown>) };
    delete copy.id;
    return copy;
  });
}

/**
 * 深拷贝表单内容，用于「已确认基准」与「发送瞬间快照」。
 *
 * RHF 的 `getValues()` 返回活引用；把它当快照用会造成基准随输入漂移。
 * 内容全是 JSON 可序列化的（jsonb 列），因此用结构化克隆即可；
 * 环境不支持时退回 JSON 往返（本模块只处理纯数据）。
 */
function snapshotContent(content: ResumeContent): ResumeContent {
  const clone = (globalThis as { structuredClone?: <T>(value: T) => T }).structuredClone;
  if (clone) return clone(content);
  return JSON.parse(JSON.stringify(content)) as ResumeContent;
}

function defaultOpId(): string {
  return defaultMutationId().replace("mut_", "op_");
}

function defaultMutationId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) return `mut_${cryptoApi.randomUUID()}`;
  return `mut_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}
