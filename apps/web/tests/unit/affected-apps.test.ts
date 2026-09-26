import { describe, expect, it } from "vitest";

import {
  resolveAffectedApps,
  type AffectedAppsInput,
  type AffectedApps,
} from "../../../../scripts/ci/affected-apps";

const LOCK_VERSION = "lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n\n";

/** Build a pnpm v9 lockfile with just enough structure to exercise parsing. */
function lockfile(importers: Record<string, string[]>): string {
  const body = Object.entries(importers)
    .map(([name, deps]) => {
      if (deps.length === 0) return `  ${name}: {}`;
      return `  ${name}:\n    devDependencies:\n${deps.map((d) => `      ${d}:`).join("\n")}`;
    })
    .join("\n");
  return `${LOCK_VERSION}importers:\n\n${body}\n\npackages:\n\n  foo@1.0.0:\n    resolution: {integrity: sha512-x}\n`;
}

function resolve(input: AffectedAppsInput): AffectedApps {
  return resolveAffectedApps(input);
}

describe("resolveAffectedApps", () => {
  it("keeps a web-only editor change from deploying agent or partykit", () => {
    // 9ee0b049f "fix(editor): make toolbar history actions icon-only"
    const result = resolve({
      changedPaths: [
        "apps/web/app/(app)/resume/[id]/edit/editor-client.tsx",
        "apps/web/tests/unit/editor-client-version-history.test.tsx",
      ],
    });

    expect(result).toEqual({ web: true, agent: false, partykit: false });
  });

  it("does not redeploy anything for a root package.json scripts-only change", () => {
    // 971fc3f3c "feat(process): adopt decision notes with script-enforced gates"
    // added only `notes:verify` / `notes:anchors` / `notes:archive`. No app
    // consumes root scripts, so neither service should be redeployed.
    const before = JSON.stringify({
      name: "intro-builder",
      scripts: { test: "pnpm --recursive test" },
      devDependencies: { next: "16.2.4" },
    });
    const after = JSON.stringify({
      name: "intro-builder",
      scripts: {
        test: "pnpm --recursive test",
        "notes:verify": "tsx scripts/notes/verify-agent-note-tree.ts",
      },
      devDependencies: { next: "16.2.4" },
    });

    const result = resolve({
      changedPaths: ["package.json", "scripts/notes/verify-agent-note-tree.ts"],
      rootPackage: { before, after },
    });

    expect(result).toEqual({ web: false, agent: false, partykit: false });
  });

  it("deploys every app when root dependencies change", () => {
    const before = JSON.stringify({ devDependencies: { typescript: "5.9.3" } });
    const after = JSON.stringify({ devDependencies: { typescript: "5.9.4" } });

    const result = resolve({
      changedPaths: ["package.json"],
      rootPackage: { before, after },
    });

    expect(result).toEqual({ web: true, agent: true, partykit: true });
  });

  it("does not redeploy agent or partykit for a workspace settings-only change", () => {
    // f968d22b6 "fix(test): align jsdom globals with newer Node so gates stop
    // false-failing" added `verifyDepsBeforeRun: false`, which no app consumes.
    const before = 'packages:\n  - "apps/*"\n\nonlyBuiltDependencies:\n  - esbuild\n';
    const after =
      'packages:\n  - "apps/*"\n\nonlyBuiltDependencies:\n  - esbuild\n\nverifyDepsBeforeRun: false\n';

    const result = resolve({
      changedPaths: ["pnpm-workspace.yaml", "apps/web/tests/setup.ts"],
      workspaceConfig: { before, after },
    });

    expect(result).toEqual({ web: true, agent: false, partykit: false });
  });

  it("deploys every app when the workspace membership changes", () => {
    const before = 'packages:\n  - "apps/*"\n';
    const after = 'packages:\n  - "apps/*"\n  - "services/*"\n';

    const result = resolve({
      changedPaths: ["pnpm-workspace.yaml"],
      workspaceConfig: { before, after },
    });

    expect(result).toEqual({ web: true, agent: true, partykit: true });
  });

  it("does not redeploy agent when only unrelated lockfile importers changed", () => {
    // 51be46358 "chore: restore v0.4.2 release baseline" rewrote root eslint
    // peer-resolution strings and added a vitest devDep to apps/partykit.
    // The apps/agent importer block was byte-identical.
    const before = lockfile({
      ".": ["next@16.2.4"],
      "apps/agent": ["zod@4.1.12"],
      "apps/partykit": ["partykit@0.0.111", "typescript@5.9.3"],
      "apps/web": ["next@16.2.4"],
    });
    const after = lockfile({
      ".": ["next@16.2.4(eslint@9.39.4)"],
      "apps/agent": ["zod@4.1.12"],
      "apps/partykit": ["partykit@0.0.111", "typescript@5.9.3", "vitest@4.1.5"],
      "apps/web": ["next@16.2.4"],
    });

    const result = resolve({
      changedPaths: ["pnpm-lock.yaml"],
      lockfile: { before, after },
    });

    expect(result).toEqual({ web: true, agent: false, partykit: true });
  });

  it("deploys agent when its own lockfile importer changes", () => {
    const before = lockfile({ "apps/agent": ["zod@4.1.11"], "apps/web": ["next@16.2.4"] });
    const after = lockfile({ "apps/agent": ["zod@4.1.12"], "apps/web": ["next@16.2.4"] });

    const result = resolve({
      changedPaths: ["pnpm-lock.yaml"],
      lockfile: { before, after },
    });

    expect(result.agent).toBe(true);
  });

  it("deploys agent when its own source changes", () => {
    // 99b5dbcd6 "feat(agent): harden autosave and agent UX"
    const result = resolve({
      changedPaths: [
        "apps/agent/src/agent-messages.ts",
        "apps/agent/src/workflows/loop-runtime.ts",
      ],
    });

    expect(result).toEqual({ web: false, agent: true, partykit: false });
  });

  it("deploys partykit when its own source changes", () => {
    // 12fcc68ad "fix(partykit): fail closed on invalid collaboration tokens"
    const result = resolve({
      changedPaths: ["apps/partykit/src/server.ts", "apps/partykit/src/utils/auth.ts"],
    });

    expect(result).toEqual({ web: false, agent: false, partykit: true });
  });

  it("deploys partykit — but not agent — when the shared package changes", () => {
    // PartyKit imports @intro-builder/shared; the Agent service does not.
    const result = resolve({
      changedPaths: ["packages/shared/src/schemas/resume-schema.ts"],
    });

    expect(result).toEqual({ web: true, agent: false, partykit: true });
  });

  it("still deploys agent when agent files change alongside a root lockfile edit", () => {
    const result = resolve({
      changedPaths: ["apps/agent/src/http.ts", "pnpm-lock.yaml"],
      lockfile: {
        before: lockfile({ "apps/agent": ["zod@4.1.11"] }),
        after: lockfile({ "apps/agent": ["zod@4.1.12"] }),
      },
    });

    expect(result).toEqual({ web: false, agent: true, partykit: false });
  });

  it("fails safe by deploying everything when a change cannot be classified", () => {
    // An unrecognized root-level file must not silently skip a production
    // deploy — the gate may only suppress a deploy it positively understands.
    const result = resolve({ changedPaths: ["some-unknown-root-file.toml"] });

    expect(result).toEqual({ web: true, agent: true, partykit: true });
  });

  it("does not deploy anything when only documentation changed", () => {
    const result = resolve({ changedPaths: ["docs/notes/implemented/process/x.md", "README.md"] });

    expect(result).toEqual({ web: false, agent: false, partykit: false });
  });

  it("does not deploy anything for a docs-and-lessons reshuffle", () => {
    // b371026f5 "docs(notes): finish folding lessons/ into decision notes"
    // moved notes around and touched no executable surface. This previously
    // fell through to the fail-safe branch and redeployed all three apps.
    const result = resolve({
      changedPaths: [
        "docs/notes/implemented/architecture/2026-05-27-template-css-scope-by-string-prefix.md",
        "lessons/css-scope-prefix.md",
        "lessons/v2-migration-cleanup.md",
        "scripts/README.md",
      ],
    });

    expect(result).toEqual({ web: false, agent: false, partykit: false });
  });

  it("ignores a manifest bump in the unreferenced config placeholder", () => {
    // 51be46358 bumped packages/config and packages/shared to 0.4.2.
    // @intro-builder/config is an empty package nothing depends on, so its
    // version cannot change an artifact; shared genuinely feeds web+partykit.
    const result = resolve({
      changedPaths: ["packages/config/package.json", "packages/shared/package.json"],
    });

    expect(result).toEqual({ web: true, agent: false, partykit: true });
  });

  it("treats an unrecognised workspace member as a fail-safe", () => {
    const result = resolve({ changedPaths: ["packages/brand-new/package.json"] });

    expect(result).toEqual({ web: true, agent: true, partykit: true });
  });

  it("deploys only the app whose deploy workflow changed", () => {
    expect(resolve({ changedPaths: [".github/workflows/deploy-agent.yml"] })).toEqual({
      web: false,
      agent: true,
      partykit: false,
    });
    expect(resolve({ changedPaths: [".github/workflows/deploy-partykit.yml"] })).toEqual({
      web: false,
      agent: false,
      partykit: true,
    });
    // Non-deploy CI config never ships anywhere.
    expect(resolve({ changedPaths: [".github/workflows/ci.yml", ".github/dependabot.yml"] })).toEqual(
      { web: false, agent: false, partykit: false },
    );
  });

  it("does not deploy agent for the v0.4.2 baseline bump", () => {
    // Full file list of 51be46358: web/config/shared manifests plus lockfile.
    // Agent's own importer and manifest were untouched, yet it redeployed.
    const before = lockfile({
      ".": ["next@16.2.4"],
      "apps/agent": ["zod@4.1.12"],
      "apps/partykit": ["partykit@0.0.111", "typescript@5.9.3"],
      "apps/web": ["next@16.2.4"],
      "packages/shared": ["zod@4.1.12"],
    });
    const after = lockfile({
      ".": ["next@16.2.4(eslint@9.39.4)"],
      "apps/agent": ["zod@4.1.12"],
      "apps/partykit": ["partykit@0.0.111", "typescript@5.9.3", "vitest@4.1.5"],
      "apps/web": ["next@16.2.4"],
      "packages/shared": ["zod@4.1.12"],
    });

    const result = resolve({
      changedPaths: [
        ".github/dependabot.yml",
        ".github/workflows/codeql.yml",
        "AGENTS.md",
        "apps/web/package.json",
        "docs/agent/implementation-roadmap.md",
        "package.json",
        "packages/config/package.json",
        "packages/shared/package.json",
        "pnpm-lock.yaml",
      ],
      rootPackage: {
        before: JSON.stringify({ version: "0.4.1" }),
        after: JSON.stringify({ version: "0.4.2" }),
      },
      lockfile: { before, after },
    });

    expect(result).toEqual({ web: true, agent: false, partykit: true });
  });
});
