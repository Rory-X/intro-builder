import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * 隔离数据库集成测试（P02）。
 *
 * 与单元测试**分开**的原因：事务回滚、CAS 并发、幂等唯一性只能在真实 PostgreSQL 上
 * 被证明。mock 各条 SQL 都返回成功，什么也证明不了（见契约 §9）。
 *
 * 因此这里单列一个 config，由 `test:integration` 脚本调用，并**默认排除**在
 * `vitest run`（单元）之外 —— 否则没有数据库的 CI 环境会整片飘红。
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/integration/**/*.test.ts"],
    // 并发用例之间会互相争抢同一份测试数据；串行更慢但结论可信。
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
