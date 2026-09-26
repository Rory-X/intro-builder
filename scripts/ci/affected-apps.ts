/**
 * Decide which production apps a push actually affects.
 *
 * Why this exists: `paths:` triggers cannot express "this root file matters to
 * app X but not app Y". `pnpm-lock.yaml`, `package.json` and
 * `pnpm-workspace.yaml` are monorepo-wide, so any edit to them matched all
 * the deploy workflows — even when the edit could not change a given app's
 * artifact. Real examples from `main` history:
 *
 *   - 971fc3f3c added root `scripts` entries; rebuilt Agent and PartyKit.
 *   - f968d22b6 added `verifyDepsBeforeRun: false`; rebuilt both again.
 *   - 51be46358 rewrote root eslint peer strings in the lockfile; the
 *     `apps/agent` importer block was byte-identical, yet Agent redeployed.
 *
 * This module answers the narrower question from evidence (which files changed,
 * which lockfile importers changed) and the workflows gate on the answer.
 *
 * Fail-safe rule: a change this module cannot positively classify deploys
 * everything. The gate may only ever SUPPRESS a deploy it understands.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

/**
 * 需要部署的 app 维度。
 *
 * `agent` 维度已移除（P07 任务 4）：旧微服务的源码与部署流水线都已归档，
 * 它**不再有部署目标**。留着一个永远为 false 的维度会让 `emit` 输出
 * 一个没人消费的 `agent=...`，并让「恰好三个 app」这类断言名不副实。
 */
export type AffectedApps = {
  web: boolean;
  partykit: boolean;
};

export type FilePair = { before: string; after: string };

export type AffectedAppsInput = {
  /** Repo-relative paths changed by the push. */
  changedPaths: string[];
  /** Root `package.json` before/after. Omit when it did not change. */
  rootPackage?: FilePair;
  /** `pnpm-workspace.yaml` before/after. Omit when it did not change. */
  workspaceConfig?: FilePair;
  /** `pnpm-lock.yaml` before/after. Omit when it did not change. */
  lockfile?: FilePair;
};

const ALL: AffectedApps = { web: true, partykit: true };
const NONE: AffectedApps = { web: false, partykit: false };

/** Root files that are handled explicitly rather than by prefix. */
const HANDLED_ROOT_FILES = new Set([
  "package.json",
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  ".dockerignore",
  ".gitignore",
  ".vercelignore",
  "vercel.json",
]);

/** A workspace member's manifest — a change here can move what that app installs. */
const WORKSPACE_MANIFEST = /^(apps|packages)\/([^/]+)\/package\.json$/;

/**
 * Workspace members whose manifest is consumed by which apps.
 *
 * `packages/config` is an empty placeholder no package depends on (verified:
 * it declares no files and nothing references `@intro-builder/config`), so its
 * version bump cannot change any artifact.
 */
function appsForWorkspaceMember(member: string): (keyof AffectedApps)[] | null {
  switch (member) {
    case "web":
      return ["web"];
    case "partykit":
      return ["partykit"];
    // Web and PartyKit both import @intro-builder/shared.
    case "shared":
      return ["web", "partykit"];
    case "config":
      return [];
    default:
      return null;
  }
}

/** Root package.json keys that cannot change a deployed artifact. */
const INERT_ROOT_KEYS = new Set([
  "name",
  "version",
  "private",
  "description",
  "license",
  "author",
  "repository",
  "scripts",
]);

/** pnpm-workspace.yaml keys that can change dependency resolution. */
const RESOLUTION_WORKSPACE_KEYS = new Set(["packages", "catalog", "catalogs"]);

/** Paths that never ship in any artifact. */
const INERT_PREFIXES = [
  "docs/",
  "scripts/",
  "prototypes/",
  "template-studio-skill/",
  "lessons/",
  ".agents/",
  ".playwright-mcp/",
  /*
   * **归档是只读历史快照**（P07 任务 4），不在任何工作区成员里，
   * 也不参与构建 —— 改动它不可能改变任何产物。
   *
   * 不列它会踩 failSafe：那会把「加一条归档笔记」判成未知变更，
   * 于是**三个 app 全部触发生产部署**。实测确认过这个行为
   * （archive 下的任意路径 → {web:true, agent:true, partykit:true}）。
   */
  "archive/",
  // CI configuration cannot change a deployed artifact. The two deploy
  // workflows are matched by filename earlier in the loop, so putting the
  // whole `.github/` tree here does not make them inert.
  ".github/",
];

/**
 * Files under these paths are inert regardless of extension, but a change to
 * the *package manifest* of a workspace member still matters — so they are
 * matched as exact filenames rather than prefixes.
 */
const INERT_BASENAMES = new Set([
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  "CHANGELOG.md",
  "HANDOFF.md",
  "journal.md",
  "需求清单.md",
  "IMPLEMENTATION_SUMMARY.md",
  "MONOREPO_REFACTOR_SUMMARY.md",
  "REFACTOR_COMPLETE.md",
]);

/**
 * pnpm v9 lockfile importer name -> that importer's body text.
 *
 * Only the `importers:` section is read. A `snapshots:`-only rewrite (peer
 * resolution strings, for example) cannot change what an app installs unless
 * its own importer moved with it, so trusting importers avoids exactly the
 * 51be46358 false positive.
 */
export function parseLockfileImporters(text: string): Map<string, string> {
  const blocks = new Map<string, string[]>();
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trimEnd() === "importers:");
  if (start === -1) return new Map();

  let current: string | null = null;
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") continue;
    // A non-indented line means the importers section ended.
    if (!line.startsWith(" ")) break;

    const header = /^ {2}(\S+):(.*)$/.exec(line);
    if (header) {
      current = header[1];
      const inline = header[2].trim();
      blocks.set(current, inline ? [inline] : []);
      continue;
    }

    if (current !== null) blocks.get(current)?.push(line.trimEnd());
  }

  return new Map([...blocks].map(([name, body]) => [name, body.join("\n")]));
}

/** Top-level `key: value` blocks of a simple YAML file. */
export function parseTopLevelBlocks(text: string): Map<string, string> {
  const blocks = new Map<string, string[]>();
  let current: string | null = null;

  for (const line of text.split("\n")) {
    const header = /^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/.exec(line);
    if (header) {
      current = header[1];
      blocks.set(current, [header[2].trimEnd()]);
      continue;
    }
    if (current !== null) blocks.get(current)?.push(line.trimEnd());
  }

  return new Map([...blocks].map(([key, body]) => [key, body.join("\n").trimEnd()]));
}

function changedKeys(before: Map<string, string>, after: Map<string, string>): string[] {
  const keys = new Set([...before.keys(), ...after.keys()]);
  return [...keys].filter((key) => before.get(key) !== after.get(key)).sort();
}

function changedJsonKeys(pair: FilePair): string[] | null {
  let before: Record<string, unknown>;
  let after: Record<string, unknown>;
  try {
    before = JSON.parse(pair.before) as Record<string, unknown>;
    after = JSON.parse(pair.after) as Record<string, unknown>;
  } catch {
    // Unparseable means we cannot reason about it — fail safe.
    return null;
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .sort();
}

/** Which apps consume a given lockfile importer. */
function appsForImporter(name: string): (keyof AffectedApps)[] {
  switch (name) {
    case "apps/web":
      return ["web"];
    case "apps/partykit":
      return ["partykit"];
    // packages/shared is imported by both Web and PartyKit.
    case "packages/shared":
      return ["web", "partykit"];
    // The root importer carries the Next.js version pinned for Vercel's
    // framework detection (see tests/unit/vercel-monorepo-config.test.ts).
    case ".":
      return ["web"];
    default:
      return [];
  }
}

export function resolveAffectedApps(input: AffectedAppsInput): AffectedApps {
  const result: AffectedApps = { ...NONE };
  let failSafe = false;

  const merge = (apps: (keyof AffectedApps)[]) => {
    for (const app of apps) result[app] = true;
  };

  for (const raw of input.changedPaths) {
    const path = raw.replace(/^\.\//, "");

    if (path.startsWith("apps/web/")) {
      result.web = true;
      continue;
    }
    if (path.startsWith("apps/partykit/")) {
      result.partykit = true;
      continue;
    }
    /*
     * `apps/agent/` 是**已退役**的旧服务（P07 任务 4 归档）。
     *
     * 必须显式拦下它，否则这些路径会掉进下面的 failSafe ——
     * 而归档那个 PR 的 diff **恰好全是这些删除路径**，
     * 于是「把旧服务归档」这件事本身会触发 web 与 partykit 的
     * 生产部署。那既浪费又危险（为一次纯粹的删除而重新发布两个服务）。
     */
    if (path.startsWith("apps/agent/")) {
      continue;
    }
    // PartyKit and Web both import @intro-builder/shared; Agent does not.
    if (path.startsWith("packages/shared/")) {
      merge(["web", "partykit"]);
      continue;
    }
    // A workspace member manifest moves that member (and its dependants).
    const manifest = WORKSPACE_MANIFEST.exec(path);
    if (manifest) {
      const apps = appsForWorkspaceMember(manifest[2]);
      if (apps === null) {
        failSafe = true;
      } else {
        merge(apps);
      }
      continue;
    }
    // Any other file in a workspace package ships in that package's artifact.
    if (path.startsWith("packages/")) {
      failSafe = true;
      continue;
    }
    // A workflow change redeploys only the service that workflow ships.
    if (path.startsWith(".github/workflows/")) {
      if (path.endsWith("deploy-partykit.yml")) result.partykit = true;
      continue;
    }
    if (HANDLED_ROOT_FILES.has(path)) continue;
    if (INERT_BASENAMES.has(path.split("/").pop() ?? "")) continue;
    if (INERT_PREFIXES.some((prefix) => path.startsWith(prefix))) continue;

    // Everything else is unknown to this gate: deploy it all rather than
    // risk skipping a production deploy.
    failSafe = true;
  }

  if (failSafe) return { ...ALL };

  // A root package.json edit matters only when it moves something an install
  // consumes. `scripts` is inert: no app script calls a root script.
  if (input.rootPackage) {
    const keys = changedJsonKeys(input.rootPackage);
    if (keys === null) return { ...ALL };
    if (keys.some((key) => !INERT_ROOT_KEYS.has(key))) return { ...ALL };
  }

  // pnpm-workspace.yaml matters only when workspace membership or catalog
  // resolution changed; runtime settings like `verifyDepsBeforeRun` do not.
  if (input.workspaceConfig) {
    const keys = changedKeys(
      parseTopLevelBlocks(input.workspaceConfig.before),
      parseTopLevelBlocks(input.workspaceConfig.after),
    );
    if (keys.some((key) => RESOLUTION_WORKSPACE_KEYS.has(key))) return { ...ALL };
  }

  if (input.lockfile) {
    const before = parseLockfileImporters(input.lockfile.before);
    const after = parseLockfileImporters(input.lockfile.after);
    for (const key of changedKeys(before, after)) merge(appsForImporter(key));
  }

  return result;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function readAt(base: string, path: string): string {
  try {
    return git(["show", `${base}:${path}`]);
  } catch {
    return "";
  }
}

const ZERO_SHA = /^0+$/;

function main(): void {
  const args = process.argv.slice(2);
  const baseIndex = args.indexOf("--base");
  const headIndex = args.indexOf("--head");
  const base = baseIndex >= 0 ? args[baseIndex + 1] : undefined;
  const head = headIndex >= 0 ? args[headIndex + 1] : "HEAD";
  const writeGitHubOutput = args.includes("--github-output");

  if (!base || ZERO_SHA.test(base)) {
    // A brand-new branch has no "before" to diff against. Deploy everything
    // rather than guess.
    emit({ ...ALL }, writeGitHubOutput, `no base ref (base=${base ?? "unset"})`);
    return;
  }

  const changedPaths = git(["diff", "--name-only", base, head])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const input: AffectedAppsInput = { changedPaths };
  if (changedPaths.includes("package.json")) {
    input.rootPackage = { before: readAt(base, "package.json"), after: readAt(head, "package.json") };
  }
  if (changedPaths.includes("pnpm-workspace.yaml")) {
    input.workspaceConfig = {
      before: readAt(base, "pnpm-workspace.yaml"),
      after: readAt(head, "pnpm-workspace.yaml"),
    };
  }
  if (changedPaths.includes("pnpm-lock.yaml")) {
    input.lockfile = { before: readAt(base, "pnpm-lock.yaml"), after: readAt(head, "pnpm-lock.yaml") };
  }

  const affected = resolveAffectedApps(input);
  const reason = `${changedPaths.length} changed path(s): ${changedPaths.slice(0, 8).join(", ")}${
    changedPaths.length > 8 ? ", …" : ""
  }`;
  emit(affected, writeGitHubOutput, reason);
}

function emit(affected: AffectedApps, writeGitHubOutput: boolean, reason: string): void {
  console.log(JSON.stringify({ ...affected, reason }, null, 2));

  const outputFile = process.env.GITHUB_OUTPUT;
  if (writeGitHubOutput && outputFile) {
    appendFileSync(
      outputFile,
      `web=${affected.web}\npartykit=${affected.partykit}\n`,
    );
  }

  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    appendFileSync(
      summaryFile,
      [
        "| App | Deploy |",
        "| --- | --- |",
        `| web | ${affected.web ? "yes" : "skip"} |`,
        `| partykit | ${affected.partykit ? "yes" : "skip"} |`,
        "",
        `_${reason}_`,
        "",
      ].join("\n"),
    );
  }
}

if (process.argv[1]?.endsWith("affected-apps.ts")) {
  main();
}
