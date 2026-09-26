import { defineConfig } from "vitest/config";

/**
 * partykit 自己的 vitest 配置。
 *
 * 必须显式存在：合并 zoo/main 时引入的**仓库根** `vitest.config.ts` 里有
 * `setupFiles: ["./tests/setup.ts"]`，而 vitest 的配置查找会向上冒泡 ——
 * 没有本文件的 partykit 会继承那份配置，把它解析成
 * `apps/partykit/tests/setup.ts`（不存在），于是整包测试直接加载失败。
 *
 * 这里只声明 partykit 自身的测试范围，不从根继承任何 setupFiles。
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
});
