/**
 * 条目 ID 的创建入口。
 *
 * 契约（规格 §5.1）：**新条目创建时生成一次 ID**，导入、复制、表单 append、Agent
 * 新增都遵守同一规则；排序只改变顺序，不改变 ID。
 *
 * 一个必须避开的陷阱：`react-hook-form` 的 `useFieldArray` 会给每个 `fields[i]`
 * 附加它自己的 `id`（内部 key，渲染时用于 React list key）。它与我们写进表单值的
 * 业务 `id` **同名但不同物** —— `fields[i].id` 是 RHF 生成的，`getValues()` 里的
 * `id` 才是业务 ID。因此：
 * - 渲染用 `fields[i].id` 作 key（现状即如此，不必改）；
 * - 生成业务 ID 必须走这里，不能复用 `fields[i].id`。
 */

/**
 * 生成一个新的条目 ID。
 *
 * 用 `crypto.randomUUID()` 而不是计数器：ID 要被持久化并在多个标签页/多次请求之间
 * 保持唯一，计数器会在并发下撞号。运行环境缺少 WebCrypto 时退回时间戳 + 随机后缀，
 * 仍然保证「一次生成、之后不变」。
 */
export function createItemId(prefix = "itm"): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) {
    return `${prefix}_${cryptoApi.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * 为表单 append 生成带身份的条目。
 *
 * 所有 array editor 的 `onAdd` 都必须经过这里，否则新增条目没有 ID，
 * 下一次 Agent 提案就会退回下标定位，重新引入 F03。
 */
export function withItemId<T extends Record<string, unknown>>(item: T): T & { id: string } {
  return { ...item, id: createItemId() };
}

/**
 * 给一份**尚不存在的**新文档补齐条目身份（导入、复制）。
 *
 * 与 `initializeItemIdentities` 的区别（两者都「补齐 ID」，但用途不同，别混用）：
 *
 * | | `initializeItemIdentities` | `withFreshItemIds` |
 * |---|---|---|
 * | 用途 | 已持久化的旧文档首次可写 | 正要创建的新文档 |
 * | ID 来源 | 确定性派生（resumeId+下标+内容哈希） | 随机 |
 * | 为什么 | CAS 失败重试必须算出**同一套** ID，否则重试变成第二次修改 | 还没有任何 ID 落库，随机即可 |
 *
 * `force` 用于复制简历：副本是一个独立的新文档，沿用源文档 ID 会让两份文档共享
 * 身份，将来跨文档比对或恢复版本时会产生难以诊断的错配。
 */
export function withFreshItemIds<T extends Record<string, unknown>>(
  content: T,
  options: { force?: boolean } = {},
): T {
  const next: Record<string, unknown> = { ...content };
  for (const section of ["experience", "projects", "education", "research"] as const) {
    const raw = next[section];
    if (!Array.isArray(raw)) continue;
    next[section] = (raw as Array<Record<string, unknown>>).map((item) => {
      if (!options.force && typeof item?.id === "string" && item.id.length > 0) return item;
      return { ...item, id: createItemId() };
    });
  }
  return next as T;
}
