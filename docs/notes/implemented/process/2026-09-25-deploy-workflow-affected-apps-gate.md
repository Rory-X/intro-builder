# Agent Note: Deploy workflows gate on affected apps, not path globs

Status: implemented

## Problem

The Agent and PartyKit deploy workflows triggered on `paths:` globs that
included the three monorepo-wide files — `package.json`, `pnpm-lock.yaml`,
`pnpm-workspace.yaml`. GitHub's `paths:` filter is a plain path match; it cannot
express "this root file matters to the Web app but not to Agent". So any edit to
a shared file redeployed both services even when neither artifact could change.

Three commits on `main` show the waste concretely:

| Commit | What it changed | What it redeployed |
| --- | --- | --- |
| `971fc3f3c` | Root `package.json` `scripts` (added `notes:verify`) | Agent + PartyKit |
| `f968d22b6` | `pnpm-workspace.yaml` `verifyDepsBeforeRun: false` | Agent + PartyKit |
| `51be46358` | Root lockfile importer + `apps/partykit` devDep | Agent + PartyKit |

For `51be46358` the `apps/agent` importer block in `pnpm-lock.yaml` was
byte-identical before and after — the redeploy provably could not change the
Agent image.

The waste is not only time. `Deploy Agent` builds and pushes a Docker image and
restarts a production container; `Deploy PartyKit` fails closed when
`COLLAB_JWT_SECRET` is unset, so a spurious trigger turns a green push red and
buries the real signal. A Web-only change (like the toolbar's icon-only history
buttons, `9ee0b049f`) must not touch either service.

## Decision

`scripts/ci/affected-apps.ts` owns the decision as a pure function,
`resolveAffectedApps`, plus a CLI that diffs the pushed range and writes
`web` / `agent` / `partykit` outputs. Both deploy workflows always start the
job, run the gate as step `affected`, and put
`if: steps.affected.outputs.<app> == 'true'` on every build and deploy step.
`paths:` stays as a coarse pre-filter only.

Classification rules, from real dependency shape rather than directory names:

- `apps/web/**`, `apps/agent/**`, `apps/partykit/**` affect their own app.
- `packages/shared/**` affects **Web and PartyKit, not Agent** — Agent declares
  no `@intro-builder/shared` dependency, while PartyKit and Web both do.
- `packages/config/**` affects nothing: it is an empty placeholder package that
  declares no files and that nothing references.
- A workspace member's `package.json` affects that member and its dependants;
  an unrecognised member is a fail-safe.
- Root `package.json` matters only if a key outside `INERT_ROOT_KEYS` changed,
  so a `scripts`-only edit is inert (no app script calls a root script).
- `pnpm-workspace.yaml` matters only if `packages` / `catalog` / `catalogs`
  changed, so runtime settings like `verifyDepsBeforeRun` are inert.
- `pnpm-lock.yaml` is read as **per-importer blocks**, not as a whole file. Only
  the `importers:` section is parsed; a changed importer maps to its consumer
  (`"."` → Web, because the root importer pins the Next.js version Vercel's
  framework detector reads).
- `docs/`, `scripts/`, `lessons/`, `.github/`, `README.md`, `AGENTS.md` and
  peers are inert. The two deploy workflows are matched by filename *before*
  that prefix rule, so editing them still deploys their own service.

**Fail-safe rule**: a change the gate cannot positively classify returns
`{web: true, agent: true, partykit: true}`. An empty or all-zero `before`
(new branch, `workflow_dispatch`) takes the same path, which is what makes a
manual run force a real deploy. The gate may only ever *suppress* a deploy it
understands; it never silently skips one it does not.

## Alternatives considered

- **Keep `paths:` and accept the over-deploy** — The cheapest option, and for a
  repo that deploys a few times a week it would be defensible. Rejected because
  the spurious PartyKit trigger is not merely slow: it fails the run whenever
  the `COLLAB_JWT_SECRET` secret is absent, so unrelated Web pushes present as
  red CI and train the reader to ignore the signal.
- **`dorny/paths-filter`** — The idiomatic GitHub Action for this, and it would
  have been less code. Rejected because it still matches globs: it cannot say
  "this lockfile *importer* moved" or "this root key is inert", which is
  precisely the discrimination the three motivating commits needed. It would
  also add a third-party action to the production deploy path.
- **Trim `paths:` to the app directories only** — Removes the public root files
  from the trigger list, so `pnpm-lock.yaml` stops redeploying Agent. Rejected
  because it trades over-deploying for *under*-deploying: a genuine root
  dependency bump that Agent's Docker build consumes would no longer deploy it.
- **`turbo` / `nx` affected-graph** — Purpose-built for this and would stay
  correct as the workspace grows. Rejected as disproportionate: it means a new
  task runner, config, and cache in a repo whose affected surface is five
  workspace members and three deploy targets.
- **Classify by directory prefix only (skip lockfile parsing)** — Simpler, and
  covers the common case. Rejected because `51be46358` is exactly the case that
  matters: a lockfile edit whose Agent importer did not move. Prefix-only
  classification would still have redeployed Agent.

## Consequences

- **收益**: A Web-only change deploys only Web. Replayed against real `main`
  history, the gate answers `web=true agent=false partykit=false` for
  `9ee0b049f` (toolbar icons), `90b1516c7` and `f968d22b6`, and
  `web=false agent=false partykit=false` for the docs reshuffle `b371026f5` and
  the scripts-only `971fc3f3c` — all of which previously fanned out.
- **收益**: The decision is a pure function with 18 unit tests in
  `apps/web/tests/unit/affected-apps.test.ts`, so it is testable without running
  a workflow.
- **代价与已知上限**: Every deploy job now pays one `fetch-depth: 0` checkout
  and one `node` step, even when it then skips. The gate is a hardcoded map of
  workspace members, so **a new app or package must be added to
  `appsForWorkspaceMember` / the path branches** — an unlisted member falls to
  the fail-safe and over-deploys rather than under-deploys, but the map does not
  learn by itself.
- **代价与已知上限**: The lockfile reader is a hand-rolled parser for pnpm
  v9's `importers:` block. A lockfile format change (v10) could silently yield
  an empty map. The blast radius is bounded by the fail-safe only insofar as the
  parse failure is *detected*; a parser that returns empty maps for both sides
  reports "no importers changed" instead. Revisit if `lockfileVersion` moves.
- **重访信号**: adding a fourth deployable app; a `lockfileVersion` bump; or a
  deploy that should have happened and did not (the fail-safe covers
  unclassifiable paths, not a mis-classified one).

## Verification

- `pnpm test` — `apps/web/tests/unit/affected-apps.test.ts` covers each rule and
  the fail-safe, each case annotated with the real commit it reproduces.
- Replay against `main` history:

  ```bash
  node --experimental-strip-types scripts/ci/affected-apps.ts \
    --base <commit>~1 --head <commit>
  ```

- Both workflows parse and gate correctly: 15 steps / 13 gated (Agent) and
  8 steps / 6 gated (PartyKit); the two ungated steps are `Checkout` and the
  gate itself.
