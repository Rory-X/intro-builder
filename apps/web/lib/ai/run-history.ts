import type { RunEventEnvelope } from "@intro-builder/shared/types";

/**
 * 从已落库的事件重建对话历史（P07 切流的前置能力）。
 *
 * ## 为什么需要它
 *
 * 浮窗是**多轮会话**，模型需要看到之前的问答才能理解「帮我再改改」这类指代。
 * 但新 Run 路由 `POST /api/ai/runs` 把 `history` **硬编码为空数组**：
 *
 * ```ts
 * history: [],
 * ```
 *
 * 这在新路由还没有客户端消费方时不会暴露问题；一旦 P07 把浮窗切过来，
 * 每一轮都会变成「失忆」的第一轮 —— 用户说「再短一点」，模型不知道在说什么。
 *
 * `continue` 路由内部已经实现了这段逻辑（`buildHistoryFromEvents`），
 * 但它是路由文件的**私有函数**，因此：
 * - 没有独立测试覆盖；
 * - `start` 路由无法复用，只能各写一份或干脆留空（当前是留空）。
 *
 * 本模块把它抽出来共享，让两条路由用同一份实现 —— 两处各写一份必然漂移，
 * 而漂移的表现是「继续对话记得上下文、新开一轮不记得」这种难以察觉的差异。
 *
 * ## 刻意做得很薄
 *
 * 只取**用户可见的问答对**（提问 + `text.delta` 累积的助手文本）。
 * **不重放工具调用**：已提交的操作应当按回执查询，而不是再执行一遍 ——
 * 重放会让「继续」变成第二次修改。
 */

/** 一条对话消息。`role` 与 AI SDK 的期望一致。 */
export type HistoryMessage = { role: "user" | "assistant"; content: string };

/**
 * 从事件序列重建最小对话历史。
 *
 * 分组规则：`text.delta` 累积成缓冲；遇到任何 `run.` 开头的结束类事件时，
 * 把缓冲收成一条助手消息。用户消息来自 `askUser` 的**问题文本**与
 * 最初的提问（后者由调用方单独追加，不在事件里）。
 *
 * ## 为什么只收 `text.delta` 而不收 `tool.*`
 *
 * 工具调用会产生副作用（写文档）。把它们放进历史会让模型以为
 * 「这些操作已经做过了」—— 在某些情况下确实如此（已有回执），
 * 但历史文本无法表达「那次提交是否成功」。因此宁可不放：
 * 模型的下一步决策应当基于**当前文档状态**（它在系统提示里），
 * 而不是基于对历史操作的记忆。
 */
export function buildHistoryFromEvents(
  events: readonly Pick<RunEventEnvelope, "type" | "payload">[],
): HistoryMessage[] {
  const history: HistoryMessage[] = [];
  let buffer = "";

  for (const event of events) {
    if (event.type === "text.delta") {
      const text = event.payload.text;
      if (typeof text === "string") buffer += text;
      continue;
    }

    /*
     * 结束类事件把累积文本收成一条助手消息。
     *
     * `run.waiting_user` 也算结束：那一轮助手确实说完了话（并抛出问题），
     * 用户的回答是**下一轮**的用户消息。
     */
    if (event.type.startsWith("run.") && buffer.trim()) {
      history.push({ role: "assistant", content: buffer });
      buffer = "";
    }
  }

  // 流可能在没有结束事件的情况下中断 —— 已累积的文本仍然是有效上下文。
  if (buffer.trim()) history.push({ role: "assistant", content: buffer });
  return history;
}

/**
 * 按会话把多轮事件重建为**完整**历史。
 *
 * 与 `buildHistoryFromEvents` 的差别：那个处理**单个 Run** 的事件，
 * 这个处理**同一会话下多个 Run** 的事件（每一轮是一个 Run）。
 *
 * 输入的 `runEvents` 应当按时间正序（最早的 Run 在前）—— 顺序错了
 * 会让模型看到倒置的对话，那种上下文比没有上下文更糟。
 */
export function buildSessionHistory(
  runEvents: ReadonlyArray<{
    /** 该轮的用户提问。 */
    userMessage: string;
    events: readonly Pick<RunEventEnvelope, "type" | "payload">[];
  }>,
): HistoryMessage[] {
  const history: HistoryMessage[] = [];

  for (const turn of runEvents) {
    const text = turn.userMessage.trim();
    if (text) history.push({ role: "user", content: text });
    history.push(...buildHistoryFromEvents(turn.events));
  }

  return history;
}

/**
 * 把历史裁到 `maxMessages` 条（保留**最近**的）。
 *
 * 必要性：会话越长，历史越大，最终会超出请求体上限（服务端有
 * `validateAiRequestInput` 的 `historyLength` 校验）。裁掉最旧的比
 * 让整个请求被拒绝好 —— 用户至少能继续当前这轮。
 *
 * 裁剪时**从头部开始丢**，但保证第一条如果是助手消息也会被一起处理：
 * 以助手消息开头的历史在部分模型上是无效输入（需要先有用户消息）。
 * 因此丢到第一条是用户消息为止。
 */
export function trimHistory(history: readonly HistoryMessage[], maxMessages: number): HistoryMessage[] {
  if (maxMessages <= 0) return [];

  /*
   * 取尾部。
   *
   * 第一版把「未超限」和「超限」写成两个分支，而未超限那个分支我漏了
   * `return history`（只剩一句空判断），于是未超限时返回了 `[]` ——
   * 测试抓到（`expected [] to deeply equal [ Array(2) ]`）。
   *
   * 改为**统一取尾部再清理**：既不重复逻辑，也顺带处理了
   * 「未超限但以助手消息开头」这种同样非法的形状
   * （`buildSessionHistory` 在某轮没有用户消息时会产生它）。
   */
  const tail = history.length <= maxMessages ? [...history] : history.slice(history.length - maxMessages);

  // 丢掉开头的助手消息（模型期望对话以用户消息开始）。
  let start = 0;
  while (start < tail.length && tail[start].role !== "user") start += 1;
  return tail.slice(start);
}
