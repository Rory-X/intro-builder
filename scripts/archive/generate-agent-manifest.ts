/**
 * 生成 Agent 微服务归档清单（P07 任务 1）。
 *
 * 用法：
 *   pnpm archive:agent:manifest            # 生成并写入 MANIFEST.json
 *   pnpm archive:agent:manifest --check    # 只校验，不写（CI 用）
 *
 * ## 为什么要有清单
 *
 * 归档的判据是「**缺一份 tracked 源文件即未完成**」（归档 README 明确要求）。
 * 只把文件搬过去而没有清单，就无法回答「搬全了吗」——
 * 而漏掉的文件不会报错，只会在某次「从归档恢复」时才发现。
 *
 * 因此清单记录每个文件的：
 * - `originalPath`：归档前的仓库路径；
 * - `archivePath`：归档后的路径；
 * - `gitBlob`：该文件在**基线提交**里的 blob hash（可核对内容未被篡改）；
 * - `sha256`：内容的 SHA-256（不依赖 git 的独立校验）；
 * - `reason`：为什么收它。
 *
 * ## 为什么固定基线而不是用当前 HEAD
 *
 * 归档要求「不能拿当前已改写的新 route 当旧源码归档」。基线 `050d5bb5e`
 * 是用户决定退役时的状态；此后若有修补，实现会另外记录实际退役 HEAD 与差异。
 * 用当前 HEAD 会让「归档的是哪个版本」随每次提交漂移。
 *
 * ## 不收什么
 *
 * 真实 `.env`、`node_modules`、`dist`、私钥、用户数据。
 * `.env.example` **收**（它是示例配置，不含凭据，且能解释旧服务需要哪些环境变量）。
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** 固定基线：用户决定退役时的提交。 */
const BASELINE_COMMIT = "050d5bb5e";

/** 归档根（相对仓库根）。 */
const ARCHIVE_ROOT = "archive/agent-microservice/2026-09-26";

/**
 * 归档来源：**现役路径 → 归档路径前缀**。
 *
 * 每条都有 `reason` —— 归档不是「把不用的东西扫进去」，
 * 每项都应当能回答「为什么保留它」。
 */
const SOURCES: Array<{ from: string; to: string; reason: string }> = [
  {
    from: "apps/agent",
    to: "source/apps/agent",
    reason: "旧 Agent 微服务的全部 tracked 源码、测试与部署配置",
  },
  {
    from: ".github/workflows/deploy-agent.yml",
    to: "source/.github/workflows/deploy-agent.yml",
    reason: "旧微服务的部署流水线（仅文本存档，不可自动执行）",
  },
  {
    from: "docs/agent",
    to: "source/docs/agent",
    reason: "旧路线的事实文档快照（含已失效的命令与架构）",
  },
  {
    from: "apps/web/components/agent/agent-panel.tsx",
    to: "source/apps/web/components/agent/agent-panel.tsx",
    reason: "旧 Agent 面板（AG-UI 路径的 UI 入口）",
  },
  {
    from: "apps/web/components/agent/agent-ag-ui-runtime-provider.tsx",
    to: "source/apps/web/components/agent/agent-ag-ui-runtime-provider.tsx",
    reason: "AG-UI runtime 桥接（旧面板与直连执行之间的适配层）",
  },
  {
    from: "apps/web/lib/agent/client.ts",
    to: "source/apps/web/lib/agent/client.ts",
    reason: "微服务 HTTP 客户端（签发 token 后转发）",
  },
  {
    from: "apps/web/lib/agent/token.ts",
    to: "source/apps/web/lib/agent/token.ts",
    reason: "Agent JWT 签发（旧鉴权桥）",
  },
  {
    from: "apps/web/lib/agent/secret.ts",
    to: "source/apps/web/lib/agent/secret.ts",
    reason: "Agent JWT 密钥诊断（解释旧服务需要哪些凭据）",
  },
  {
    from: "apps/web/lib/agent/direct-run-client.ts",
    to: "source/apps/web/lib/agent/direct-run-client.ts",
    reason: "直连 Run 的流式客户端（浏览器直连旧服务的路径）",
  },
  {
    from: "apps/web/lib/agent/session-store.ts",
    to: "source/apps/web/lib/agent/session-store.ts",
    reason: "会话存储（旧会话模型；新实现改用 ai_run 的 sessionId）",
  },
];

/**
 * 明确排除的模式。
 *
 * 排除规则要**显式列出**而不是靠「只收 .ts」这类白名单 ——
 * 白名单会让新增的源码类型（例如 `.proto`）被静默漏掉，
 * 而排除列表让「为什么没收它」是一个可读的决定。
 */
const EXCLUDE_PATTERNS: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /(^|\/)node_modules\//, why: "依赖目录" },
  { pattern: /(^|\/)dist\//, why: "构建产物" },
  { pattern: /(^|\/)\.next\//, why: "构建产物" },
  { pattern: /(^|\/)\.env$/, why: "真实环境变量（含凭据）" },
  { pattern: /\.pem$|\.key$|\.p12$/, why: "私钥" },
  { pattern: /(^|\/)coverage\//, why: "测试覆盖率产物" },
  { pattern: /(^|\/)__snapshots__\//, why: "快照产物（可由测试重生成）" },
];

type ManifestEntry = {
  originalPath: string;
  archivePath: string;
  gitBlob: string;
  sha256: string;
  reason: string;
};

/** 列出基线提交下某个路径的所有 tracked 文件。 */
function listTrackedFiles(pathSpec: string): string[] {
  const output = execFileSync(
    "git",
    ["ls-tree", "-r", "--name-only", BASELINE_COMMIT, "--", pathSpec],
    { encoding: "utf8" },
  );
  return output.split("\n").filter((line) => line.length > 0);
}

/** 取某个文件在基线提交里的 blob hash。 */
function blobHash(originalPath: string): string {
  const output = execFileSync("git", ["rev-parse", `${BASELINE_COMMIT}:${originalPath}`], {
    encoding: "utf8",
  });
  return output.trim();
}

/** 取某个文件在基线提交里的内容。 */
function fileContent(originalPath: string): Buffer {
  return execFileSync("git", ["show", `${BASELINE_COMMIT}:${originalPath}`]);
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function isExcluded(path: string): { excluded: boolean; why?: string } {
  for (const rule of EXCLUDE_PATTERNS) {
    if (rule.pattern.test(path)) return { excluded: true, why: rule.why };
  }
  return { excluded: false };
}

function buildManifest() {
  const entries: ManifestEntry[] = [];
  const excluded: Array<{ originalPath: string; why: string }> = [];

  for (const source of SOURCES) {
    const files = listTrackedFiles(source.from);
    if (files.length === 0) {
      /*
       * 来源为空说明**路径写错了**（或该文件在基线里不存在）。
       * 静默跳过会让「归档不完整」变成一个不报错的缺口 —— 必须显式失败。
       */
      throw new Error(`归档来源为空：${source.from}（基线 ${BASELINE_COMMIT} 下无文件）`);
    }

    for (const originalPath of files) {
      const filter = isExcluded(originalPath);
      if (filter.excluded) {
        excluded.push({ originalPath, why: filter.why ?? "匹配排除规则" });
        continue;
      }

      /*
       * 归档路径 = 来源前缀替换。
       *
       * `from` 既可能是目录也可能是单个文件：用「替换前缀」两种都成立
       * （单文件时替换结果就是 `to`）。
       */
      const suffix = originalPath.slice(source.from.length);
      entries.push({
        originalPath,
        archivePath: `${source.to}${suffix}`,
        gitBlob: blobHash(originalPath),
        sha256: sha256(fileContent(originalPath)),
        reason: source.reason,
      });
    }
  }

  return { entries, excluded };
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const { entries, excluded } = buildManifest();

  const manifest = {
    $comment:
      "Agent 微服务归档清单（P07 任务 1）。由 pnpm archive:agent:manifest 生成；" +
      "不要手工编辑。缺一份 tracked 源文件即视为归档未完成。",
    baselineCommit: BASELINE_COMMIT,
    /**
     * 实际退役 HEAD。归档时与基线相同（自基线以来 apps/agent 未改动）；
     * 若将来在退役前有修补，这里会填当时的 HEAD，并把差异另记。
     */
    retirementCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    generatedBy: "scripts/archive/generate-agent-manifest.ts",
    entryCount: entries.length,
    excludedCount: excluded.length,
    entries: entries.sort((a, b) => a.originalPath.localeCompare(b.originalPath)),
    excluded: excluded.sort((a, b) => a.originalPath.localeCompare(b.originalPath)),
  };

  const target = join(ARCHIVE_ROOT, "MANIFEST.json");
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;

  if (checkOnly) {
    /*
     * `--check` 只验证清单可生成且条目数一致，不写文件 ——
     * 供 CI 确认「清单没有因为源码变动而失效」。
     */
    const existing = (() => {
      try {
        return JSON.parse(readFileSync(target, "utf8")) as { entryCount?: number };
      } catch {
        return null;
      }
    })();
    if (!existing) {
      console.error(`清单不存在或无法解析：${target}`);
      process.exit(1);
    }
    if (existing.entryCount !== manifest.entryCount) {
      console.error(
        `清单过期：现有 ${existing.entryCount} 条，当前应为 ${manifest.entryCount} 条。` +
          `请运行 pnpm archive:agent:manifest 重新生成。`,
      );
      process.exit(1);
    }
    console.log(`ok: 清单 ${manifest.entryCount} 条，与基线 ${BASELINE_COMMIT} 一致`);
    return;
  }

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, serialized, "utf8");
  console.log(
    `ok: 写入 ${target}（${manifest.entryCount} 条，排除 ${manifest.excludedCount} 项）`,
  );
}

main();
