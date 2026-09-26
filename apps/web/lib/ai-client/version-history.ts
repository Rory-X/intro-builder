/**
 * 版本历史的聚合投影（P06 任务 5）。
 *
 * plan 要求「列表**按任务聚合**，展开看各 revision 和 source；
 * **单条记录能回到 task/run**」。
 *
 * ## 现状与缺口
 *
 * 数据库里 `resume_version` 已经有全部所需字段（`runId` / `changeSetId` /
 * `mutationId` / `revision` / `source` / `sourceDetail`，见迁移 0014），
 * 但**读取层没有把它们取出来** —— 既有的 `ResumeVersionListItem` 只有
 * id/source/actor/summary/createdAt，因此 UI 无法聚合、也无法跳回任务。
 *
 * 本模块做两件事：
 * 1. 定义**完整的**读取条目类型（含聚合与跳转所需字段）；
 * 2. 把扁平列表投影成「按任务聚合」的分组结构。
 *
 * ## 一个必须守住的区分
 *
 * 「一次 Agent 任务」与「一次版本」不是一对一：一次任务可能产生多个版本
 * （多个工具各自提交一次）。因此聚合的键是 `runId`，而不是版本 id。
 * 没有 `runId` 的版本（手动编辑、模板切换）各自成组 —— 它们不属于任何任务。
 */

/** 版本来源。与 `CommitPrincipal.source` 的封闭集合一致。 */
export type VersionSource =
  | "manual"
  | "agent"
  | "polish"
  | "restore"
  | "template"
  | "style"
  | "system"
  | "collab"
  | "undo";

/** 读取层的完整版本条目。 */
export type VersionRecord = {
  id: string;
  resumeId: string;
  source: VersionSource;
  actorName: string;
  operationCount: number;
  summary: string | null;
  createdAt: string;
  /** 该版本对应的 revision（留痕核对用）。 */
  revision: number | null;
  /** 归属的 Run。为 null 表示不属于任何 Agent 任务。 */
  runId: string | null;
  /** 归属的提案。 */
  changeSetId: string | null;
  /** 产生它的提交（幂等键）。 */
  mutationId: string | null;
  /** 若这是一次撤销，指向被撤销的版本。 */
  undoOf?: string | null;
};

/** 来源的中文说明。 */
const SOURCE_LABELS: Record<VersionSource, string> = {
  manual: "手动编辑",
  agent: "简历助手",
  polish: "AI 润色",
  restore: "恢复历史版本",
  template: "更换模板",
  style: "调整排版",
  system: "系统操作",
  collab: "协作编辑",
  // 撤销本身是一个来源：用户需要能区分「我改了」与「我撤销了某次改动」。
  undo: "撤销",
};

export function sourceLabel(source: VersionSource): string {
  return SOURCE_LABELS[source] ?? "修改";
}

/** 聚合出的一组（一个任务，或一次独立修改）。 */
export type VersionGroup = {
  /** 组键：`runId`，或独立记录的版本 id。 */
  id: string;
  /**
   * 组的类型。
   *
   * `task` 表示这是一次 Agent 任务（可能含多个版本）；
   * `single` 表示一次独立修改（手动编辑 / 模板切换等）。
   */
  kind: "task" | "single";
  /** 组内版本，按时间**倒序**（最新在前，与列表直觉一致）。 */
  versions: VersionRecord[];
  /** 该组涉及的全部 source（展开时展示「各 revision 和 source」）。 */
  sources: VersionSource[];
  /** 该组最新的时间（用于组间排序）。 */
  createdAt: string;
  /** 组内版本数。 */
  count: number;
  /** 是否含撤销记录（UI 据此标注，避免用户以为内容被改了）。 */
  hasUndo: boolean;
  /** 是否能跳回任务/运行（有 runId 才可跳）。 */
  canOpenRun: boolean;
};

/**
 * 把扁平版本列表聚合成按任务分组的列表。
 *
 * 排序规则：组间按「组内最新时间」倒序；组内按时间倒序。
 *
 * **不合并不同 resume 的记录**：`resumeId` 不同的版本即使有相同 runId
 * 也不该并成一组（虽然当前 schema 下不会发生，但依赖这一点是脆弱的 ——
 * 显式按 `resumeId + runId` 分组更安全）。
 */
export function groupVersionsByTask(records: readonly VersionRecord[]): VersionGroup[] {
  const groups = new Map<string, VersionRecord[]>();

  for (const record of records) {
    /*
     * 组键刻意含 resumeId：不同简历上恰好同名的 runId 不该被并成一组。
     * 用 `\u0000` 分隔避免拼接歧义（例如 resumeId="a" + runId="b:c"
     * 与 resumeId="a:b" + runId="c" 会撞键）。
     */
    const key = record.runId
      ? `task\u0000${record.resumeId}\u0000${record.runId}`
      : `single\u0000${record.id}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(record);
    else groups.set(key, [record]);
  }

  const result: VersionGroup[] = [];
  for (const [key, bucket] of groups) {
    const sorted = [...bucket].sort((a, b) => compareDesc(a.createdAt, b.createdAt));
    const sources = [...new Set(sorted.map((record) => record.source))];
    /*
     * 组 id 刻意从**记录**取（runId 或版本 id），而不是从拼接后的键切出来。
     *
     * 第一版用 `key.split("\u0000").slice(1).join(...)`，结果把 resumeId 也
     * 带进了 id（`resume-1\u0000run-new`）—— 组 id 是 UI 的 React key 与
     * 「跳回任务」的入参，混入 resumeId 会让所有下游使用者多剥一层。
     * 从记录取没有这个问题，且与键的构造方式解耦。
     */
    const first = sorted[0];
    result.push({
      id: first.runId ?? first.id,
      kind: key.startsWith("task\u0000") ? "task" : "single",
      versions: sorted,
      sources,
      createdAt: sorted[0].createdAt,
      count: sorted.length,
      hasUndo: sorted.some((record) => record.source === "undo"),
      canOpenRun: sorted.some((record) => record.runId !== null),
    });
  }

  return result.sort((a, b) => compareDesc(a.createdAt, b.createdAt));
}

/** 时间倒序比较。无法解析的时间排在后面（不抛异常 —— 这是展示路径）。 */
function compareDesc(a: string, b: string): number {
  const left = Date.parse(a);
  const right = Date.parse(b);
  if (Number.isNaN(left) && Number.isNaN(right)) return 0;
  if (Number.isNaN(left)) return 1;
  if (Number.isNaN(right)) return -1;
  return right - left;
}

/**
 * 找到某条版本的「直接前驱」——撤销的目标。
 *
 * plan 要求「撤销调用服务端**条件** undo」。条件撤销需要知道「撤销到什么」，
 * 而答案不是「上一个版本」那么简单：
 *
 * - 撤销一次**修改**应当回到该修改**之前**的状态，也就是这条版本记录所携带的
 *   `before`（由提交层保存），而不是「时间上的前一条」——
 *   因为在它之后可能有别的、用户想保留的改动（plan 的验收明确要求
 *   「修改 A 后用户补技能，再撤销 A，技能仍保留」）。
 *
 * 因此本函数只负责**找出被撤销的那条版本记录**；真正的恢复内容由提交层
 * 用条件 undo 生成（`undoOf` + inverse operations）。UI 不应自己计算目标内容。
 */
export function findUndoTarget(
  records: readonly VersionRecord[],
  versionId: string,
): VersionRecord | null {
  return records.find((record) => record.id === versionId) ?? null;
}

/**
 * 某条记录能否被撤销。
 *
 * 三条排除：
 * - 本身就是撤销记录（撤销一个撤销 = 重做，那是另一个功能）；
 * - 没有 `mutationId`（旧数据或系统操作，无法构造条件 undo 的幂等键）；
 * - 没有 `runId` 且 source 是 system（无主的系统操作不该由用户撤销）。
 */
export function canUndo(record: VersionRecord): boolean {
  if (record.source === "undo") return false;
  if (!record.mutationId) return false;
  if (record.source === "system" && !record.runId) return false;
  return true;
}

/**
 * 从记录里取出「回到任务」所需的标识。
 *
 * 返回 null 表示这条记录不属于任何任务 —— UI 应当隐藏那个入口，
 * 而不是给出一个点了没反应的按钮。
 */
export function runLinkFor(record: VersionRecord): { runId: string; changeSetId: string | null } | null {
  if (!record.runId) return null;
  return { runId: record.runId, changeSetId: record.changeSetId };
}

/**
 * 撤销失败时的处理依据。
 *
 * plan 要求「撤销调用服务端条件 undo，**失败保留用户内容**」。
 * 条件 undo 失败通常意味着「目标内容已被改过」——此时**不能**强行覆盖，
 * 应当把冲突如实返回给用户，让他们决定。
 *
 * 因此本函数不返回「新内容」，只返回一个可操作的说明。
 */
export function describeUndoFailure(code: string): string {
  switch (code) {
    case "condition_mismatch":
    case "revision_conflict":
      return "这段内容在你撤销之前又被改过，为避免覆盖你的改动，本次撤销没有执行";
    case "target_not_found":
      return "要撤销的内容已经不在了（可能已被删除）";
    case "run_not_writable":
      return "任务已结束，本次撤销未生效";
    case "idempotency_key_reuse":
      return "这次撤销请求与之前的一次不一致，请刷新后重试";
    default:
      return "撤销没有完成，你的内容未受影响";
  }
}
