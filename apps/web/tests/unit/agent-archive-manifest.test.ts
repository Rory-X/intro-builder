import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Agent 微服务归档清单的完整性（P07 任务 1）。
 *
 * ## 为什么这个测试存在
 *
 * 归档 README 明确要求「**缺一份 tracked 源文件即未完成**」。
 * 但「搬全了吗」这个问题在清单之外无法回答 —— 而**漏掉的文件不会报错**，
 * 只会在某次「从归档恢复」时才发现（那时上下文早已丢失）。
 *
 * 本测试把清单变成机械约束：
 * - 每个条目在基线提交里**真实存在**，且 blob/sha256 与基线**逐字节一致**；
 * - 归档来源目录的 tracked 文件数与清单条目数**吻合**（防漏收）；
 * - 清单不含敏感文件（真实 env / 私钥）。
 *
 * ## 为什么放在 `apps/web/tests`
 *
 * 它验证的是仓库级约定（归档、脚本、基线），本可以放根 `tests/`。
 * 但根 `package.json` 的 test 脚本是 `pnpm --recursive test` ——
 * **根目录自己的测试不会被执行**，放在那里会变成一个永不运行的摆设。
 * 因此放在 `apps/web/tests/unit`（会被 `vitest run` 拾取），
 * 并用 `import.meta.dirname` 上溯到仓库根。
 */

/*
 * 仓库根：测试运行时 cwd 是 `apps/web`（vitest 在那里启动），
 * 而清单与 git 命令都相对仓库根。
 *
 * 用 `fileURLToPath(import.meta.url)` 而不是 `import.meta.dirname` ——
 * 后者在当前的 vitest 转换链里是 `undefined`（实测：路径拼成 `undefined/…`，
 * 表现为「清单不存在」）。这属于「看起来更现代但在此环境不生效」的写法，
 * 因此改成显式解析 url。
 */
/*
 * 上溯 **4 级**：`tests/unit/` → `tests/` → `apps/web/` → `apps/` → 仓库根。
 * 我第一版写了 3 级，得到的是 `apps/`（探查后确认：路径拼成
 * `apps/archive/...` 因而不存在）。
 */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const MANIFEST_PATH = join(
  REPO_ROOT,
  "archive/agent-microservice/2026-09-26/MANIFEST.json",
);

type ManifestEntry = {
  originalPath: string;
  archivePath: string;
  gitBlob: string;
  sha256: string;
  reason: string;
};

type Manifest = {
  baselineCommit: string;
  retirementCommit: string;
  entryCount: number;
  excludedCount: number;
  entries: ManifestEntry[];
  excluded: Array<{ originalPath: string; why: string }>;
};

function loadManifest(): Manifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest;
}

/** 取基线提交里某文件的内容。 */
function baselineContent(commit: string, path: string): Buffer {
  return execFileSync("git", ["show", `${commit}:${path}`], { cwd: REPO_ROOT });
}

/** 基线提交里某个路径下的 tracked 文件。 */
function baselineFiles(commit: string, pathSpec: string): string[] {
  return execFileSync("git", ["ls-tree", "-r", "--name-only", commit, "--", pathSpec], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter((line) => line.length > 0);
}

describe("清单存在且形状正确", () => {
  it("MANIFEST.json 存在", () => {
    expect(existsSync(MANIFEST_PATH)).toBe(true);
  });

  it("记录的基线提交存在（不是编的 hash）", () => {
    const manifest = loadManifest();
    expect(() =>
      execFileSync("git", ["cat-file", "-t", manifest.baselineCommit], {
        cwd: REPO_ROOT,
        encoding: "utf8",
      }),
    ).not.toThrow();
  });

  it("**entryCount 与实际条目数一致**（防手工编辑后不同步）", () => {
    const manifest = loadManifest();
    expect(manifest.entries).toHaveLength(manifest.entryCount);
  });

  it("每条都有全部必填字段（originalPath / archivePath / gitBlob / sha256 / reason）", () => {
    const manifest = loadManifest();
    for (const entry of manifest.entries) {
      expect(entry.originalPath, JSON.stringify(entry).slice(0, 80)).toBeTruthy();
      expect(entry.archivePath, entry.originalPath).toBeTruthy();
      expect(entry.gitBlob, entry.originalPath).toMatch(/^[0-9a-f]{40}$/);
      expect(entry.sha256, entry.originalPath).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.reason, entry.originalPath).toBeTruthy();
    }
  });

  it("归档路径都落在归档根下（不散落）", () => {
    const manifest = loadManifest();
    for (const entry of manifest.entries) {
      expect(entry.archivePath, entry.originalPath).toMatch(/^(source|baseline)\//);
    }
  });

  it("originalPath 无重复（重复会让「搬全了吗」失去意义）", () => {
    const manifest = loadManifest();
    const paths = manifest.entries.map((entry) => entry.originalPath);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("**逐字节与基线一致**（防篡改与漏收）", () => {
  it("每个条目的内容 hash 与基线提交相同", () => {
    const manifest = loadManifest();
    const mismatched: string[] = [];

    for (const entry of manifest.entries) {
      /*
       * 逐条核对而不是抽查：清单的价值正是「搬全且搬对」，
       * 抽查会漏掉恰好不在样本里的文件 —— 而那与不做校验没有区别。
       * 73 个文件的 git show 在本机约几百毫秒，代价可接受。
       */
      const content = baselineContent(manifest.baselineCommit, entry.originalPath);
      const sha = createHash("sha256").update(content).digest("hex");
      if (sha !== entry.sha256) mismatched.push(entry.originalPath);
    }

    expect(mismatched, `以下文件的内容与清单不符：${mismatched.join(", ")}`).toEqual([]);
  });

  it("**gitBlob 与基线一致**（不依赖 sha256 的独立校验）", () => {
    const manifest = loadManifest();
    const mismatched: string[] = [];

    for (const entry of manifest.entries) {
      const blob = execFileSync(
        "git",
        ["rev-parse", `${manifest.baselineCommit}:${entry.originalPath}`],
        { cwd: REPO_ROOT, encoding: "utf8" },
      ).trim();
      if (blob !== entry.gitBlob) mismatched.push(entry.originalPath);
    }

    expect(mismatched).toEqual([]);
  });
});

describe("**不漏收**：来源目录的文件数与清单吻合", () => {
  /**
   * 归档来源 → 归档前缀。
   *
   * 这张表必须与生成脚本的 `SOURCES` 一致。若脚本新增了来源而这里没加，
   * 下一条断言会失败（条目数对不上）—— 那正是我们想要的：
   * 「新增归档来源」必须显式记录。
   */
  const SOURCES: Array<{ from: string }> = [
    { from: "apps/agent" },
    { from: ".github/workflows/deploy-agent.yml" },
    { from: "docs/agent" },
    { from: "apps/web/components/agent/agent-panel.tsx" },
    { from: "apps/web/components/agent/agent-ag-ui-runtime-provider.tsx" },
    { from: "apps/web/lib/agent/client.ts" },
    { from: "apps/web/lib/agent/token.ts" },
    { from: "apps/web/lib/agent/secret.ts" },
    { from: "apps/web/lib/agent/direct-run-client.ts" },
    { from: "apps/web/lib/agent/session-store.ts" },
  ];

  it("**基线下这些来源的 tracked 文件总数为 73**（数目变了就是漏收或新增）", () => {
    const manifest = loadManifest();
    let total = 0;
    for (const source of SOURCES) {
      total += baselineFiles(manifest.baselineCommit, source.from).length;
    }
    // 若这里失败：新增/删除了来源文件。应当重跑 pnpm archive:agent:manifest。
    expect(total).toBe(73);
    expect(manifest.entryCount).toBe(73);
  });

  it("**apps/agent 的每个 tracked 文件都在清单里**（最容易被漏的一批）", () => {
    const manifest = loadManifest();
    const listed = new Set(manifest.entries.map((entry) => entry.originalPath));
    const missing = baselineFiles(manifest.baselineCommit, "apps/agent").filter(
      (path) => !listed.has(path),
    );
    expect(missing, `未归档：${missing.join(", ")}`).toEqual([]);
  });

  it("部署 workflow 在清单里（不能只留在 .github 下）", () => {
    const manifest = loadManifest();
    const paths = manifest.entries.map((entry) => entry.originalPath);
    expect(paths).toContain(".github/workflows/deploy-agent.yml");
  });
});

describe("不含敏感文件", () => {
  it("**清单里没有真实 .env / 私钥 / 依赖 / 构建产物**", () => {
    const manifest = loadManifest();
    const forbidden = /(^|\/)\.env$|\.pem$|\.key$|\.p12$|node_modules\/|dist\/|\.next\//;
    const violations = manifest.entries
      .map((entry) => entry.originalPath)
      .filter((path) => forbidden.test(path));
    expect(violations, `归档了不该收的文件：${violations.join(", ")}`).toEqual([]);
  });

  it("**`.env.example` 允许收**（示例配置能解释旧服务需要哪些环境变量）", () => {
    const manifest = loadManifest();
    const paths = manifest.entries.map((entry) => entry.originalPath);
    expect(paths).toContain("apps/agent/.env.example");
  });

  it("排除清单每项都带原因（「为什么没收」应当可读）", () => {
    const manifest = loadManifest();
    for (const entry of manifest.excluded) {
      expect(entry.why, entry.originalPath).toBeTruthy();
    }
  });
});

describe("退役状态诚实（还没退完）", () => {
  it("**源码尚未移入归档目录**（任务 4 才做，不能假装已完成）", () => {
    /*
     * 本提交只做任务 1（基线与清单）。`source/` 目录尚不存在 ——
     * 若这里失败，说明有人把源码搬进来了但没更新本测试与 README。
     * 那是**进展**，应当同时更新归档 README 的状态说明。
     */
    const manifest = loadManifest();
    const sourceRoot = join(REPO_ROOT, "archive/agent-microservice/2026-09-26/source");
    expect(existsSync(sourceRoot)).toBe(false);
    // 但清单已经准备好，说明「要搬什么」是明确的。
    expect(manifest.entryCount).toBeGreaterThan(0);
  });

  it("旧实现仍在现役路径（迁移前不能两处都声称存在）", () => {
    // apps/agent 仍在原位 —— 归档是「移动」，还没执行。
    expect(existsSync(join(REPO_ROOT, "apps/agent/package.json"))).toBe(true);
  });
});
