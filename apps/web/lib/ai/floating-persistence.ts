import type { ResumeOperation } from "@intro-builder/shared/types";
import type { RunEventEnvelope } from "@intro-builder/shared/types";

/** 存储层的工具卡形状（与 `appendFloatingChatMessage` 的参数一致）。 */
type PersistedToolCall = {
  id: string;
  name: string;
  /**
   * **只允许终态**。
   *
   * 旧路径持久化时会过滤掉 `running` 的工具卡（`persistedToolCalls`）——
   * 存的若是 running，刷新后那条工具卡会**永久转圈**
   * （没有任何后续事件会再更新它）。
   */
  status: "completed" | "error";
  summary: string;
  errorText?: string;
};

/**
 * 从 Run 事件投影出**待持久化**的浮窗消息（P07 任务 3 缺的一环）。
 *
 * ## 为什么需要它
 *
 * 旧路径（`/api/agent/floating/chat`）会把自己的输出写进浮窗会话表
 * （`agent_floating_chat_message`），刷新后按会话恢复的对话历史读的就是那张表。
 *
 * 而统一 Run 路由**完全不写那张表** —— 后果是：
 * 用户用新路径聊完、刷新页面，**对话历史里看不到那些消息**。
 *
 * 注意这不是「Run 无法恢复」：Run 自身的状态与事件可从
 * `GET /api/ai/runs/[runId]?events=1` 读到。缺的是**展示用**的会话历史
 * （用户看到的聊天记录）。
 *
 * ## 为什么是纯函数
 *
 * 投影规则有若干具体判断（文本如何累积、工具卡取哪个状态、哪些事件不入库），
 * 而它们都在「服务端流收尾」这个难以单测的位置。抽成纯函数后可穷举。
 *
 * ## 刻意不持久化的东西
 *
 * - **工具原始输入/输出**：`payload.result` 可能含简历完整快照，
 *   让它进库等于把整份文档又存一份（且历史页会渲染它）。
 * - **内部事件 id / sequence**：那是 Run 的投影细节，不是对话内容。
 */

/** 一条待写入的浮窗消息（与 `appendFloatingChatMessage` 的参数形状一致）。 */
export type PersistableFloatingMessage = {
  role: "user" | "assistant";
  content: string;
  toolCalls: PersistedToolCall[];
  operations: ResumeOperation[];
  parts: Array<Record<string, unknown>>;
};

/** 工具的执行状态（与浮窗工具卡一致）。 */
type ToolState = "running" | "completed" | "error";

/**
 * 把一批事件投影成助手消息。
 *
 * 返回 `null` 表示**没有值得持久化的内容**（例如只有 `attempt.started`）——
 * 那时不该写一条空消息。
 */
export function buildPersistableAssistantMessage(
  events: readonly RunEventEnvelope[],
): PersistableFloatingMessage | null {
  let text = "";
  const toolOrder: string[] = [];
  const tools = new Map<string, { id: string; name: string; status: ToolState; summary: string; errorText?: string }>();
  const questions: Array<{ id: string; question: string }> = [];

  for (const event of events) {
    const payload = event.payload ?? {};

    if (event.type === "text.delta") {
      const delta = payload.text;
      if (typeof delta === "string") text += delta;
      continue;
    }

    if (event.type === "tool.started" || event.type === "tool.succeeded" || event.type === "tool.failed") {
      const id = typeof payload.toolCallId === "string" ? payload.toolCallId : "";
      if (!id) continue;
      const existing = tools.get(id);
      const name =
        typeof payload.toolName === "string" && payload.toolName
          ? payload.toolName
          : (existing?.name ?? "");
      /*
       * 状态按事件类型推进，且**不倒退**：
       * 先 started（running）后 succeeded（completed）是正常顺序，
       * 但事件可能乱序到达（重放、并行工具）—— 让后到的 running
       * 覆盖已完成的 completed 会让历史里的工具卡永久转圈。
       */
      const next: ToolState =
        event.type === "tool.succeeded" ? "completed" : event.type === "tool.failed" ? "error" : "running";
      const current = existing?.status ?? "running";
      const status =
        current === "completed" || current === "error" ? current : next;

      if (!existing) toolOrder.push(id);
      tools.set(id, {
        id,
        name,
        status,
        summary: existing?.summary ?? "",
        ...(event.type === "tool.failed" && typeof payload.code === "string"
          ? { errorText: payload.code }
          : existing?.errorText
            ? { errorText: existing.errorText }
            : {}),
      });
      continue;
    }

    if (event.type === "run.waiting_user") {
      const question = payload.question;
      if (question && typeof question === "object" && !Array.isArray(question)) {
        const record = question as Record<string, unknown>;
        const id = typeof record.questionId === "string" ? record.questionId : "";
        const value = typeof record.question === "string" ? record.question : "";
        if (id && value) questions.push({ id, question: value });
      }
    }
  }

  /*
   * **过滤掉仍在 running 的工具卡**（与旧路径的 `persistedToolCalls` 一致）。
   *
   * 存的若是 running，刷新后那条工具卡会**永久转圈** ——
   * 没有任何后续事件会再更新它（那一轮已经结束）。
   */
  const toolCalls: PersistedToolCall[] = toolOrder
    .map((id) => tools.get(id))
    .filter((tool): tool is NonNullable<typeof tool> => Boolean(tool))
    .filter((tool): tool is typeof tool & { status: "completed" | "error" } => tool.status !== "running")
    .map((tool) => ({
      id: tool.id,
      name: tool.name,
      status: tool.status,
      summary: tool.summary,
      ...(tool.errorText ? { errorText: tool.errorText } : {}),
    }));

  /*
   * 没有任何内容就不写。
   *
   * 「没有内容」的判据是**文本、工具、问题三者都为空** ——
   * 只看文本会让「只调了工具没说话」的那一轮丢失。
   */
  if (!text.trim() && toolCalls.length === 0 && questions.length === 0) return null;

  return {
    role: "assistant",
    content: text.trim(),
    toolCalls,
    // 新路径的操作由服务端提交（有回执），这里不重复记录。
    operations: [],
    parts: buildParts(text.trim(), toolCalls, questions),
  };
}

/**
 * 构造 `parts` 数组（浮窗渲染用的分片列表）。
 *
 * 顺序刻意是「文本在前、工具与问题在后」：真实渲染里助手通常先说话再调工具，
 * 而这个形状与旧路径的 `finalizeFloatingParts` 保持一致 ——
 * 两套形状不同会让历史页对新旧消息渲染不一致。
 */
function buildParts(
  content: string,
  toolCalls: PersistedToolCall[],
  questions: Array<{ id: string; question: string }>,
): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [];
  if (content) {
    parts.push({ id: "part_text_final", type: "text", text: content });
  }
  for (const toolCall of toolCalls) {
    parts.push({ id: `part_tool_${String(toolCall.id)}`, type: "tool", toolCall });
  }
  for (const question of questions) {
    parts.push({
      id: `part_question_${question.id}`,
      type: "question",
      question: { id: question.id, question: question.question, status: "pending" },
    });
  }
  return parts;
}

/**
 * 构造待持久化的用户消息。
 *
 * 返回 `null` 表示消息为空（调用方不该写一条空记录）。
 */
export function buildPersistableUserMessage(message: string): PersistableFloatingMessage | null {
  const content = message.trim();
  if (!content) return null;
  return { role: "user", content, toolCalls: [], operations: [], parts: [{ id: "part_text_user", type: "text", text: content }] };
}

/**
 * 会话标题：取用户消息的前 50 字符（与旧路径一致）。
 *
 * 单独成函数是因为它是**唯一的标题来源** —— 旧路径用
 * `lastUserMessage.content.trim().slice(0, 50)`，两处写死会漂移。
 */
export function floatingSessionTitle(message: string): string {
  return message.trim().slice(0, 50);
}
