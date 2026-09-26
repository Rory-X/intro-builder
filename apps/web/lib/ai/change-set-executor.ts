import type { SQL } from "drizzle-orm";

/**
 * change-set 仓储的 SQL 执行器（可注入）。
 *
 * 与 `run-store` 同样的理由：让集成测试能在**隔离数据库**上跑同一套生产逻辑。
 * 直接 `import { db }` 会让测试只能 mock 返回值，那就证明不了
 * 「版本只在内容变化时递增」这类依赖真实 SQL 语义的行为。
 */
export type ChangeSetExecutor = (statement: SQL) => Promise<unknown>;
