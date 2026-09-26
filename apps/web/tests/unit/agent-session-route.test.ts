import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/agent/session/route";

/**
 * `GET /api/agent/session` 已退役（P07 任务 3）。
 *
 * 这条路由原本签发 Agent JWT 并把请求转发给旧微服务 `/v1/session`。
 * 它在仓库里**没有任何调用方**（组件、hooks、lib 都无引用），
 * 只有本文件在调 —— 也就是一条「为了演练而存在」的路径。
 *
 * 因此它被转成 410 stub：不转发、不重定向，只给出可观察的退役信号。
 * 这些断言替换了原先「断言它会转发」的那批（那批现在必然失败，
 * 因为它们断言的行为已按 plan 要求移除）。
 */

describe("GET /api/agent/session（已退役）", () => {
  it("**返回 410 而不是转发到旧服务**", async () => {
    const response = await GET();
    expect(response.status).toBe(410);
  });

  it("响应体含机器可读码（客户端据此分支，不匹配中文）", async () => {
    const body = (await (await GET()).json()) as Record<string, unknown>;
    expect(body.code).toBe("route_retired");
    expect(body.retiredRoute).toBe("/api/agent/session");
  });

  it("**给出替代入口与下一步动作**（不只说「下线了」）", async () => {
    const body = (await (await GET()).json()) as Record<string, unknown>;
    expect(String(body.replacement)).toContain("floating/sessions");
    expect(String(body.action).length).toBeGreaterThan(0);
  });

  it("**明确不可缓存**（退役信号必须每次真实到达）", async () => {
    expect((await GET()).headers.get("Cache-Control")).toBe("no-store");
  });

  it("**不再签 token、不再调旧客户端**（源码层核实）", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(
      join(process.cwd(), "app/api/agent/session/route.ts"),
      "utf8",
    );
    // 只允许注释里提到旧客户端（说明历史），不允许真实调用。
    const calls = source
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .filter((line) => /createAgentClient\(|signAgentToken\(/.test(line));
    expect(calls).toEqual([]);
  });
});
