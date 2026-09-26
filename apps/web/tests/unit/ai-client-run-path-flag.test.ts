import { describe, expect, it } from "vitest";

import {
  CLIENT_RUN_PATH_ENV,
  isSwitchCombinationSafe,
  resolveClientRunPath,
} from "@/lib/ai-client/run-path-flag";

/**
 * 客户端切流开关（P07 任务 3）。
 *
 * ## 为什么需要客户端开关
 *
 * 服务端的 `AI_RUN_ROUTE_ENABLED` 是**服务端私有**变量 —— 浏览器读不到。
 * 因此浮窗无法据此决定走新路径还是旧路径。没有客户端开关时只能：
 * 一次性硬切（风险最高），或客户端盲试新路径靠 503 回退
 * （多一次失败请求，用户会看到闪烁）。
 *
 * ## 最危险的组合
 *
 * | 客户端 | 服务端 | 结果 |
 * |---|---|---|
 * | on | on | 正常 |
 * | off | on | 走旧路径（新路径闲置） |
 * | **on** | **off** | **请求 503** |
 * | off | off | 走旧路径 |
 *
 * 第三行是唯一危险的组合。因此部署顺序必须是**先开服务端、再开客户端**，
 * 关闭时相反 —— 这条约束不显然，所以有专门的断言与自检函数。
 */

describe("默认行为（保守）", () => {
  it("**未设置时走旧路径**（默认关闭，打开需要显式摩擦力）", () => {
    const decision = resolveClientRunPath({});
    expect(decision.useNewPath).toBe(false);
    // 理由必须可读：排查「为什么还是旧行为」时靠它。
    expect(decision.reason).toContain(CLIENT_RUN_PATH_ENV);
  });

  it("显式 new 才切到新路径", () => {
    expect(resolveClientRunPath({ NEXT_PUBLIC_AI_RUN_PATH: "new" }).useNewPath).toBe(true);
  });

  it("显式 legacy 保持旧路径", () => {
    expect(resolveClientRunPath({ NEXT_PUBLIC_AI_RUN_PATH: "legacy" }).useNewPath).toBe(false);
  });

  it("大小写与空白不敏感", () => {
    expect(resolveClientRunPath({ NEXT_PUBLIC_AI_RUN_PATH: " NEW " }).useNewPath).toBe(true);
    expect(resolveClientRunPath({ NEXT_PUBLIC_AI_RUN_PATH: "Legacy" }).useNewPath).toBe(false);
  });

  it("**无法识别的取值按旧路径处理**（拼错的开关名不该打开未验证的路径）", () => {
    const decision = resolveClientRunPath({ NEXT_PUBLIC_AI_RUN_PATH: "nwe" });
    expect(decision.useNewPath).toBe(false);
    // 如实说明取值无法识别，而不是静默当作未设置。
    expect(decision.reason).toContain("nwe");
    expect(decision.reason).toContain("无法识别");
  });

  it("空字符串按未设置处理", () => {
    expect(resolveClientRunPath({ NEXT_PUBLIC_AI_RUN_PATH: "   " }).useNewPath).toBe(false);
  });
});

describe("测试环境恒开（否则新路径无法被单测覆盖）", () => {
  it("NODE_ENV=test 时走新路径", () => {
    const decision = resolveClientRunPath({ NODE_ENV: "test" });
    expect(decision.useNewPath).toBe(true);
    expect(decision.reason).toContain("测试环境");
  });

  it("**即便显式写了 legacy，测试环境也不受影响**（测试要能测到真实行为）", () => {
    expect(
      resolveClientRunPath({ NODE_ENV: "test", NEXT_PUBLIC_AI_RUN_PATH: "legacy" }).useNewPath,
    ).toBe(true);
  });

  it("生产环境不受测试豁免影响", () => {
    expect(resolveClientRunPath({ NODE_ENV: "production" }).useNewPath).toBe(false);
  });
});

describe("**开关组合安全性**（防 503 窗口）", () => {
  it("**客户端开、服务端关 → 不安全**（请求会拿到 503）", () => {
    const result = isSwitchCombinationSafe({
      clientUsesNewPath: true,
      serverEnabled: false,
    });
    expect(result.safe).toBe(false);
    // 理由必须给出正确的部署顺序。
    expect(result.reason).toContain("先开服务端");
  });

  it("两端都开 → 安全", () => {
    expect(
      isSwitchCombinationSafe({ clientUsesNewPath: true, serverEnabled: true }).safe,
    ).toBe(true);
  });

  it("客户端关、服务端开 → 安全（新路径闲置，无影响）", () => {
    expect(
      isSwitchCombinationSafe({ clientUsesNewPath: false, serverEnabled: true }).safe,
    ).toBe(true);
  });

  it("两端都关 → 安全（完全旧路径）", () => {
    expect(
      isSwitchCombinationSafe({ clientUsesNewPath: false, serverEnabled: false }).safe,
    ).toBe(true);
  });

  it("**只有「客户端开 + 服务端关」不安全**（穷举四种组合）", () => {
    const combinations = [
      { clientUsesNewPath: true, serverEnabled: true, expected: true },
      { clientUsesNewPath: true, serverEnabled: false, expected: false },
      { clientUsesNewPath: false, serverEnabled: true, expected: true },
      { clientUsesNewPath: false, serverEnabled: false, expected: true },
    ];
    for (const combo of combinations) {
      expect(
        isSwitchCombinationSafe(combo).safe,
        `client=${combo.clientUsesNewPath} server=${combo.serverEnabled}`,
      ).toBe(combo.expected);
    }
  });
});

describe("纯函数性质", () => {
  it("同输入同输出", () => {
    const env = { NEXT_PUBLIC_AI_RUN_PATH: "new" };
    expect(resolveClientRunPath(env)).toEqual(resolveClientRunPath(env));
  });

  it("不改动传入的 env 对象", () => {
    const env = { NEXT_PUBLIC_AI_RUN_PATH: "new" };
    const snapshot = JSON.stringify(env);
    resolveClientRunPath(env);
    expect(JSON.stringify(env)).toBe(snapshot);
  });
});
