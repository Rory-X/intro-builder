import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import type { LanguageModel } from "ai";

import { loadConfig } from "../src/config.js";
import { createAgentApp } from "../src/server/app.js";
import type { AgentReplayStore } from "../src/auth.js";
import type {
  AgentSessionStore,
  AppendAgentSessionEventsInput,
} from "../src/session-store.js";
import type { AgentSessionSnapshot } from "../src/agent-messages.js";

/**
 * End-to-end wiring test for the new agent path (session + chat) via the Hono
 * app's `app.request()`, a forged short-lived JWT, in-memory stores, and a stub
 * model. Proves the chain is usable without a live provider: auth → model
 * resolve → tools mutate preview → onFinish persists a staged change-set →
 * AI SDK UI message stream Response.
 */

const SECRET = "test-agent-secret";
const now = () => new Date("2026-06-08T08:01:00.000Z");
let jti = 0;

async function mintToken(scope: string, resumeId?: string, sub = "u1") {
  jti += 1;
  return new SignJWT({ scope, ...(resumeId ? { resumeId } : {}) })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("intro-builder-web")
    .setAudience("intro-builder-agent")
    .setSubject(sub)
    .setJti(`jti-${jti}`)
    .setIssuedAt(Math.floor(new Date("2026-06-08T08:00:00.000Z").getTime() / 1000))
    .setExpirationTime(Math.floor(new Date("2026-06-08T08:02:00.000Z").getTime() / 1000))
    .sign(new TextEncoder().encode(SECRET));
}

class FakeReplayStore implements AgentReplayStore {
  private keys = new Set<string>();
  async set(key: string): Promise<"OK" | null> {
    if (this.keys.has(key)) return null;
    this.keys.add(key);
    return "OK";
  }
}

function memSessionStore() {
  const snapshots = new Map<string, AgentSessionSnapshot>();
  const appends: AppendAgentSessionEventsInput[] = [];
  const store: AgentSessionStore = {
    async loadSnapshot({ context }) {
      return snapshots.get(context.sessionId) ?? null;
    },
    async appendEvents(input) {
      appends.push(input);
      snapshots.set(input.context.sessionId, input.snapshot);
    },
  };
  return { store, snapshots, appends };
}

function makeApp(overrides?: {
  resolveChatModel?: () => LanguageModel | null;
  streamTextImpl?: Parameters<typeof createAgentApp>[0]["streamTextImpl"];
  sessionStore?: AgentSessionStore;
}) {
  return createAgentApp({
    config: loadConfig({ AGENT_JWT_SECRET: SECRET }),
    now,
    replayStore: new FakeReplayStore(),
    sessionStore: overrides?.sessionStore,
    createResumeReader: () => async () => ({ title: "我的简历", content: {} }),
    resolveChatModel: overrides?.resolveChatModel ?? (() => ({} as LanguageModel)),
    streamTextImpl: overrides?.streamTextImpl,
  });
}

describe("agent session + chat flow (Hono app)", () => {
  it("POST /v1/agent/session opens and persists a session", async () => {
    const { store, snapshots } = memSessionStore();
    const app = makeApp({ sessionStore: store });
    const token = await mintToken("agent:session", "r1");

    const res = await app.request("/v1/agent/session", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ resumeId: "r1", mode: "optimize_existing" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessionId: string };
    expect(body.sessionId).toBe("agent_session_r1");
    expect(snapshots.has("agent_session_r1")).toBe(true);
  });

  it("POST /v1/agent/chat streams (AI SDK UI message stream) and stages preview ops", async () => {
    const { store, snapshots } = memSessionStore();

    let finished: Promise<void> = Promise.resolve();
    const streamTextImpl = ((options: {
      tools: { upsert_section: { execute: (a: unknown, o: unknown) => Promise<unknown> } };
      onFinish?: (e: unknown) => unknown;
    }) => {
      finished = (async () => {
        await options.tools.upsert_section.execute(
          {
            section: "summary",
            fieldPath: "basics.summary",
            label: "个人简介",
            afterPlainText: "三年后端经验",
          },
          { toolCallId: "t1", messages: [] },
        );
        await options.onFinish?.({});
      })();
      return {
        toUIMessageStreamResponse: () =>
          new Response('data: {"type":"text-delta"}\n\n', {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
      };
    }) as never;

    const app = makeApp({ sessionStore: store, streamTextImpl });
    const token = await mintToken("agent:chat", "r1");

    const res = await app.request("/v1/agent/chat", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        sessionId: "agent_session_r1",
        messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "写个人简介" }] }],
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    await finished;
    const snapshot = snapshots.get("agent_session_r1");
    const changeSet = snapshot?.workspace.changeSets.at(-1);
    expect(changeSet?.status).toBe("staged");
    expect(changeSet?.operations[0]).toMatchObject({
      fieldPath: "basics.summary",
      afterPlainText: "三年后端经验",
    });
  });

  it("POST /v1/agent/chat returns 503 when no model is configured", async () => {
    const app = makeApp({ resolveChatModel: () => null });
    const token = await mintToken("agent:chat", "r1");
    const res = await app.request("/v1/agent/chat", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ messages: [] }),
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("dependency_unavailable");
  });
});
