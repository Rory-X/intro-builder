import { describe, expect, it } from "vitest";

import {
  RUN_ROUTE_ENABLED_ENV,
  isRunRouteEnabled,
  resolveRunRouteDecision,
  runRouteDisabledPayload,
} from "@/lib/ai/run-route-flag";

/**
 * 灰度开关的行为契约（P04 任务 8）。
 *
 * 这个开关保护的是「一条尚未冒烟的执行入口」。它出错的两个方向都危险：
 *
 * - **意外开启**：新链路在生产可达而没有验证过，影响面是全部用户。
 * - **意外关闭**：测试被自己的开关挡住，路由测试测不到真实行为 ——
 *   等于用开关买到了「绿灯」，但那个绿灯没有意义。
 *
 * 因此两条判据都要锁住：默认关闭（除测试环境），且**不认识的值一律按关闭处理**。
 */

describe("灰度开关的默认值", () => {
  it("未设置时默认关闭（旧链路继续服务）", () => {
    const decision = resolveRunRouteDecision({ NODE_ENV: "production" });
    expect(decision.mode).toBe("legacy");
    // 理由必须可读：排查「为什么路由不工作」时靠它。
    expect(decision.reason).toContain(RUN_ROUTE_ENABLED_ENV);
    expect(isRunRouteEnabled({ NODE_ENV: "production" })).toBe(false);
  });

  it("生产环境缺少开关时不意外打开", () => {
    expect(isRunRouteEnabled({ NODE_ENV: "production", VERCEL_ENV: "production" })).toBe(false);
    expect(isRunRouteEnabled({ NODE_ENV: "production", VERCEL_ENV: "preview" })).toBe(false);
  });

  it("测试环境恒开（否则路由测试会被开关挡住，失去意义）", () => {
    const decision = resolveRunRouteDecision({ NODE_ENV: "test" });
    expect(decision.mode).toBe("enabled");
    // 即便显式写了关闭，测试环境也不受影响 —— 测试要能测到真实行为。
    expect(isRunRouteEnabled({ NODE_ENV: "test", AI_RUN_ROUTE_ENABLED: "0" })).toBe(true);
  });
});

describe("显式开启", () => {
  it.each(["1", "true", "TRUE", "yes", "Yes", " true "])("接受 %s", (value) => {
    expect(isRunRouteEnabled({ NODE_ENV: "production", AI_RUN_ROUTE_ENABLED: value })).toBe(true);
  });

  it("理由里回显取值，便于确认生效的是哪一份配置", () => {
    const decision = resolveRunRouteDecision({
      NODE_ENV: "production",
      AI_RUN_ROUTE_ENABLED: "1",
    });
    expect(decision.mode).toBe("enabled");
    expect(decision.reason).toContain("1");
  });
});

describe("显式关闭", () => {
  it.each(["0", "false", "FALSE", "no", "no "])("接受 %s", (value) => {
    expect(isRunRouteEnabled({ NODE_ENV: "production", AI_RUN_ROUTE_ENABLED: value })).toBe(false);
  });

  it("显式关闭的理由与「未设置」可区分", () => {
    const explicit = resolveRunRouteDecision({
      NODE_ENV: "production",
      AI_RUN_ROUTE_ENABLED: "0",
    });
    const unset = resolveRunRouteDecision({ NODE_ENV: "production" });
    expect(explicit.reason).not.toBe(unset.reason);
    expect(explicit.reason).toContain("显式关闭");
  });
});

describe("无法识别的取值按关闭处理", () => {
  it.each(["maybe", "on", "off", "enable", "2", "是", "-1", "null"])(
    "%s 不会意外打开未验证的执行路径",
    (value) => {
      expect(isRunRouteEnabled({ NODE_ENV: "production", AI_RUN_ROUTE_ENABLED: value })).toBe(false);
    },
  );

  it("理由如实说明取值无法识别，而不是假装它是关闭指令", () => {
    const decision = resolveRunRouteDecision({
      NODE_ENV: "production",
      AI_RUN_ROUTE_ENABLED: "maybe",
    });
    expect(decision.mode).toBe("legacy");
    expect(decision.reason).toContain("无法识别");
  });

  it("空字符串等同于未设置", () => {
    const decision = resolveRunRouteDecision({ NODE_ENV: "production", AI_RUN_ROUTE_ENABLED: "  " });
    expect(decision.mode).toBe("legacy");
    expect(decision.reason).toContain("未设置");
  });
});

describe("关闭时的响应体", () => {
  it("用 503 语义的错误体，且明确说明是被关闭而不是不存在", () => {
    const payload = runRouteDisabledPayload();
    expect(payload.code).toBe("run_route_disabled");
    expect(payload.mode).toBe("legacy");
    // 不能含糊到让人以为「路由不存在」而去猜路径。
    expect(payload.error).toContain("未启用");
  });
});
