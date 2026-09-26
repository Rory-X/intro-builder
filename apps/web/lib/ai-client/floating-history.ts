import { AI_REQUEST_LIMITS } from "@/lib/ai/provider-policy";
import { trimHistory, type HistoryMessage } from "@/lib/ai/run-history";

/**
 * 浮窗消息 → 对话历史（P07 任务 3 的最后一处纯逻辑）。
 *
 * ## 为什么需要它
 *
 * `createFloatingRun` 接受 `history`，但**调用方必须自己从浮窗的
 * `messages` state 映射**。而这条映射有几个不显然的判断：
 *
 * 1. **哪些消息该进历史**。浮窗的 `messages` 里的 `content` 是**累积文本**，
 *    而工具卡、审批卡、问题卡都在 `parts` 里。历史只需要文本 ——
 *    把工具调用塞进历史会让模型以为「这些操作已经做过了」，
 *    而历史文本无法表达「那次提交是否成功」。
 * 2. **跳过空消息与管道消息**。模型未配置时的提示（`MODEL_MISSING_MESSAGE`）
 *    是**界面文案**，不是对话内容。把它送进历史会让模型看到一句自己从未说过的话。
 * 3. **裁剪到服务端上限**。服务端对超长历史是**整体拒绝**（400），
 *    那会让用户连当前这轮都发不出去。
 * 4. **首条必须是用户消息**。以助手消息开头的历史对部分模型是非法输入。
 *    `trimHistory` 已处理，但这里要在映射阶段就避免产出这种形状。
 *
 * ## 为什么是纯函数
 *
 * 映射规则是这次切流里最容易出错、也最难在组件里测到的部分（组件 2511 行）。
 * 抽成纯函数后可以穷举各种消息组合。
 */

/** 映射所需的输入形状（只取用得到的字段，便于测试构造）。 */
export type MappableMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** 该助手消息是否仍在流式生成中。 */
  streaming?: boolean;
};

/** 需要跳过的「界面文案」——它们不是对话内容。 */
const UI_ONLY_MESSAGES = new Set([
  "尚未配置模型，请先在设置里连接模型服务。",
  "AI 助手请求失败",
  "AI 助手暂时不可用",
]);

export type BuildHistoryInput = {
  messages: readonly MappableMessage[];
  /**
   * 要排除的尾部消息数（通常是「刚发出的那条用户消息」）。
   *
   * 必要性：发起请求时当前这条用户消息会**单独**作为 `message` 传给服务端
   * （需要单独校验长度、单独做意图判断）。若它同时出现在 `history` 里，
   * 模型会看到同一句话两次 —— 那会让它以为用户在重复说同一件事。
   */
  excludeTail?: number;
  /**
   * 界面文案集合（覆盖默认值）。
   *
   * 允许覆盖是因为不同组件有自己的占位文案；硬编码会让「跳过哪些」
   * 这件事散落在两处。
   */
  uiOnlyMessages?: readonly string[];
  /** 历史条数上限（默认取服务端校验的同一个常量）。 */
  maxMessages?: number;
};

/**
 * 把浮窗消息映射为对话历史。
 *
 * 返回的数组已裁剪到上限、且保证以用户消息开头（或为空）。
 */
export function buildHistoryFromMessages(input: BuildHistoryInput): HistoryMessage[] {
  const uiOnly = new Set([...UI_ONLY_MESSAGES, ...(input.uiOnlyMessages ?? [])]);
  const excludeTail = Math.max(0, input.excludeTail ?? 0);
  const tail = excludeTail > 0 ? input.messages.slice(0, -excludeTail) : input.messages;

  const history: HistoryMessage[] = [];
  for (const message of tail) {
    /*
     * 跳过仍在流式生成的消息。
     *
     * 它的 `content` 是半句话 —— 送进历史会让模型看到一句断掉的话，
     * 从而以为用户或自己说过不完全的内容。
     */
    if (message.streaming) continue;

    const text = message.content.trim();
    // 空内容（例如只有工具卡的助手消息）不产生历史条目。
    if (!text) continue;
    // 界面文案不是对话内容（见文件头说明）。
    if (uiOnly.has(text)) continue;

    /*
     * 与上一条同 role 且文本相同时**合并跳过**。
     *
     * 场景：流式更新可能让同一条助手消息被多次追加（组件按 id 替换，
     * 但映射的输入未必经过去重）。重复条目会让模型看到冗余的上下文，
     * 也会浪费长度预算。
     */
    const previous = history.at(-1);
    if (previous && previous.role === message.role && previous.content === text) continue;

    history.push({ role: message.role, content: text });
  }

  return trimHistory(history, input.maxMessages ?? AI_REQUEST_LIMITS.maxHistoryMessages);
}

/**
 * 生成请求的幂等键。
 *
 * ## 为什么必须是「每次新提问一个新键」
 *
 * 服务端按 `requestId` 复用 Run：同键重复 POST 不会二次调用模型。
 * 这有两个相反的使用场景，必须分清：
 *
 * - **客户端重试**（网络抖动、超时重发）→ **复用同一个键**，
 *   让服务端识别为重放而不是第二次修改；
 * - **用户再次提问** → **必须是新键**，否则会命中上一轮的 Run 并返回
 *   「已复用既有任务」，用户看到的是「AI 没反应」。
 *
 * 因此键的生成必须包含**用户消息内容**或**递增序号**，
 * 不能只依赖时间戳 —— 同一毫秒内连续两次提问（快速连点）会撞键。
 */
export function buildRequestId(input: {
  /** 会话 id；无会话时为 null。 */
  sessionId: string | null;
  /** 本轮用户消息（trim 后参与哈希）。 */
  message: string;
  /** 递增序号（由调用方维护，保证连点也不撞键）。 */
  sequence: number;
}): string {
  /*
   * 用简单哈希而不是随机 UUID：**随机 UUID 会让「重试复用同一键」
   * 变得不可能** —— 而重试正是幂等键存在的主要理由。
   *
   * 这里不含时间戳：时间戳看似唯一，但在快速连点时同一毫秒内两次调用
   * 会得到相同前缀，而哈希输入相同就必然撞键。序号是可靠区分器。
   */
  const basis = `${input.sessionId ?? "no-session"}:${input.sequence}:${input.message.trim()}`;
  let hash = 0;
  for (let index = 0; index < basis.length; index += 1) {
    // 31 是常见的字符串哈希乘子（与 Java hashCode 同族），分布够用。
    hash = (hash * 31 + basis.charCodeAt(index)) | 0;
  }
  // 补上紧凑的可读前缀，便于在日志里按会话归类。
  const prefix = input.sessionId ? input.sessionId.slice(0, 8) : "anon";
  return `${prefix}-${input.sequence}-${(hash >>> 0).toString(36)}`;
}
