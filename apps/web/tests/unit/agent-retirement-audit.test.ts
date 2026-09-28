import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readAgentSurface } from "@/lib/agent/surface";

/**
 * 微服务退役审计（P07 任务 2 的机械化版本）。
 *
 * ## 为什么要有这个测试
 *
 * plan 的任务 2 要求「完成能力矩阵……预览环境完全不配置 Agent URL/JWT/Redis
 * 仍可使用；删除请求 fallback，不以旧服务兜底掩盖缺能力」。
 *
 * 但「能力矩阵已完成」如果只写在文档里，它就是一个**主张**而不是**事实**：
 * 没有任何东西阻止下一个人在新增一条路径时又去调旧服务。
 * 因此把它做成**棘轮（ratchet）测试**：
 *
 * - 下面列出的旧服务调用点集合是**当前已知的全部**；
 * - 新增一个调用点 → 测试失败（必须显式加进清单，也就是「承认欠了一笔债」）；
 * - 减少一个 → 也必须更新清单（也就是「记录还款」）。
 *
 * 这样「还欠多少」始终是可读的数字，而不是需要考古的猜测。
 *
 * ## 这个测试**不**断言「应该为零**
 *
 * 因为当前确实不为零 —— 存在 3 个可达的旧服务调用点与一条默认开启的旧 UI 路径。
 * 断言零会立刻失败，然后被人改成 `skip`；那比诚实列出更好看的假象有害得多。
 *
 * 真正断言的是：**集合恰好等于清单**。清单缩短是进展，意外增长是警报。
 */

const WEB_ROOT = join(process.cwd());

/** 读取一个仓库内文件（相对 `apps/web`）。 */
function read(relativePath: string): string {
  return readFileSync(join(WEB_ROOT, relativePath), "utf8");
}

/**
 * 判断一行是否是**真实的调用**（而非注释或文档说明）。
 *
 * 必要性：润色与 helpers 路由的注释里都提到了 `signAgentToken` /
 * `createAgentClient`（说明「已完全移除」）。若不做这个区分，
 * 审计会把它们误报成仍在使用。
 */
function isRealCall(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
    return false;
  }
  /*
   * **定义处不算「调用」**，但要单独识别 —— 那三个模块（client / token /
   * direct-run-client）本身就是待归档的旧实现。
   *
   * 这个区分不是洁癖：全树扫描的第一版把 `export function createAgentClient(`
   * 也算成了调用点，于是清单里「调用点」的数字混入了「定义处」。
   * 两者要归档的动作不同（删调用 vs 删模块），混在一起会让余额不可读。
   */
  if (/export\s+(async\s+)?function\s+(createAgentClient|signAgentToken)\b/.test(trimmed)) {
    return false;
  }
  return /createAgentClient\(|signAgentToken\(/.test(trimmed);
}

/** 是否是旧客户端的**定义处**（模块本身待归档）。 */
function isLegacyDefinition(line: string): boolean {
  return /export\s+(async\s+)?function\s+(createAgentClient|signAgentToken)\b/.test(
    line.trim(),
  );
}

/** 找出全树里的旧客户端定义处。 */
function scanLegacyDefinitions(): Record<string, number[]> {
  const found: Record<string, number[]> = {};
  for (const relativePath of listSourceFiles("app").concat(
    listSourceFiles("components"),
    listSourceFiles("lib"),
    listSourceFiles("hooks"),
  )) {
    const lines = read(relativePath)
      .split("\n")
      .map((line, index) => ({ line, index: index + 1 }))
      .filter(({ line }) => isLegacyDefinition(line))
      .map(({ index }) => index);
    if (lines.length > 0) found[relativePath] = lines;
  }
  return found;
}

/** 扫描一个文件里的旧服务调用点（返回行号）。 */
function findLegacyCalls(relativePath: string): number[] {
  const lines = read(relativePath).split("\n");
  return lines
    .map((line, index) => ({ line, index: index + 1 }))
    .filter(({ line }) => isRealCall(line))
    .map(({ index }) => index);
}

/**
 * 递归列出 `apps/web` 下的源码文件（跳过构建产物与测试）。
 *
 * **必须全树扫描，而不是只扫清单里列出的文件。**
 *
 * 我第一版只遍历 `KNOWN_LEGACY_CALL_SITES` 的键 —— 那有个致命缺口：
 * 有人在**新文件**里写 `createAgentClient()` 时，测试一个都扫不到，
 * 于是棘轮形同虚设（它只能发现「已列出的文件里数量变了」）。
 * 全树扫描才能真正拦住「新增一条旧服务调用」。
 */
function listSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(join(WEB_ROOT, dir), { withFileTypes: true })) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      // 跳过构建产物、依赖与测试 —— 它们不是运行时代码。
      if ([".next", "node_modules", "tests"].includes(entry.name)) continue;
      listSourceFiles(relative, acc);
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry.name)) acc.push(relative);
  }
  return acc;
}

/** 全树里所有含旧服务调用的文件 → 行号。 */
function scanAllLegacyCalls(): Record<string, number[]> {
  const found: Record<string, number[]> = {};
  for (const relativePath of listSourceFiles("app").concat(
    listSourceFiles("components"),
    listSourceFiles("lib"),
    listSourceFiles("hooks"),
  )) {
    const lines = findLegacyCalls(relativePath);
    if (lines.length > 0) found[relativePath] = lines;
  }
  return found;
}

/**
 * **已知的旧服务调用点**。
 *
 * 这个清单就是「欠债余额」：每一项都必须在 P07 任务 3/4 里被消除
 * （切到 `/api/ai/runs` 或直接删除）。
 */
const KNOWN_LEGACY_CALL_SITES: Record<string, string[]> = {
  /*
   * panel 的 `/api/agent/direct-runs` 已改为在 Next.js 里执行统一 Run，
   * 不再签发 JWT，客户端也不再跟随 streamUrl。因此这里没有调用点。
   *
   * 空对象是有意的：全树扫描仍会把新出现的 `signAgentToken()` /
   * `createAgentClient()` 算进来，和这份清单对不上就会失败。
   */
};

/**
 * **已退役的路由**（转 410 stub，不再调旧服务）。
 *
 * 与上面的清单分开记账：这些路径的「旧服务调用」已经消除，
 * 但它们自己还留着 stub（为了给出可观察的退役信号）。
 *
 * 之所以能先退役这两条：它们在仓库里**零消费方**（除自己的测试）——
 * `session` 是演练用的会话探针，`messages` 是第三条转发路径。
 * `direct-runs` 仍有活路径（显式 panel），执行已在 Next.js，不在这份退役清单里。
 */
const RETIRED_AGENT_ROUTES = [
  "app/api/agent/session/route.ts",
  "app/api/agent/messages/route.ts",
];

/**
 * **待归档的旧客户端模块**（定义处）。
 *
 * 与调用点分开记账：调用点消除 = 把某条路径切到新实现；
 * 模块消失 = 调用点全部消除后才能删的东西。
 */
const KNOWN_LEGACY_MODULES = [
  /*
   * `lib/agent/client.ts` 已从清单移除 —— 它被**归档移除**了
   * （P07 任务 4）。清单记的是「现役目录里还剩哪些旧客户端」，
   * 已移走的模块不该继续占位（否则这条断言永远拦不下真正的回归，
   * 而会先因为文件不存在而报错）。
   *
   * 移走它之前先做的是：把两个按钮仍需要的 4 个**类型**迁到
   * 现役能力模块（`lib/ai/capabilities/*` 自己已定义了等价类型，
   * 只是 button 的 import 忘了跟着改）。
   */
  "lib/agent/token.ts",
];

describe("旧客户端模块（定义处）", () => {
  it("**恰好还剩 token 模块**（新增旧客户端会被拦下）", () => {
    const found = scanLegacyDefinitions();
    expect(Object.keys(found).sort()).toEqual([...KNOWN_LEGACY_MODULES].sort());
  });

  it("token 模块确实存在（防路径拼写错误）", () => {
    for (const relativePath of KNOWN_LEGACY_MODULES) {
      expect(() => read(relativePath), relativePath).not.toThrow();
    }
  });

  it("**lib/agent/client.ts 已归档移除**（不在现役目录里）", () => {
    /*
     * 反向确认：它不该在现役目录里复活。
     *
     * 这条断言与上面那条互为约束 —— 上面说「恰好这两个」，
     * 这条说「第三个确实走了」。少了任何一条，回归都可能悄悄发生
     * （例如有人为了让某个旧 import 编译通过而把它放回来）。
     */
    expect(() => read("lib/agent/client.ts")).toThrow();
  });
});

describe("旧服务调用点清单（棘轮）", () => {
  it("**全树扫描：实际调用点恰好等于已知清单**（新增与减少都会被拦下）", () => {
    const found = scanAllLegacyCalls();
    const actual: Record<string, number> = {};
    for (const [path, lines] of Object.entries(found)) actual[path] = lines.length;

    const expected: Record<string, number> = {};
    for (const [path, symbols] of Object.entries(KNOWN_LEGACY_CALL_SITES)) {
      expected[path] = symbols.length;
    }

    /*
     * 全树扫描的意义：**新文件里的调用也会被算进来**。
     *
     * 第一版只遍历清单的键，于是「在新文件里加 createAgentClient()」
     * 完全不会被发现 —— 棘轮形同虚设。现在任何新增都会让这里失败，
     * 而失败信息里带行号，便于直接定位。
     */
    expect(actual, "旧服务调用点与已知清单不一致（详看错误信息）").toEqual(expected);
  });

  it("扫描确实覆盖了源码树（防「零命中」被误读为「已清干净」）", () => {
    /*
     * 若 listSourceFiles 因为路径写错而返回空数组，上面那条断言会因为
     * actual = {} 而失败 —— 但那时的失败原因（路径错）与真实语义
     * （没有旧调用了）难以区分。这条断言把「扫描确实在工作」独立钉住。
     */
    const scanned = listSourceFiles("app").concat(
      listSourceFiles("components"),
      listSourceFiles("lib"),
    );
    expect(scanned.length).toBeGreaterThan(100);
    // 且确实扫到了已知含调用的文件。
    expect(scanned).toContain("app/api/agent/session/route.ts");
  });

  it("清单里的文件都真实存在（防拼写错误导致漏检）", () => {
    for (const relativePath of Object.keys(KNOWN_LEGACY_CALL_SITES)) {
      expect(() => read(relativePath), relativePath).not.toThrow();
    }
  });

  it("**已 Web 化的路由不再有真实调用**（只有注释提到旧客户端）", () => {
    // 这两个路由在 P05 已迁到 Web 侧，注释里说明「已完全移除」。
    // 审计必须能把它们与「仍在使用」区分开 —— 否则会误报。
    for (const relativePath of [
      "app/api/agent/rich-text/polish/route.ts",
      "app/api/agent/resume/helpers/[helperId]/route.ts",
    ]) {
      const source = read(relativePath);
      // 文件里确实提到这些名字（注释形式）。
      expect(source).toMatch(/createAgentClient|signAgentToken/);
      // 但没有任何真实调用。
      expect(findLegacyCalls(relativePath), relativePath).toEqual([]);
    }
  });
});

describe("已退役路由：410 stub 而非转发", () => {
  it("**退役路由不再调用旧服务**（调用点已消除）", () => {
    for (const relativePath of RETIRED_AGENT_ROUTES) {
      expect(findLegacyCalls(relativePath), relativePath).toEqual([]);
    }
  });

  it("**退役路由返回统一形状的 410**（客户端可据此分支）", async () => {
    const { retiredAgentRouteResponse } = await import("@/lib/agent/retired-route");
    const response = retiredAgentRouteResponse({
      route: "/api/agent/session",
      replacement: "某替代入口",
    });
    expect(response.status).toBe(410);
    // 不该被缓存 —— 退役信号必须每次真实到达。
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("410 响应体含机器可读码与替代入口（不靠匹配中文）", async () => {
    const { retiredAgentRouteResponse } = await import("@/lib/agent/retired-route");
    const body = (await retiredAgentRouteResponse({
      route: "/api/agent/messages",
      replacement: "统一 Run 入口",
    }).json()) as Record<string, unknown>;
    expect(body.code).toBe("route_retired");
    expect(body.retiredRoute).toBe("/api/agent/messages");
    expect(body.replacement).toBe("统一 Run 入口");
    // 给出下一步动作，而不是只说「下线了」。
    expect(typeof body.action).toBe("string");
    expect(String(body.action).length).toBeGreaterThan(0);
  });

  it("**退役路由源码里没有重定向**（plan 明确禁止重定向到旧服务）", () => {
    for (const relativePath of RETIRED_AGENT_ROUTES) {
      const source = read(relativePath);
      expect(source, relativePath).not.toMatch(/redirect\s*\(/);
      expect(source, relativePath).not.toMatch(/AGENT_BASE_URL/);
    }
  });

  it("有活路径的路由**不**在退役清单里（防止误退役）", () => {
    // direct-runs 有活路径（默认 panel surface → AG-UI runtime）。
    expect(RETIRED_AGENT_ROUTES).not.toContain("app/api/agent/direct-runs/route.ts");
  });
});

describe("默认 UI 路径（关键的诚实性）", () => {
  it("**默认 surface 是 floating**（已翻转，默认用户不再走 direct-runs）", () => {
    /*
     * P07 任务 3 的翻转已完成：默认 `floating`。
     * panel 的 `/api/agent/direct-runs` 现在也在 Next.js 里执行统一 Run，
     * 不再签发 JWT，调用点余额是 0。
     */
    expect(readAgentSurface({})).toBe("floating");
  });

  it("浮窗需要显式配置才启用（默认不启用）", () => {
    expect(readAgentSurface({ AGENT_ASSISTANT_SURFACE: "floating" })).toBe("floating");
    expect(readAgentSurface({ NEXT_PUBLIC_AGENT_ASSISTANT_SURFACE: "floating" })).toBe("floating");
  });

  it("**取值不认识时回落到 floating 而不是报错**（拼错不该留在退役路径上）", () => {
    /*
     * 与 `panel` 时代相反，而这是有意的：`panel` 会走 `direct-runs`
     * 拼错的开关名不该把用户留在一条没人预期的路径上。
     */
    expect(readAgentSurface({ AGENT_ASSISTANT_SURFACE: "weird" })).toBe("floating");
  });

  it("editor-client 在非 floating 模式下确实渲染旧 AgentPanel", () => {
    const source = read("app/(app)/resume/[id]/edit/editor-client.tsx");
    // 两个 surface 分支都存在（浮动与面板），说明切换点是真实的。
    expect(source).toContain("isAgentMode && !useFloatingAgent");
    expect(source).toContain("useFloatingAgent && isFloatingAgentDocked");
  });
});

describe("能力矩阵：哪些已经 Web 自足", () => {
  /**
   * 已经**完全不依赖**旧服务的能力（各自有测试覆盖）。
   *
   * 这张表的用途：切流时只需关心清单里剩下的调用点，
   * 不需要重新核实这些能力。
   */
  const WEB_NATIVE_ROUTES = [
    // 润色（P05 迁移）。
    "app/api/agent/rich-text/polish/route.ts",
    // 诊断与模块建议（P05 迁移）。
    "app/api/agent/resume/helpers/[helperId]/route.ts",
    // 统一 Run 入口（P04）。
    "app/api/ai/runs/route.ts",
    // Run 状态与继续（P04）。
    "app/api/ai/runs/[runId]/route.ts",
    "app/api/ai/runs/[runId]/continue/route.ts",
    // 变更集决策（P04）。
    "app/api/ai/change-sets/[changeSetId]/decisions/route.ts",
    // 浮窗的模型列表与会话（Web 自足）。
    "app/api/agent/floating/models/route.ts",
    "app/api/agent/floating/sessions/route.ts",
    "app/api/agent/floating/sessions/[sessionId]/route.ts",
  ];
  /*
   * 曾经列在这里的 `app/api/agent/sessions/route.ts` 已**退役为 410**
   * （零消费方 + 旧会话模型被 `ai_run.sessionId` 替代）。
   * 它不是「Web 自足能力」，而是退役 stub —— 不再属于本清单。
   */

  it("**这些路由都不含旧服务调用**（能力矩阵里的「已 Web 化」部分）", () => {
    for (const relativePath of WEB_NATIVE_ROUTES) {
      expect(findLegacyCalls(relativePath), relativePath).toEqual([]);
    }
  });

  it("清单里的文件都存在（防路径拼写错误导致假绿）", () => {
    for (const relativePath of WEB_NATIVE_ROUTES) {
      expect(() => read(relativePath), relativePath).not.toThrow();
    }
  });

  it("**未配置 Agent URL / JWT / Redis 时，已 Web 化的能力不读这些配置**", () => {
    /*
     * plan 要求「预览环境完全不配置 Agent URL/JWT/Redis 仍可使用」。
     * 对已 Web 化的路由来说，可行性的判据是它们**根本不引用**这些配置键 ——
     * 引用而不校验会让「未配置」在运行时才暴露。
     */
    const legacyConfigKeys = [
      "AGENT_BASE_URL",
      "AGENT_PUBLIC_BASE_URL",
      "COLLAB_JWT_SECRET",
      "REDIS_URL",
    ];
    for (const relativePath of WEB_NATIVE_ROUTES) {
      const source = read(relativePath);
      for (const key of legacyConfigKeys) {
        // 允许在注释里提及（说明历史），但不允许作为配置读取。
        const referenced = new RegExp(`process\\.env\\.${key}|process\\.env\\[["']${key}`).test(source);
        expect(referenced, `${relativePath} 引用了 ${key}`).toBe(false);
      }
    }
  });
});

describe("还剩多少（可读的余额）", () => {
  it("**未完成的调用点数量是可读的**（不靠考古）", () => {
    const total = Object.values(KNOWN_LEGACY_CALL_SITES).reduce(
      (sum, symbols) => sum + symbols.length,
      0,
    );
    /*
     * 这个断言的作用不是「检查数字」，而是**把余额写进测试输出**：
     * `pnpm test` 的失败信息/日志里能看到它。
     *
     * 切流时这个数字会逐次下降；降到 0 时应当把旧客户端与 token 模块
     * 一起归档（P07 任务 4）。
     */
    expect(total).toBe(0);
  });
});
