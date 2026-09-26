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
      "apps/agent/**",
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
