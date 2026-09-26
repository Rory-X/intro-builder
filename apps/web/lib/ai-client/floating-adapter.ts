import type { RunEventEnvelope, RunStatus } from "@intro-builder/shared/types";

/**
 * 新旧 AG-UI 协议的适配（P07 任务 3）。
 *
 * ## 为什么需要它
 *
 * 浮窗（`floating-agent-chat.tsx`）消费的是**旧微服务**发出的 SSE 协议：
 *
 * ```
 * text-delta / tool-call-start / tool-call-delta / tool-call-result
 * approval-request / question-request / done / error
 * ```
 *
 * 新 Run 路由走的是统一事件流（P04 契约）：
 *
 * ```
 * attempt.started / text.delta / tool.started / tool.arguments / tool.succeeded
 * tool.failed / proposal.ready / decision.recorded / mutation.committed
 * mutation.conflict / run.waiting_user / run.completed / run.failed
 * run.cancelled / run.interrupted
 * ```
 *
 * 两套协议的**语义单位不同**，不是改几个字段名就能对上的：
 *
 * | 旧协议 | 新协议 | 差异 |
 * |---|---|---|
 * | `text-delta`（增量文本） | `text.delta` | 同构 |
 * | `tool-call-start/delta/result`（三个阶段） | `tool.started`/`tool.arguments`/`tool.succeeded` | 旧协议一个工具可能发多条，新协议按生命周期分事件 |
 * | `approval-request`（要用户批准） | `proposal.ready` + 决策路由 | 新协议的批准是**独立请求**（`/change-sets/:id/decisions`），不在流里 |
 * | `question-request` | `run.waiting_user` | 新协议的问题在事件 payload 里 |
 * | `done` | `run.completed`/`failed`/`cancelled`/`interrupted` | 旧协议一个 done，新协议区分四种终态 |
 *
 * ## 本模块的定位
 *
 * 只做**事件 → 浮窗消息片段**的翻译，不做状态管理、不发请求。
 * 这样它可以是纯函数，用事件数组穷举测试 —— 而真正的切流改动
 * （替换 `fetch` 目标、替换状态更新逻辑）留在组件里，与这里解耦。
 */

/** 浮窗的工具卡形状（与 `floating-agent-chat.tsx` 内的类型一致）。 */
export type AdaptedToolCall = {
  id: string;
  name: string;
  status: "running" | "completed" | "error";
  summary: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

/** 浮窗的等待问题形状。 */
export type AdaptedQuestion = {
  id: string;
  question: string;
  field?: string;
  status: "pending" | "answered";
};

/** 适配产出的一条「可应用」动作。调用方按顺序把它喂给状态更新。 */
export type AdaptedStreamAction =
  /** 增量文本。 */
  | { kind: "text"; delta: string }
  /** 工具卡新增或更新（按 `id` 去重，同 id 视为更新）。 */
  | { kind: "tool"; toolCall: AdaptedToolCall }
  /** 需要用户回答的问题。 */
  | { kind: "question"; question: AdaptedQuestion }
  /** 提案就绪：调用方应去拉 changeSet 并展示提案卡。 */
  | { kind: "proposal"; changeSetId: string; proposalVersion: number; summary: string }
  /** 文档真的落盘了（唯一能驱动「已保存」的依据）。 */
  | { kind: "committed"; mutationId: string; revision: number | null }
  /** 冲突，需要用户处理。 */
  | { kind: "conflict"; mutationId: string; message: string }
  /** 终态。 */
  | { kind: "ended"; status: EndStatus; reason: string | null };

export type EndStatus = "completed" | "failed" | "cancelled" | "interrupted" | "waiting_user";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * 工具名 → 面向用户的短说明。
 *
 * 与 `task-projection` 里的映射**刻意分开**：那边的映射用于任务卡的
 * 步骤标签（「更新项目经历」），这边用于工具卡的标题。两处受众与上下文不同，
 * 合一会让任一处想调整文案时影响另一处。
 */
const TOOL_SUMMARIES: Record<string, string> = {
  readResume: "读取简历内容",
  askUser: "向你确认一个信息",
  writePersonalSummarySection: "更新个人总结",
  writeSkillsSection: "更新专业技能",
  writeAwardsSection: "更新奖项",
  writePortfolioSection: "更新作品集",
  updateBasicsBlock: "更新基本信息",
  updateStyleSettingsBlock: "调整排版",
  hideResumeModule: "隐藏模块",
  showResumeModule: "显示模块",
  reorderResumeModules: "调整模块顺序",
  suggestSkills: "分析技能建议",
  analyzeJobMatch: "分析岗位匹配",
};

/**
 * 只保留**已知**工具名（浮窗的 `titleByName` 表能查到它们）。
 *
 * 未知工具名会置空 —— 原因是浮窗渲染时会把它作为查表键，
 * 未命中时回退到 `summary`；但更关键的是：把内部工具名放进数据结构，
 * 就总有某个渲染路径会把它显示出来（实测发生过）。
 * 名称对用户没有意义，`summary` 已经表达了「在做什么」。
 */
function publicToolName(toolName: string): string {
  return TOOL_SUMMARIES[toolName] || KNOWN_PREFIXES.some((prefix) => toolName.startsWith(prefix))
    ? toolName
    : "";
}

/** 前缀白名单：这些前缀对应的工具名可以外露（浮窗能查到它们的标题）。 */
const KNOWN_PREFIXES = [
  "updateWorkExperience",
  "addWorkExperience",
  "deleteWorkExperience",
  "reorderWorkExperience",
  "updateProject",
  "addProject",
  "deleteProject",
  "reorderProject",
  "updateEducation",
  "addEducation",
  "deleteEducation",
  "reorderEducation",
  "updateResearch",
  "addResearch",
  "deleteResearch",
  "reorderResearch",
  "updateCustomSection",
  "addCustomSection",
  "deleteCustomSection",
  "reorderCustomSection",
];

function toolSummary(toolName: string): string {
  if (TOOL_SUMMARIES[toolName]) return TOOL_SUMMARIES[toolName];
  if (toolName.startsWith("updateWorkExperience")) return "更新工作经历";
  if (toolName.startsWith("addWorkExperience")) return "新增工作经历";
  if (toolName.startsWith("deleteWorkExperience")) return "删除工作经历";
  if (toolName.startsWith("reorderWorkExperience")) return "调整工作经历顺序";
  if (toolName.startsWith("updateProject")) return "更新项目经历";
  if (toolName.startsWith("addProject")) return "新增项目经历";
  if (toolName.startsWith("deleteProject")) return "删除项目经历";
  if (toolName.startsWith("reorderProject")) return "调整项目经历顺序";
  if (toolName.startsWith("updateEducation")) return "更新教育经历";
  if (toolName.startsWith("addEducation")) return "新增教育经历";
  if (toolName.startsWith("deleteEducation")) return "删除教育经历";
  if (toolName.startsWith("reorderEducation")) return "调整教育经历顺序";
  if (toolName.startsWith("updateResearch")) return "更新研究经历";
  if (toolName.startsWith("addResearch")) return "新增研究经历";
  if (toolName.startsWith("deleteResearch")) return "删除研究经历";
  if (toolName.startsWith("reorderResearch")) return "调整研究经历顺序";
  if (toolName.startsWith("updateCustomSection")) return "更新自定义模块";
  if (toolName.startsWith("addCustomSection")) return "新增自定义模块";
  if (toolName.startsWith("deleteCustomSection")) return "删除自定义模块";
  if (toolName.startsWith("reorderCustomSection")) return "调整自定义模块顺序";
  // 未知工具给中性文案，不回显内部名 —— 那对用户没有意义。
  return "执行一项操作";
}

/** 工具失败码 → 面向用户的说明（与任务卡同源思路，但文案针对工具卡上下文）。 */
function toolFailureText(code: string): string {
  switch (code) {
    case "target_not_found":
      return "找不到这条内容，可能已被删除";
    case "revision_conflict":
      return "内容已在别处修改，请刷新后重试";
    case "run_not_writable":
      return "任务已结束，本次修改未生效";
    case "invalid_args":
      return "这次操作没有理解清楚";
    case "no_change":
      return "内容已经是这样了";
    default:
      return "这一步没有完成";
  }
}

/**
 * 把一条新协议事件翻译成浮窗动作。
 *
 * 返回 `null` 表示这条事件**不需要浮窗做任何事** —— 例如
 * `attempt.started` 与 `tool.arguments`（参数累计由适配层内部处理，
 * 不产生独立动作）。调用方无需为「无动作」写分支。
 */
export function adaptRunEventToAction(event: RunEventEnvelope): AdaptedStreamAction | null {
  const payload = asRecord(event.payload) ?? {};

  switch (event.type) {
    case "text.delta": {
      const delta = text(payload.text);
      // 空 delta 不产生动作（否则会产生一个无意义的渲染批次）。
      return delta ? { kind: "text", delta } : null;
    }

    case "tool.started": {
      const id = text(payload.toolCallId);
      if (!id) return null;
      return {
        kind: "tool",
        toolCall: {
          id,
          name: publicToolName(text(payload.toolName)),
          status: "running",
          summary: toolSummary(text(payload.toolName)),
        },
      };
    }

    case "tool.arguments": {
      /*
       * 参数是**流式累积**的：每来一段就更新工具卡上的 `input`。
       *
       * 这里把累计值放到 `output` 之外的字段不现实（浮窗类型固定），
       * 因此用 `input` 承载「当前已收到的参数文本」。它只用于展示，
       * 真正执行用的参数在服务端。
       */
      const id = text(payload.toolCallId);
      if (!id) return null;
      const delta = text(payload.delta) || text(payload.inputTextDelta);
      if (!delta) return null;
      return {
        kind: "tool",
        toolCall: {
          id,
          name: publicToolName(text(payload.toolName)),
          status: "running",
          summary: toolSummary(text(payload.toolName)),
          input: delta,
        },
      };
    }

    case "tool.succeeded": {
      const id = text(payload.toolCallId);
      if (!id) return null;
      return {
        kind: "tool",
        toolCall: {
          id,
          name: publicToolName(text(payload.toolName)),
          status: "completed",
          summary: toolSummary(text(payload.toolName)),
          /*
           * **刻意不透传 `payload.result`。**
           *
           * 浮窗的工具卡会把 `output` 直接 `JSON.stringify` 渲染出来
           * （`floating-agent-chat.tsx` 的 `formatToolPayload`）。
           * 工具结果里可能含用户简历的完整快照、内部字段名，
           * 甚至（在某些实现里）配置片段 —— 那是**不该出现在聊天流里**的内容。
           *
           * 测试抓到过这一点：把 `payload.result` 原样放进去后，
           * 构造的 `{ raw: "sk-secret" }` 直接出现在适配结果里。
           *
           * 需要展示结果摘要时，应当由工具自己产出一条面向用户的
           * `summary`（或用任务卡），而不是把原始载荷透出去。
           */
        },
      };
    }

    case "tool.failed": {
      const id = text(payload.toolCallId);
      if (!id) return null;
      return {
        kind: "tool",
        toolCall: {
          id,
          name: publicToolName(text(payload.toolName)),
          status: "error",
          summary: toolSummary(text(payload.toolName)),
          errorText: toolFailureText(text(payload.code)),
        },
      };
    }

    case "proposal.ready": {
      const changeSetId = text(payload.changeSetId);
      if (!changeSetId) return null;
      return {
        kind: "proposal",
        changeSetId,
        proposalVersion: typeof payload.proposalVersion === "number" ? payload.proposalVersion : 1,
        summary: text(payload.summary) || "生成修改建议",
      };
    }

    case "mutation.committed": {
      const mutationId = text(payload.mutationId);
      return {
        kind: "committed",
        mutationId,
        revision: typeof payload.revision === "number" ? payload.revision : null,
      };
    }

    case "mutation.conflict": {
      const mutationId = text(payload.mutationId);
      return {
        kind: "conflict",
        mutationId,
        message: text(payload.message) || "这处内容已被别处修改，需要你先确认",
      };
    }

    case "run.waiting_user": {
      const question = asRecord(payload.question);
      const questionId = question ? text(question.questionId) : "";
      const questionText = question ? text(question.question) : "";
      /*
       * 问题必须带 id 才能挂到消息上（浮窗按 id 更新状态）。
       * 缺 id 时**不产生动作**而不是编一个 —— 编的 id 会让后续
       * 「用户回答后标记为已答」找不到目标。
       */
      if (!questionId || !questionText) {
        return { kind: "ended", status: "waiting_user", reason: null };
      }
      const target = question ? text(question.target) : "";
      return {
        kind: "question",
        question: {
          id: questionId,
          question: questionText,
          ...(target ? { field: target } : {}),
          status: "pending",
        },
      };
    }

    case "run.completed":
      return { kind: "ended", status: "completed", reason: null };
    case "run.failed":
      return { kind: "ended", status: "failed", reason: text(payload.message) || null };
    case "run.cancelled":
      return { kind: "ended", status: "cancelled", reason: null };
    case "run.interrupted":
      return { kind: "ended", status: "interrupted", reason: text(payload.reason) || null };

    default:
      /*
       * `attempt.started` / `decision.recorded` 等不产生浮窗动作：
       * 前者没有可展示的内容，后者由提案卡驱动（不走消息流）。
       */
      return null;
  }
}

/**
 * 批量翻译，过滤掉不需要动作的事件。
 *
 * 供调用方一次性处理已读到的事件数组（刷新恢复场景）。
 */
export function adaptRunEvents(events: readonly RunEventEnvelope[]): AdaptedStreamAction[] {
  const actions: AdaptedStreamAction[] = [];
  for (const event of events) {
    const action = adaptRunEventToAction(event);
    if (action) actions.push(action);
  }
  return actions;
}

/**
 * 新协议的终态 → 浮窗的收尾判据。
 *
 * **`waiting_user` 也是结束**：那一轮助手说完了话并抛出问题，
 * 下一轮才继续。把它当成「还在运行」会让界面永远转圈。
 */
export function isEndStatus(status: EndStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "interrupted";
}

/** 终态是否算「正常结束」（决定是否显示错误样式）。 */
export function isSuccessfulEnd(status: EndStatus): boolean {
  return status === "completed" || status === "waiting_user";
}

/** `RunStatus` → 浮窗终态（刷新恢复时把服务端状态映射过来）。 */
export function endStatusFromRunStatus(status: RunStatus): EndStatus {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "waiting_user":
      return "waiting_user";
    case "interrupted":
      return "interrupted";
    case "running":
    default:
      return "interrupted";
  }
}
