import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/agent/messages/route";

/**
 * `POST /api/agent/messages` 已退役（P07 任务 3）。
 *
 * 这条路由原本签发 Agent JWT 并把 AG-UI 消息转发给旧微服务。
 * 它在仓库里**没有任何调用方** —— 浮窗走 `/api/agent/floating/chat`，
 * 面板走 `/api/agent/direct-runs`，它自己是第三条只被测试调用的路径。
 *
 * 退役它的意义不只是「少一个入口」：新入口 `POST /api/ai/runs` 提供这条旧路径
 * 不具备的东西 —— 事件落库（刷新可恢复）、幂等（同 requestId 不二次调模型）、
 * 写租约与 fence（不并发写）、原子提交与回执（模型完成 ≠ 已保存）。
 * 也就是说：**去掉的是一条不受保护的写入路径**。
 */

describe("POST /api/agent/messages（已退役）", () => {
  it("**返回 410 而不是转发到旧服务**", async () => {
    const response = await POST();
    expect(response.status).toBe(410);
  });

  it("响应体给出统一 Run 入口作为替代", async () => {
    const body = (await (await POST()).json()) as Record<string, unknown>;
    expect(body.code).toBe("route_retired");
    expect(body.retiredRoute).toBe("/api/agent/messages");
    expect(String(body.replacement)).toContain("/api/ai/runs");
  });

  it("**退役响应与旧实现无关：不再需要鉴权、不再读库**", async () => {
    /*
     * 旧实现在缺会话时返回 401、在简历不属于用户时返回 404。
     * 退役后这些分支都不存在 —— 无论谁调、带什么 body，都得到 410。
     * 这正是「不再有可达的旧业务逻辑」的直接证据。
     */
    expect((await POST()).status).toBe(410);
  });

  it("不可缓存", async () => {
    expect((await POST()).headers.get("Cache-Control")).toBe("no-store");
  });

  it("源码层确认无旧服务调用", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(
      join(process.cwd(), "app/api/agent/messages/route.ts"),
      "utf8",
    );
    const calls = source
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .filter((line) => /createAgentClient\(|signAgentToken\(/.test(line));
    expect(calls).toEqual([]);
  });
});
