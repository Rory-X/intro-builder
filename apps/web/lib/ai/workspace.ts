import type { ResumeContent, SemanticOperation, Target } from "@intro-builder/shared/schemas";
import { ARRAY_SECTION_KEYS, hashTargetValue } from "@intro-builder/shared/schemas";

import { findItemIndexById, readItemIds } from "../resume-mutations/identity";
import { tiptapPlainText } from "../agent/resume-helper-context";

/**
 * 完整简历**工作副本**（P04 任务 3）。
 *
 * 修的是规格里的 F02：旧链路一部分工具读「空 Draft」、一部分读「旧摘要」，
 * 于是模型会基于互相矛盾的状态推理，产出无效的建议或错误的写入目标。
 *
 * 工作副本的定义：
 * - **基准**来自服务端权威内容（owner 校验后的数据库内容），不是前端传上来的副本；
 * - **本轮已暂存的修改**叠加在基准之上，因此「先新增一条经历、再改它的标题」
 *   在同一个 Run 内能读到刚新增的条目（旧实现读不到，会报「目标不存在」）；
 * - 按**稳定 ID** 读写，不按下标；
 * - 提供「按需读取」，不再把整份简历截断后声称全量可见。
 *
 * 本模块是纯计算（无 I/O），因此可以被确定性测试穷举。
 */

export type WorkspaceSource = {
  /** 服务端权威内容。 */
  content: ResumeContent;
  /** 该内容的 revision，写入时作为 CAS 条件。 */
  revision: number;
  /** 行的列。 */
  title: string;
  templateId: string;
};

/** 已暂存的修改：一个操作 + 它被应用后的内容。 */
export type StagedChange = {
  operationId: string;
  kind: SemanticOperation["kind"];
  /** 应用该操作后的完整内容快照（便于逐步回溯）。 */
  contentAfter: ResumeContent;
  summary: string;
};

export type WorkspaceSnapshot = {
  /** 基准内容（未含暂存修改）。 */
  base: ResumeContent;
  /** 含暂存修改的当前工作内容。 */
  current: ResumeContent;
  revision: number;
  title: string;
  templateId: string;
  changes: StagedChange[];
};

export function createWorkspace(source: WorkspaceSource): WorkspaceSnapshot {
  return {
    // 深拷贝，避免外部对象后续被改动而让工作副本漂移。
    base: clone(source.content),
    current: clone(source.content),
    revision: source.revision,
    title: source.title,
    templateId: source.templateId,
    changes: [],
  };
}

function clone<T>(value: T): T {
  const structured = (globalThis as { structuredClone?: <V>(v: V) => V }).structuredClone;
  if (structured) return structured(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * 暂存一次修改。
 *
 * 调用方必须已经用 `prepare` 校验过前置条件并算出新内容 ——
 * 工作副本只负责「记住本轮改了什么」，不重复实现校验逻辑。
 */
export function stageChange(
  workspace: WorkspaceSnapshot,
  change: { operationId: string; kind: SemanticOperation["kind"]; nextContent: ResumeContent; summary: string },
): WorkspaceSnapshot {
  const contentAfter = clone(change.nextContent);
  return {
    ...workspace,
    current: contentAfter,
    changes: [
      ...workspace.changes,
      {
        operationId: change.operationId,
        kind: change.kind,
        contentAfter,
        summary: change.summary,
      },
    ],
  };
}

/**
 * 已提交后的推进：把工作内容提升为新的基准。
 *
 * 直接模式在收到**服务端回执**后调用；未收到回执时不得调用
 * （那会把「以为写成功了」变成新的基准，后续修改全都基于幻觉状态）。
 */
export function promoteToBase(
  workspace: WorkspaceSnapshot,
  committed: { content: ResumeContent; revision: number; title?: string; templateId?: string },
): WorkspaceSnapshot {
  const base = clone(committed.content);
  return {
    base,
    current: clone(base),
    revision: committed.revision,
    title: committed.title ?? workspace.title,
    templateId: committed.templateId ?? workspace.templateId,
    // 已提交的改动不再是「暂存」。
    changes: [],
  };
}

// ─── 按需读取 ────────────────────────────────────────────────

export type SectionSummary = {
  section: string;
  label: string;
  /** 条目数（数组区块）或是否为空（单例区块）。 */
  itemCount: number | null;
  isEmpty: boolean;
  /** 每个条目的稳定 ID 与一行摘要，供模型判断该读哪一条。 */
  items: Array<{ itemId: string; preview: string }>;
};

const SECTION_LABELS: Record<string, string> = {
  basics: "基础信息",
  summary: "个人总结",
  skills: "专业技能",
  awards: "荣誉奖项",
  portfolio: "作品集",
  experience: "工作/实习经历",
  projects: "项目经历",
  education: "教育经历",
  research: "研究经历",
  custom: "自定义模块",
};

/**
 * 目录：列出有哪些区块、各有多少条目。
 *
 * 长简历先给目录再按需读目标 —— 不再把截断后的文本宣称成整份简历（规格 F08）。
 */
export function describeSections(workspace: WorkspaceSnapshot): SectionSummary[] {
  const content = workspace.current;
  const sections: SectionSummary[] = [];

  for (const [key, label] of Object.entries(SECTION_LABELS)) {
    if (key === "custom") {
      for (const item of content.custom) {
        sections.push({
          section: `custom:${item.id}`,
          label: item.title || "自定义模块",
          itemCount: null,
          isEmpty: isDocEmpty(item.content),
          items: [],
        });
      }
      continue;
    }

    if (key === "basics") {
      const basics = content.basics;
      const filled = Object.entries(basics).filter(([, value]) => String(value ?? "").trim().length > 0);
      sections.push({
        section: key,
        label,
        itemCount: filled.length,
        isEmpty: filled.length === 0,
        items: [],
      });
      continue;
    }

    if (key in content && Array.isArray((content as unknown as Record<string, unknown>)[key])) {
      const items = (content as unknown as Record<string, Array<Record<string, unknown>>>)[key];
      sections.push({
        section: key,
        label,
        itemCount: items.length,
        isEmpty: items.length === 0,
        items: items.map((item) => {
          const itemId = typeof item.id === "string" ? item.id : "";
          return { itemId, preview: previewOfItem(key, item) };
        }),
      });
      continue;
    }

    const doc = (content as unknown as Record<string, unknown>)[key];
    sections.push({
      section: key,
      label,
      itemCount: null,
      isEmpty: isDocEmpty(doc),
      items: [],
    });
  }

  return sections;
}

function previewOfItem(section: string, item: Record<string, unknown>): string {
  const parts: string[] = [];
  const pick = (field: string) => {
    const value = item[field];
    return typeof value === "string" ? value.trim() : "";
  };
  switch (section) {
    case "experience":
      parts.push(pick("company"), pick("title"));
      break;
    case "projects":
      parts.push(pick("name"), pick("role"));
      break;
    case "education":
      parts.push(pick("school"), pick("degree"), pick("major"));
      break;
    case "research":
      parts.push(pick("name"), pick("role"));
      break;
    default:
      break;
  }
  const head = parts.filter(Boolean).join(" · ");
  const richText = section === "education" ? item.highlights : item.content;
  const body = docText(richText);
  return [head, body].filter(Boolean).join(" — ").slice(0, 120);
}

function docText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  try {
    return tiptapPlainText(value as never).replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

function isDocEmpty(value: unknown): boolean {
  return docText(value).length === 0;
}

export type SectionRead =
  | { ok: true; section: string; itemId?: string; fields: Record<string, unknown> }
  | { ok: false; reason: "not_found"; message: string };

/**
 * 读取某个区块（或某一条目）的完整字段。
 *
 * 目标缺失时明确报错，**不回退到「最近似的条目」**：那会让模型基于错误对象做判断。
 */
export function readSection(
  workspace: WorkspaceSnapshot,
  input: { section: string; itemId?: string },
): SectionRead {
  const { section, itemId } = input;
  const content = workspace.current as unknown as Record<string, unknown>;

  if (section.startsWith("custom:")) {
    const customId = section.slice("custom:".length);
    const item = workspace.current.custom.find((entry) => entry.id === customId);
    if (!item) {
      return { ok: false, reason: "not_found", message: `找不到自定义模块 ${customId}` };
    }
    return { ok: true, section, itemId: customId, fields: item as unknown as Record<string, unknown> };
  }

  if (itemId !== undefined) {
    if (!(ARRAY_SECTION_KEYS as readonly string[]).includes(section)) {
      return { ok: false, reason: "not_found", message: `${section} 不是条目型区块` };
    }
    const index = findItemIndexById(workspace.current, section as never, itemId);
    if (index < 0) {
      return { ok: false, reason: "not_found", message: `找不到条目 ${itemId}` };
    }
    const items = content[section] as Array<Record<string, unknown>>;
    return { ok: true, section, itemId, fields: items[index] };
  }

  const value = content[section];
  if (value === undefined) {
    return { ok: false, reason: "not_found", message: `找不到区块 ${section}` };
  }
  return { ok: true, section, fields: value as Record<string, unknown> };
}

/** 所有条目的稳定 ID。用于校验「重排集合一致」与「删除后不能再改」。 */
export function allItemIds(workspace: WorkspaceSnapshot): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const section of ARRAY_SECTION_KEYS) {
    out[section] = readItemIds(workspace.current, section).filter(
      (id): id is string => id !== null,
    );
  }
  return out;
}

/**
 * 目标当前值的条件哈希。
 *
 * 模型**不能**自己提供条件哈希（它会编造），必须由服务端从工作副本重算。
 * 这是「提案携带真实前置条件」的关键一步。
 */
export function conditionHashFor(workspace: WorkspaceSnapshot, target: Target): string | null {
  const read = readSection(workspace, { section: target.section, itemId: target.itemId });
  if (!read.ok) return null;
  if (target.field === undefined) return hashTargetValue(read.fields);
  return hashTargetValue(read.fields[target.field]);
}

/**
 * 完整性评分。
 *
 * 刻意只是**启发式**：调用方必须向用户说明它是估算，不能把它当成事实。
 * 旧实现把它当权威指标展示（规格 F08：「检查工具为启发式」）。
 */
export function estimateCompleteness(workspace: WorkspaceSnapshot): {
  overall: number;
  sections: Array<{ key: string; label: string; filled: boolean }>;
  /** 明确标注这是估算，不是测量。 */
  disclaimer: string;
} {
  const sections = describeSections(workspace).map((summary) => ({
    key: summary.section,
    label: summary.label,
    filled: !summary.isEmpty && (summary.itemCount ?? 1) > 0,
  }));
  const filledCount = sections.filter((s) => s.filled).length;
  const overall = sections.length === 0 ? 0 : Math.round((filledCount / sections.length) * 100);
  return {
    overall,
    sections,
    disclaimer: "完整性为按区块是否填写估算，不代表内容质量或与目标岗位的匹配程度。",
  };
}
