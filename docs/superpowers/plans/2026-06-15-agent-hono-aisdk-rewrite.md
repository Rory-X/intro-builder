# Agent Hono + AI SDK 重构 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `apps/agent` 重构为 Hono 服务，agent 能力收敛为 `session` + `chat` 两个端点，SSE 按 AI SDK v6 UI message stream 标准，assistant-ui 走 AI SDK 运行时，tool 只读生产库 / 只写 preview，用户在 web 侧 ask / 继续修改 / 应用落库。

**Architecture:** 分 4 个可独立发布的 Phase。Phase 1 给 agent 加 Postgres 访问 + Postgres 版 session store（纯加法、零行为变更）。Phase 2 用 Hono 重写 HTTP 层、保持现有路由行为。Phase 3 加 `session`/`chat` 两端点 + tools + preview + ask（AI SDK 流，开关后面）。Phase 4 web 侧接 AI SDK 运行时 + preview/apply/ask UI，切换后删旧链路。

**Tech Stack:** Hono 4 + `@hono/node-server`、AI SDK v6（`ai@6.0.204`、`@ai-sdk/openai-compatible`）、Drizzle + postgres.js/Neon、assistant-ui 0.14（`useChatRuntime` / `AssistantChatTransport` / `makeAssistantToolUI`）、Vitest。

**Spec:** [2026-06-15-agent-hono-aisdk-rewrite-design.md](../specs/2026-06-15-agent-hono-aisdk-rewrite-design.md)

---

## Phase 路线图（每个 Phase 一份可发布切片）

- **Phase 1（本计划详写）**：agent Postgres 访问层 + Postgres `AgentSessionStore`。纯加法，不接线，服务行为不变。
- **Phase 2**：Hono 重写 HTTP 层（`/health`、`/ready`、`/v1/session`、`/v1/rich-text/polish`、`/v1/resume/helpers/:id` 行为对齐），`index.ts` 切到 `@hono/node-server`，旧 `/v1/agent/messages` 暂留。
- **Phase 3**：`POST /v1/agent/session` + `POST /v1/agent/chat`（`streamText().toUIMessageStreamResponse()`）、tools（read 只读生产库 / write 只改 preview / `ask_user`）、preview 落 `agent_session.stateJson`、事件落 `agent_session_event`；开关 `AGENT_LOOP_ENABLED`。
- **Phase 4**：web BFF（`/api/agent/session`、`/api/agent/chat`、apply 路由）、`useChatRuntime`+`AssistantChatTransport` 替换 `@assistant-ui/react-ag-ui`、`makeAssistantToolUI` 工具卡/preview/ask、preview 区 + 应用按钮；切换后删 `/v1/agent/messages` 与 JSON 契约层。

Phase 2-4 在各自开工时展开为独立 plan（依赖 Phase 1 产物与实跑出的 AI SDK / assistant-ui 签名，提前写代码即虚构）。

---

## Phase 1：Agent Postgres 访问层 + Postgres Session Store

**为什么先做**：`session 存远程数据库` 与 `tool 只读生产库` 都要求 agent 能连 Postgres，而 agent 现在完全没有 DB 依赖（session 走 Redis）。先把这层做成纯加法、可单测，后续 Phase 接线即可。

**File Structure：**
- Create `apps/agent/src/db/connection.ts` — Neon/postgres.js driver 选择（镜像 web）。
- Create `apps/agent/src/db/schema.ts` — 只声明 `agent_session` + `agent_session_event` 两表。
- Create `apps/agent/src/db/index.ts` — 导出 `db`（构建期 placeholder 兜底）。
- Create `apps/agent/src/db/agent-session-repository.ts` — 仓储端口 + Drizzle 实现。
- Create `apps/agent/src/session-store-postgres.ts` — Postgres 版 `AgentSessionStore`（依赖仓储端口）。
- Create `apps/agent/tests/session-store-postgres.test.ts` — 用 fake 仓储单测 store 逻辑。
- Modify `apps/agent/package.json` — 加 `drizzle-orm` / `postgres` / `@neondatabase/serverless`。

### Task 1.1：加依赖

- [ ] **Step 1：改 `apps/agent/package.json` dependencies**，加入（版本对齐 web，复用 lockfile）：

```jsonc
"@neondatabase/serverless": "^1.1.0",
"drizzle-orm": "^0.45.2",
"postgres": "^3.4.9",
```

- [ ] **Step 2：安装**

Run: `pnpm install --filter @intro-builder/agent...`
Expected: 复用根 lockfile，无新增解析失败。

- [ ] **Step 3：Commit**

```bash
git add apps/agent/package.json pnpm-lock.yaml
git commit -m "chore(agent): add drizzle/postgres deps for agent db access"
```

### Task 1.2：DB connection + schema + index

- [ ] **Step 1：写 `apps/agent/src/db/connection.ts`**

```ts
export function connectionUsesNeonHttpApi(connectionString: string): boolean {
  try {
    const host = new URL(connectionString).hostname.toLowerCase();
    return host === "neon.tech" || host.endsWith(".neon.tech");
  } catch {
    return false;
  }
}
```

- [ ] **Step 2：写 `apps/agent/src/db/schema.ts`**（只两张表；`stateJson` 用 agent 本地 `AgentSessionSnapshot`）

```ts
import {
  pgTable, text, timestamp, jsonb, integer, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AgentSessionSnapshot } from "../agent-messages.js";

export const agentSessions = pgTable("agent_session", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull(),
  resumeId: text("resumeId"),
  mode: text("mode").$type<AgentSessionSnapshot["mode"]>().notNull().default("optimize_existing"),
  status: text("status").$type<AgentSessionSnapshot["status"]>().notNull().default("active"),
  title: text("title").notNull(),
  stateJson: jsonb("stateJson").$type<AgentSessionSnapshot>().notNull(),
  lastResumeContentHash: text("lastResumeContentHash"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
}, (t) => ({
  userIdx: index("agent_session_user_idx").on(t.userId),
  resumeIdx: index("agent_session_resume_idx").on(t.resumeId),
  statusIdx: index("agent_session_status_idx").on(t.status),
}));

export const agentSessionEvents = pgTable("agent_session_event", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text("sessionId").notNull().references(() => agentSessions.id, { onDelete: "cascade" }),
  runId: text("runId").notNull(),
  sequence: integer("sequence").notNull(),
  type: text("type").notNull(),
  payloadJson: jsonb("payloadJson").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
}, (t) => ({
  sessionIdx: index("agent_session_event_session_idx").on(t.sessionId),
  runIdx: index("agent_session_event_run_idx").on(t.runId),
  uniqueRunSequenceIdx: uniqueIndex("agent_session_event_run_sequence_idx").on(t.sessionId, t.runId, t.sequence),
}));
```

- [ ] **Step 3：写 `apps/agent/src/db/index.ts`**（构建期 placeholder 兜底，镜像 web）

```ts
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { neon } from "@neondatabase/serverless";
import postgres from "postgres";
import * as schema from "./schema.js";
import { connectionUsesNeonHttpApi } from "./connection.js";

const url =
  process.env.DATABASE_URL ??
  "postgres://build-placeholder:build-placeholder@localhost:5432/placeholder";

if (!process.env.DATABASE_URL && process.env.NODE_ENV === "production") {
  console.warn("[agent-db] DATABASE_URL not set — using placeholder. Queries will fail at runtime.");
}

type Database = NeonHttpDatabase<typeof schema>;

export const db: Database = connectionUsesNeonHttpApi(url)
  ? drizzleNeon(neon(url), { schema })
  : (drizzlePostgres(postgres(url, { max: Number(process.env.DATABASE_POOL_MAX ?? 5) }), { schema }) as unknown as Database);
export type AgentDb = typeof db;
```

- [ ] **Step 4：typecheck**

Run: `pnpm --filter @intro-builder/agent typecheck`
Expected: PASS（注意 agent `tsconfig` 用 NodeNext，import 必须带 `.js`）。

- [ ] **Step 5：Commit**

```bash
git add apps/agent/src/db
git commit -m "feat(agent): add postgres connection + agent-session schema"
```

### Task 1.3：仓储端口 + Drizzle 实现

**File:** Create `apps/agent/src/db/agent-session-repository.ts`

- [ ] **Step 1：写端口 + Drizzle 实现**

```ts
import { and, eq } from "drizzle-orm";
import type { AgentSessionSnapshot } from "../agent-messages.js";
import { db as defaultDb, type AgentDb } from "./index.js";
import { agentSessions, agentSessionEvents } from "./schema.js";

export type AgentSessionRow = {
  id: string;
  userId: string;
  resumeId: string | null;
  mode: AgentSessionSnapshot["mode"];
  status: AgentSessionSnapshot["status"];
  title: string;
  stateJson: AgentSessionSnapshot;
  lastResumeContentHash: string | null;
};

export type AgentSessionEventRow = {
  sessionId: string;
  runId: string;
  sequence: number;
  type: string;
  payloadJson: Record<string, unknown>;
};

/** Narrow port so the store is unit-testable without a live database. */
export type AgentSessionRepository = {
  getSnapshot(sessionId: string): Promise<AgentSessionSnapshot | null>;
  upsertSession(row: AgentSessionRow): Promise<void>;
  appendEvents(rows: AgentSessionEventRow[]): Promise<void>;
};

export function createDrizzleAgentSessionRepository(
  database: AgentDb = defaultDb,
): AgentSessionRepository {
  return {
    async getSnapshot(sessionId) {
      const row = await database
        .select({ stateJson: agentSessions.stateJson })
        .from(agentSessions)
        .where(eq(agentSessions.id, sessionId))
        .limit(1);
      return row[0]?.stateJson ?? null;
    },
    async upsertSession(row) {
      await database
        .insert(agentSessions)
        .values({
          id: row.id, userId: row.userId, resumeId: row.resumeId,
          mode: row.mode, status: row.status, title: row.title,
          stateJson: row.stateJson, lastResumeContentHash: row.lastResumeContentHash,
        })
        .onConflictDoUpdate({
          target: agentSessions.id,
          set: {
            status: row.status, title: row.title, stateJson: row.stateJson,
            lastResumeContentHash: row.lastResumeContentHash, updatedAt: new Date(),
          },
        });
    },
    async appendEvents(rows) {
      if (rows.length === 0) return;
      await database.insert(agentSessionEvents).values(rows).onConflictDoNothing({
        target: [agentSessionEvents.sessionId, agentSessionEvents.runId, agentSessionEvents.sequence],
      });
    },
  };
}
```

- [ ] **Step 2：typecheck + commit**

```bash
pnpm --filter @intro-builder/agent typecheck
git add apps/agent/src/db/agent-session-repository.ts
git commit -m "feat(agent): add agent-session repository port + drizzle impl"
```

### Task 1.4：Postgres session store（依赖端口）+ 单测

**File:** Create `apps/agent/src/session-store-postgres.ts`、`apps/agent/tests/session-store-postgres.test.ts`

- [ ] **Step 1：写失败测试 `tests/session-store-postgres.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { createInitialAgentSessionSnapshot } from "../src/session-store.js";
import { createPostgresAgentSessionStore } from "../src/session-store-postgres.js";
import type {
  AgentSessionRepository, AgentSessionRow, AgentSessionEventRow,
} from "../src/db/agent-session-repository.js";

function fakeRepo() {
  const sessions = new Map<string, AgentSessionRow>();
  const events: AgentSessionEventRow[] = [];
  const repo: AgentSessionRepository = {
    async getSnapshot(id) { return sessions.get(id)?.stateJson ?? null; },
    async upsertSession(row) { sessions.set(row.id, row); },
    async appendEvents(rows) { events.push(...rows); },
  };
  return { repo, sessions, events };
}

const context = {
  sessionId: "agent_session_r1", threadId: "r1", resumeId: "r1",
  mode: "optimize_existing" as const, workflowId: null, resumeTitle: "我的简历",
};
const session = { userId: "u1", resumeId: "r1" } as never;

describe("createPostgresAgentSessionStore", () => {
  it("returns null when no session row exists", async () => {
    const { repo } = fakeRepo();
    const store = createPostgresAgentSessionStore(repo);
    expect(await store.loadSnapshot({ session, context })).toBeNull();
  });

  it("upserts the session row and appends events on appendEvents", async () => {
    const { repo, sessions, events } = fakeRepo();
    const store = createPostgresAgentSessionStore(repo);
    const snapshot = createInitialAgentSessionSnapshot({ context, userId: "u1", now: "2026-06-15T00:00:00.000Z" });
    await store.appendEvents({
      session, context, snapshot,
      events: [{ runId: "run1", sequence: 1, type: "RUN_STARTED", payload: { type: "RUN_STARTED" } as never }],
    });
    expect(sessions.get("agent_session_r1")?.userId).toBe("u1");
    expect(sessions.get("agent_session_r1")?.stateJson.sessionId).toBe("agent_session_r1");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ sessionId: "agent_session_r1", runId: "run1", sequence: 1, type: "RUN_STARTED" });
  });

  it("loads back the snapshot it persisted", async () => {
    const { repo } = fakeRepo();
    const store = createPostgresAgentSessionStore(repo);
    const snapshot = createInitialAgentSessionSnapshot({ context, userId: "u1", now: "2026-06-15T00:00:00.000Z" });
    await store.appendEvents({ session, context, snapshot, events: [] });
    expect(await store.loadSnapshot({ session, context }))?.toMatchObject({ sessionId: "agent_session_r1" });
  });
});
```

- [ ] **Step 2：跑测试确认失败**

Run: `pnpm --filter @intro-builder/agent test -- session-store-postgres`
Expected: FAIL（`session-store-postgres.js` 不存在）。

- [ ] **Step 3：写实现 `src/session-store-postgres.ts`**

```ts
import type { AgentSessionStore } from "./session-store.js";
import type { AgentSessionRepository } from "./db/agent-session-repository.js";

export function createPostgresAgentSessionStore(
  repo: AgentSessionRepository,
): AgentSessionStore {
  return {
    async loadSnapshot({ context }) {
      return repo.getSnapshot(context.sessionId);
    },
    async appendEvents({ session, context, events, snapshot }) {
      await repo.upsertSession({
        id: context.sessionId,
        userId: session.userId,
        resumeId: context.resumeId,
        mode: snapshot.mode,
        status: snapshot.status,
        title: context.resumeTitle,
        stateJson: snapshot,
        lastResumeContentHash: snapshot.lastResumeContentHash,
      });
      if (events.length > 0) {
        await repo.appendEvents(
          events.map((event) => ({
            sessionId: context.sessionId,
            runId: event.runId,
            sequence: event.sequence,
            type: event.type,
            payloadJson: event.payload as unknown as Record<string, unknown>,
          })),
        );
      }
    },
  };
}
```

- [ ] **Step 4：跑测试确认通过**

Run: `pnpm --filter @intro-builder/agent test -- session-store-postgres`
Expected: PASS（3 tests）。

- [ ] **Step 5：全量闸门**

Run: `pnpm --filter @intro-builder/agent typecheck && pnpm --filter @intro-builder/agent test`
Expected: 全绿（既有 169 + 新增 3）。

- [ ] **Step 6：Commit**

```bash
git add apps/agent/src/session-store-postgres.ts apps/agent/tests/session-store-postgres.test.ts
git commit -m "feat(agent): add postgres-backed agent session store (behind port, unit-tested)"
```

### Phase 1 验收

- `pnpm --filter @intro-builder/agent typecheck && test` 全绿。
- 新增文件全部为加法，未接线进 `index.ts`（服务行为零变更，可安全部署）。
- 仓储端口让 store 逻辑可单测；Drizzle 实现由 typecheck 覆盖，实库行为留 Phase 3 接线时冒烟。

---

## Phase 2-4 摘要（开工时各自展开为独立 plan）

**Phase 2（Hono 化）**：加 `hono` + `@hono/node-server`；`src/server/app.ts` 建 Hono app，把 `/health`/`/ready`/`/v1/session`/`/v1/rich-text/polish`/`/v1/resume/helpers/:id` 用 Hono handler 重写（auth/CORS/限流/错误信封复用现有纯函数模块）；`index.ts` 用 `serve()` 起 Hono；既有测试对齐行为；旧 `createAgentServer` 暂留直到 Phase 3 替换 agent 端点。DoD：`pnpm verify` + `agent:build` 绿，镜像 `node dist/index.js` 起得来。

**Phase 3（两端点 + tools + preview + ask）**：`POST /v1/agent/session`（Postgres upsert，返回 sessionId+preview）；`POST /v1/agent/chat`（`streamText({model,system,messages:convertToModelMessages(...),tools,stopWhen:stepCountIs(N)}).toUIMessageStreamResponse()`）；tools：read（只读 `resume` 表，按 JWT userId/resumeId 限定）、write（改 preview，复用 PR#80 draft/operation）、`ask_user`（`needsApproval`/无 execute，人机回环）；preview 落 `agent_session.stateJson` + `data-preview` part；事件落 `agent_session_event`；开关 `AGENT_LOOP_ENABLED`。

**Phase 4（web 落地）**：BFF `POST /api/agent/session`、`POST /api/agent/chat`（签 JWT、透传 SSE，沿用 runs 模式）、apply 路由/action（preview→`resumes`，走 autosave 写路径，保 D4）；前端 `useChatRuntime({transport:new AssistantChatTransport({api:"/api/agent/chat"})})` + `AssistantRuntimeProvider` 替换 `@assistant-ui/react-ag-ui`；`makeAssistantToolUI` 渲染工具卡 / preview 卡 / ask 面板；预览区订阅 `data-preview`，「应用更改」「继续对话」按钮。切换通过后删 `/v1/agent/messages` 与 `agent-messages.ts`/`agent-tools.ts` JSON 契约层。DoD：`pnpm lint && typecheck && test && build` 全绿 + 手工冒烟全流程。
