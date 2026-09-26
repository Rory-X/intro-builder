import type { RunEventEnvelope } from "@intro-builder/shared/types";

/**
 * 任务卡投影（P06 任务 2）。
 *
 * 从服务器事件派生「用户能看懂的当前进度」。与既有 `ai-client/reducer.ts` 的
 * 关系是**消费者与被消费者**：reducer 产出完整的机器投影（工具、提案、
 * 决策、冲突…），本模块把它收敛成一张任务卡需要的那几个字段。
 *
 * ## 四条不可让步的约束
 *
 * 1. **没有事件就不虚构进度**。`steps` 里只出现真的发生过的事；
 *    不显示百分比、不显示「正在进行第 N 步」这类无法从事件推出的话。
 *    这是 plan 明确要求的：「没有事件不虚构进度或百分比」。
 * 2. **模型完成与修改保存分开**。模型说完了（`run.completed`）与文档真的
 *    落盘了（有 `mutation.committed` 回执）是两件事。任务卡的文案必须让用户
 *    能分辨，否则就回到「模型完成 ≠ 已保存」那个老问题。
 * 3. **等待原因是可操作的**。`run.waiting_user` 时必须带出问题文本，
 *    而不是只显示「等待中」。
 * 4. **不暴露内部推理与凭据**。任务卡只描述可观察的行动与简短理由，
 *    不含原始 payload、模型 key、系统提示。
 */

/** 任务卡上的一步。 */
export type TaskStep = {
  /** 稳定 id，用于 React key 与「不重复渲染」。 */
  id: string;
  kind: "tool" | "proposal" | "commit" | "question" | "text";
  /** 面向用户的一句话。不含内部字段名或 payload。 */
  label: string;
  status: "running" | "done" | "failed" | "waiting";
  /** 失败时的简短原因（可操作）。 */
  detail?: string;
};

/** 任务卡的整体状态。刻意与 RunStatus 区分，因为它面向用户而非协议。 */
export type TaskCardStatus =
  | "idle"
  | "running"
  | "waiting_user"
  | "done"
  | "failed"
  | "cancelled"
  /** EOF 无结束事件：连接断了，不是完成。 */
  | "interrupted";

export type TaskCard = {
  status: TaskCardStatus;
  /** 已发生的步骤，按事件顺序。 */
  steps: TaskStep[];
  /**
   * 是否已产生**真实的文档修改回执**。
   *
   * 与 `status === "done"` 是**独立的两个事实**：模型可以说完话而什么都没写，
   * 也可以写了东西但连接在收尾前断掉。UI 必须分别展示这两件事。
   */
  hasPersistedChanges: boolean;
  /** 等待用户时的问题（`status === "waiting_user"` 时非空）。 */
  pendingQuestion: { questionId: string; question: string } | null;
  /** 需要用户处理的冲突数。 */
  conflictCount: number;
};

/** 空任务卡。尚未收到任何事件时的状态。 */
export function emptyTaskCard(): TaskCard {
  return {
    status: "idle",
    steps: [],
    hasPersistedChanges: false,
    pendingQuestion: null,
    conflictCount: 0,
  };
}

/**
 * 工具名的中文说明。
 *
 * 刻意用**业务目的**而不是工具名：用户看到的应当是「在更新项目描述」，
 * 而不是 `updateProjectBlock`。查不到的用兜底文案，不显示原始工具名 ——
 * 那对用户没有意义，且暴露内部命名。
 */
const TOOL_LABELS: Record<string, string> = {
  readResume: "读取简历内容",
  askUser: "向你确认一个信息",
  updateBasicsBlock: "更新基本信息",
  updateStyleSettingsBlock: "调整排版",
  addWorkExperience: "新增工作经历",
  updateWorkExperienceBlock: "更新工作经历",
  deleteWorkExperience: "删除工作经历",
  reorderWorkExperiences: "调整工作经历顺序",
  addProject: "新增项目经历",
  updateProjectBlock: "更新项目经历",
  deleteProject: "删除项目经历",
  reorderProjects: "调整项目经历顺序",
  addEducation: "新增教育经历",
  updateEducationBlock: "更新教育经历",
  deleteEducation: "删除教育经历",
  reorderEducation: "调整教育经历顺序",
  addResearch: "新增研究经历",
  updateResearchBlock: "更新研究经历",
  deleteResearch: "删除研究经历",
  reorderResearch: "调整研究经历顺序",
  writeSkillsSection: "更新专业技能",
  writePersonalSummarySection: "更新个人总结",
  writeAwardsSection: "更新奖项",
  writePortfolioSection: "更新作品集",
  addCustomSection: "新增自定义模块",
  updateCustomSectionBlock: "更新自定义模块",
  deleteCustomSection: "删除自定义模块",
  reorderCustomSections: "调整自定义模块顺序",
  hideResumeModule: "隐藏模块",
  showResumeModule: "显示模块",
  reorderResumeModules: "调整模块顺序",
  suggestSkills: "分析技能建议",
  analyzeJobMatch: "分析岗位匹配",
};

/** 兜底文案。不显示原始工具名（对用户无意义，且暴露内部命名）。 */
const UNKNOWN_TOOL_LABEL = "执行一项操作";

function toolLabel(toolName: string): string {
  return TOOL_LABELS[toolName] ?? UNKNOWN_TOOL_LABEL;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * 把事件序列折叠成任务卡。
 *
 * 这个函数是**纯函数**（事件数组 → 任务卡），因此可以穷举测试 ——
 * 与 reducer 的设计一致。它不持有状态，重复调用同一份事件得到同一张卡
 * （任务 6 要求「重放 event 不重复 toast/写入」，纯函数天然满足去重：
 * 同一份输入只有一份输出）。
 */
export function projectTaskCard(events: readonly RunEventEnvelope[]): TaskCard {
  const card = emptyTaskCard();
  const steps: TaskStep[] = [];
  /** 按 toolCallId 索引，用于把 tool.succeeded 归到对应的 started 上。 */
  const stepIndexByToolCall = new Map<string, number>();
  let sawCommit = false;

  for (const event of events) {
    const payload = asRecord(event.payload) ?? {};

    switch (event.type) {
      case "attempt.started":
      case "run.started":
        // 开始事件本身不该在任务卡上占一行 —— 它没有可观察的内容。
        if (card.status === "idle") card.status = "running";
        break;

      case "tool.started": {
        const toolCallId = String(payload.toolCallId ?? "");
        const toolName = String(payload.toolName ?? "");
        if (!toolCallId) break;
        /*
         * **去重，不覆盖**：同一个 toolCallId 的 `tool.started` 只处理一次。
         *
         * 必要性来自任务 6「重放 event 不重复 toast/写入」：SSE 断线重连后
         * 客户端会重放已见过的事件（sequence 去重由 reducer 负责，但任务卡
         * 是独立投影，同样需要幂等）。若这里直接 push，重放会让同一个工具
         * 在卡片上出现两次。
         *
         * 也不采用「覆盖同一索引」的写法：那会保留第二条而丢掉第一条的位置，
         * 步骤顺序会与真实发生顺序不符。
         */
        if (stepIndexByToolCall.has(toolCallId)) break;
        stepIndexByToolCall.set(toolCallId, steps.length);
        /*
         * 工具正在执行。`kind` 用 "tool"，但对用户显示的是**业务动作**。
         * `askUser` 单独标成 waiting —— 它与其他工具的用户感受完全不同。
         */
        steps.push({
          id: toolCallId,
          kind: toolName === "askUser" ? "question" : "tool",
          label: toolLabel(toolName),
          status: "running",
        });
        break;
      }

      case "tool.succeeded": {
        const toolCallId = String(payload.toolCallId ?? "");
        const index = stepIndexByToolCall.get(toolCallId);
        if (index === undefined) break;
        steps[index] = { ...steps[index], status: "done" };
        break;
      }

      case "tool.failed": {
        const toolCallId = String(payload.toolCallId ?? "");
        const index = stepIndexByToolCall.get(toolCallId);
        if (index === undefined) break;
        const code = typeof payload.code === "string" ? payload.code : "";
        steps[index] = {
          ...steps[index],
          status: "failed",
          /*
           * detail 用**中文可操作说明**，不用原始错误码。
           * 目标缺失是用户能处理的（「找不到这条内容，可能已被删除」），
           * 而 `target_not_found` 对用户没有意义。
           */
          detail: describeToolFailure(code),
        };
        break;
      }

      case "proposal.ready": {
        const changeSetId = String(payload.changeSetId ?? "");
        const summary = typeof payload.summary === "string" ? payload.summary : "生成修改建议";
        // 同一 changeSetId 的提案只记一次（重放安全）。
        if (changeSetId && steps.some((step) => step.id === changeSetId)) break;
        steps.push({
          id: changeSetId || `proposal-${steps.length}`,
          kind: "proposal",
          label: summary,
          // 提案就绪但**未落盘** —— 状态是 waiting（等用户决定），不是 done。
          status: "waiting",
        });
        break;
      }

      case "mutation.committed": {
        /*
         * 真实的落盘回执。
         *
         * 这是 `hasPersistedChanges` 的**唯一**依据 —— 不看模型说什么、
         * 也不看工具自称成功。
         */
        sawCommit = true;
        const mutationId = String(payload.mutationId ?? "");
        /*
         * 同一 mutationId 的提交事件只记一次。
         *
         * 这一条比工具去重更重要：重放若产生两条「已保存修改」，
         * 用户会以为做了两次改动 —— 而实际只有一条回执。
         */
        if (mutationId && steps.some((step) => step.id === mutationId)) break;
        const revision = typeof payload.revision === "number" ? payload.revision : null;
        steps.push({
          id: mutationId || `commit-${steps.length}`,
          kind: "commit",
          label: revision === null ? "已保存修改" : `已保存修改（版本 ${revision}）`,
          status: "done",
        });
        break;
      }

      case "mutation.conflict": {
        card.conflictCount += 1;
        break;
      }

      case "run.waiting_user": {
        card.status = "waiting_user";
        const question = asRecord(payload.question);
        const questionId = question ? String(question.questionId ?? "") : "";
        const questionText = question ? String(question.question ?? "") : "";
        card.pendingQuestion =
          questionId && questionText ? { questionId, question: questionText } : null;
        /*
         * 把那个正在「等待」的 askUser 步骤标成 waiting（而不是 done）——
         * 它确实完成了「发出问题」，但用户的注意力在「还没回答」这件事上。
         */
        const index = steps.findIndex((step) => step.kind === "question" && step.status === "running");
        if (index >= 0) steps[index] = { ...steps[index], status: "waiting" };
        break;
      }

      case "run.completed":
        /*
         * 模型说完了。但这**不等于**文档被保存 —— 因此这里只改 status，
         * 不动 `hasPersistedChanges`。UI 必须分别展示这两件事。
         */
        card.status = "done";
        break;

      case "run.failed":
        card.status = "failed";
        break;

      case "run.cancelled":
        card.status = "cancelled";
        break;

      case "run.interrupted":
        card.status = "interrupted";
        break;

      default:
        // 文本片段与决策记录不进任务卡（文本由聊天区展示，决策有专门的卡）。
        break;
    }
  }

  /*
   * 收尾：仍在 running 的步骤在终态下不可能再变。
   *
   * 不处理的话，一个被中断的 Run 会永远显示「正在更新项目描述…」，
   * 而那个工具实际上再也不会返回了。如实标记为失败/中断比留着转圈好。
   */
  if (card.status === "failed" || card.status === "interrupted" || card.status === "cancelled") {
    for (let i = 0; i < steps.length; i += 1) {
      if (steps[i].status === "running") {
        steps[i] = {
          ...steps[i],
          status: "failed",
          detail: card.status === "cancelled" ? "已取消" : "未完成",
        };
      }
    }
  }

  card.steps = steps;
  card.hasPersistedChanges = sawCommit;
  return card;
}

/**
 * 工具失败码 → 面向用户的说明。
 *
 * 每条都是**用户能处理**的：要么是「稍后重试」，要么是「去看看那条内容还在不在」。
 * 未识别的码给一个不推卸责任但仍可行动的兜底文案（不显示原始码）。
 */
function describeToolFailure(code: string): string {
  switch (code) {
    case "target_not_found":
      return "找不到这条内容，可能已被删除";
    case "revision_conflict":
      return "内容已在别处修改，请刷新后重试";
    case "run_not_writable":
      return "任务已结束，本次修改未生效";
    case "invalid_args":
      return "这次操作没有理解清楚，我会换个方式";
    case "empty_proposal":
      return "没有产生实际修改";
    case "no_change":
      return "内容已经是这样了";
    default:
      return "这一步没有完成";
  }
}

/**
 * 任务卡是否应该显示「已保存」。
 *
 * 单独一个函数是因为这个判断很容易被写成 `status === "done"`，
 * 而那会把「模型说完话但什么都没写」显示成「已保存」。
 */
export function shouldShowSavedBadge(card: TaskCard): boolean {
  return card.hasPersistedChanges;
}

/**
 * 任务卡的一句话概览。
 *
 * 只在能确定时给出结论，不确定时返回 null 让 UI 保持沉默 ——
 * 编一句「正在处理」比不显示更糟（用户会以为有进度）。
 */
export function taskCardHeadline(card: TaskCard): string | null {
  switch (card.status) {
    case "idle":
      return null;
    case "running":
      return card.steps.length === 0 ? null : "正在处理";
    case "waiting_user":
      return card.pendingQuestion ? "等待你的回答" : "等待你的确认";
    case "done":
      return card.hasPersistedChanges ? "已完成并保存" : "已完成";
    case "failed":
      return "执行失败";
    case "cancelled":
      return "已取消";
    case "interrupted":
      return "连接中断，未完成";
    default:
      return null;
  }
}
