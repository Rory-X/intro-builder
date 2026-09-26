import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    exclude: [
      "**/node_modules/**",
      "**/.claude/**",
      /*
       * 归档目录里的旧测试不参与现役测试运行（P07 任务 4）。
       *
       * 它们测的是已退役实现（旧会话存储、旧微服务客户端），
       * 跑起来只会因缺少已删除的模块而失败 —— 归档的价值是**可读**，
       * 不是「仍然可执行」。
       */
      "../../archive/**",
      "**/maintain-template-db.test.ts",
      // 集成测试需要真实 PostgreSQL，单列 config 与 test:integration 脚本。
      // 不排除的话，没有测试库的环境会在 `pnpm test` 里整片失败。
      "tests/integration/**",
    ],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
