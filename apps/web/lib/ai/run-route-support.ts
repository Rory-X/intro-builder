import type { RunEventType } from "@intro-builder/shared/types";

import { ARG_SCHEMAS } from "./tools/arg-schemas";
import { buildAllToolDeclarations } from "./tools/resume-tools";
import { buildToolRegistry } from "./tools/registry";

/**
 * 启动路由的两块纯逻辑（P04 任务 2 + 6）。
 *
 * 单独成模块而不是留在 `app/api/ai/runs/route.ts` 里，原因是**硬约束**：
 * Next.js 的 Route 文件只允许导出 HTTP 方法（GET/POST/…）与少数约定字段，
 * 导出普通函数会让 `next build` 直接失败 ——
 * 报 `"xxx" is not a valid Route export field`。
 *
 * 注意 `pnpm typecheck` **不会**发现这个问题（它只看类型），只有 `pnpm build`
 * 会。因此本模块的存在本身也是「DoD 必须跑 build」的一个例证。
 */

/**
 * 把已注册工具构造成交给 AI SDK 的工具集。
 *
 * **刻意不设置 `execute`**。SDK 的行为已实测确认：`streamText` 遇到带
 * `execute` 的工具会自己执行它（SDK 内部 `executeToolCall` 开头即
 * `if (tool.execute == null) return undefined;`，之后
 * `Promise.all(... tool.execute(...))`）。若这里也提供 `execute`，
 * 同一次工具调用会被执行两遍 —— 编排层一遍、SDK 一遍 ——
 * 产生两份提案、两套事件，而其中一套完全绕过 fencing 与事件落库。
 *
 * 只注册**可用**工具（能力矩阵 `available: true`），并携带真实参数 schema，
 * 让模型知道每个工具的形状。不使用占位工具：注册一个永远返回 unavailable
 * 的工具会让模型反复尝试同一件做不到的事。
 */
export function buildSdkTools(): Record<string, unknown> {
  const registry = buildToolRegistry(buildAllToolDeclarations());
  const tools: Record<string, unknown> = {};

  for (const [name, declaration] of registry) {
    const schema = ARG_SCHEMAS[name];
    if (!schema) continue;
    tools[name] = {
      description: declaration.description,
      inputSchema: schema,
    };
  }
  return tools;
}

/**
 * attempt 的结束类型 → Run 行状态。
 *
 * 显式映射而不是「去掉前缀」这类字符串技巧：两者是**不同的概念**
 * （attempt 结束 = 这次连接结束；Run 状态 = 整个任务的状态），
 * 而且 `waiting_user` 恰恰是「任务没结束、等用户回答」的情形。
 *
 * 关键区分（契约 §P04 任务 5）：
 * - `run.interrupted` → `interrupted`，**不是** completed。
 *   没有结束事件的 EOF 绝不能推断为完成，否则 UI 会对被截断的执行显示「已完成」。
 * - `run.cancelled` → `cancelled`。用户取消后即使流里出现过完成迹象，结论也是取消。
 * - `run.waiting_user` → `waiting_user`：这不是终态，用户可以 continue。
 */
export function runStatusForEndType(
  endType: RunEventType,
): "completed" | "failed" | "cancelled" | "interrupted" | "waiting_user" {
  switch (endType) {
    case "run.completed":
      return "completed";
    case "run.failed":
      return "failed";
    case "run.cancelled":
      return "cancelled";
    case "run.waiting_user":
      return "waiting_user";
    case "run.interrupted":
      return "interrupted";
    default:
      /*
       * 非结束类事件出现在这里说明编排层违反了「一个 attempt 一个结束事件」。
       * 按最保守的方式处理：记为 interrupted（不推断完成），而不是放行。
       */
      return "interrupted";
  }
}
