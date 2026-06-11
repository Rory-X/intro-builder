# Mentor Collaboration Disconnect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a resume owner explicitly end a mentor collaboration so the invite link is invalidated, the online mentor immediately sees an ended state, and all server entry points reject the ended session.

**Architecture:** Use the existing `collab_session.status` text column as the source of truth and add the `ended` lifecycle value in application code. Web API endpoints enforce ended state; PartyKit only broadcasts `session-ended` for immediate UX. Client message handling is centralized in `useCollabProvider` so owner and mentor components do not attach raw WebSocket listeners independently.

**Tech Stack:** Next.js 16 App Router route handlers, Auth.js `auth()`, Drizzle ORM, PartyKit, Y.js/y-partykit, React 19, Vitest + Testing Library.

---

## File Structure

- Modify `apps/web/db/schema.ts`: extend `collabSessions.status` TypeScript union with `ended`.
- Create `apps/web/app/api/collab/end/route.ts`: owner-only endpoint that marks a session ended.
- Modify `apps/web/app/api/collab/join/route.ts`: reject ended sessions before issuing mentor PartyKit tokens.
- Modify `apps/web/app/api/collab/owner-token/route.ts`: reject ended sessions before issuing owner PartyKit tokens.
- Modify `apps/web/app/api/collab/session-status/route.ts`: preserve `ended` as terminal status instead of masking it.
- Modify `apps/web/app/collab/[token]/page.tsx`: show an ended invite state.
- Modify `apps/web/app/collab/[token]/edit/page.tsx`: render ended state instead of mentor editor for ended sessions.
- Create `apps/web/components/collab/collab-ended-state.tsx`: shared Chinese ended-state UI.
- Modify `apps/web/hooks/use-collab-provider.ts`: expose JSON send/listen helpers and avoid duplicated WebSocket listener logic.
- Modify `apps/partykit/src/server.ts`: relay `session-end` as `session-ended` to other room connections.
- Modify `apps/web/components/collab/invite-collab-dialog.tsx`: add explicit end action and pending/active copy.
- Modify `apps/web/app/(app)/resume/[id]/edit/editor-client.tsx`: own the end-session flow, broadcast realtime message, clear local collaboration state.
- Modify `apps/web/components/collab/mentor-editor-client.tsx`: listen for `session-ended` and switch to ended state.
- Add/modify tests under `apps/web/tests/unit/`:
  - `collab-end-route.test.ts`
  - `collab-join-route.test.ts`
  - `collab-owner-token-route.test.ts`
  - `collab-session-status-route.test.ts`
  - `invite-collab-dialog.test.tsx`
  - `mentor-editor-client-ended.test.tsx`
  - `partykit-collab-server.test.ts`

No database migration is planned because the column is already plain `text`.

---

### Task 1: Server Lifecycle State And End Endpoint

**Files:**
- Modify: `apps/web/db/schema.ts`
- Create: `apps/web/app/api/collab/end/route.ts`
- Test: `apps/web/tests/unit/collab-end-route.test.ts`

- [ ] **Step 1: Write the failing route tests**

Create `apps/web/tests/unit/collab-end-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  selectLimit: vi.fn(),
  updateWhere: vi.fn(),
  updateSet: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db-retry", () => ({
  withDbRetry: (_label: string, fn: () => unknown) => fn(),
}));
vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: mocks.selectLimit })),
      })),
    })),
    update: vi.fn(() => ({ set: mocks.updateSet })),
  },
}));

import { POST } from "@/app/api/collab/end/route";

describe("POST /api/collab/end", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
  });

  it("requires a signed-in owner", async () => {
    mocks.auth.mockResolvedValue(null);

    const response = await POST(jsonRequest({ sessionId: "collab_1" }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "未登录" });
    expect(mocks.updateSet).not.toHaveBeenCalled();
  });

  it("requires a session id", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "owner_1" } });

    const response = await POST(jsonRequest({}));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "缺少 sessionId" });
    expect(mocks.updateSet).not.toHaveBeenCalled();
  });

  it("returns 404 when the session does not belong to the owner", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "owner_1" } });
    mocks.selectLimit.mockResolvedValue([]);

    const response = await POST(jsonRequest({ sessionId: "collab_1" }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "协作会话不存在" });
    expect(mocks.updateSet).not.toHaveBeenCalled();
  });

  it("marks an owned non-expired session as ended", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "owner_1" } });
    mocks.selectLimit.mockResolvedValue([{
      id: "collab_1",
      ownerId: "owner_1",
      status: "active",
      expiresAt: new Date(Date.now() + 60_000),
    }]);
    mocks.updateWhere.mockResolvedValue(undefined);

    const response = await POST(jsonRequest({ sessionId: "collab_1" }));

    expect(response.status).toBe(200);
    expect(mocks.updateSet).toHaveBeenCalledWith({ status: "ended" });
    await expect(response.json()).resolves.toEqual({ status: "ended" });
  });

  it("does not reactivate expired sessions", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "owner_1" } });
    mocks.selectLimit.mockResolvedValue([{
      id: "collab_1",
      ownerId: "owner_1",
      status: "active",
      expiresAt: new Date(Date.now() - 60_000),
    }]);

    const response = await POST(jsonRequest({ sessionId: "collab_1" }));

    expect(response.status).toBe(410);
    expect(mocks.updateSet).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ error: "会话已过期", status: "expired" });
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("https://intro.test/api/collab/end", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm --filter @intro-builder/web test -- collab-end-route
```

Expected: FAIL because `@/app/api/collab/end/route` does not exist.

- [ ] **Step 3: Extend the status union**

In `apps/web/db/schema.ts`, change the status type to include `ended`:

```ts
status: text("status").$type<"pending" | "active" | "ended" | "expired">().notNull().default("pending"),
```

- [ ] **Step 4: Implement the end endpoint**

Create `apps/web/app/api/collab/end/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { collabSessions } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { withDbRetry } from "@/lib/db-retry";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { sessionId } = await req.json();
  if (!sessionId) {
    return NextResponse.json({ error: "缺少 sessionId" }, { status: 400 });
  }

  const [collab] = await withDbRetry("collab.end.read", () =>
    db.select().from(collabSessions).where(
      and(
        eq(collabSessions.id, sessionId),
        eq(collabSessions.ownerId, session.user.id),
      ),
    ).limit(1),
  );

  if (!collab) {
    return NextResponse.json({ error: "协作会话不存在" }, { status: 404 });
  }

  if (collab.expiresAt < new Date()) {
    return NextResponse.json({ error: "会话已过期", status: "expired" }, { status: 410 });
  }

  await withDbRetry("collab.end.write", () =>
    db.update(collabSessions)
      .set({ status: "ended" })
      .where(eq(collabSessions.id, collab.id)),
  );

  return NextResponse.json({ status: "ended" });
}
```

- [ ] **Step 5: Run the test to verify green**

Run:

```bash
pnpm --filter @intro-builder/web test -- collab-end-route
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/db/schema.ts apps/web/app/api/collab/end/route.ts apps/web/tests/unit/collab-end-route.test.ts
git commit -m "feat(collab): add owner end session endpoint"
```

---

### Task 2: Block Ended Sessions In Existing Server Entrypoints

**Files:**
- Modify: `apps/web/app/api/collab/join/route.ts`
- Modify: `apps/web/app/api/collab/owner-token/route.ts`
- Modify: `apps/web/app/api/collab/session-status/route.ts`
- Modify: `apps/web/app/collab/[token]/page.tsx`
- Modify: `apps/web/app/collab/[token]/edit/page.tsx`
- Create: `apps/web/components/collab/collab-ended-state.tsx`
- Test: `apps/web/tests/unit/collab-join-route.test.ts`
- Test: `apps/web/tests/unit/collab-owner-token-route.test.ts`
- Test: `apps/web/tests/unit/collab-session-status-route.test.ts`

- [ ] **Step 1: Write failing tests for ended API handling**

Create `apps/web/tests/unit/collab-join-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectLimit: vi.fn(),
  updateSet: vi.fn(),
}));

vi.mock("jose", () => ({
  SignJWT: vi.fn(() => ({
    setProtectedHeader: vi.fn().mockReturnThis(),
    setExpirationTime: vi.fn().mockReturnThis(),
    sign: vi.fn().mockResolvedValue("party-token"),
  })),
}));
vi.mock("@/lib/db-retry", () => ({
  withDbRetry: (_label: string, fn: () => unknown) => fn(),
}));
vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: mocks.selectLimit })),
      })),
    })),
    update: vi.fn(() => ({ set: mocks.updateSet })),
  },
}));

import { POST } from "@/app/api/collab/join/route";

describe("POST /api/collab/join", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.COLLAB_JWT_SECRET = "test-secret";
  });

  it("rejects ended sessions before issuing a token", async () => {
    mocks.selectLimit.mockResolvedValue([{
      id: "collab_1",
      resumeId: "resume_1",
      inviteToken: "invite_1",
      mode: "edit",
      status: "ended",
      expiresAt: new Date(Date.now() + 60_000),
    }]);

    const response = await POST(jsonRequest({ inviteToken: "invite_1", mentorName: "导师" }));

    expect(response.status).toBe(410);
    expect(mocks.updateSet).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "协作已结束，请联系对方重新邀请",
      status: "ended",
    });
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("https://intro.test/api/collab/join", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
```

Create `apps/web/tests/unit/collab-owner-token-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  selectLimit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("jose", () => ({
  SignJWT: vi.fn(() => ({
    setProtectedHeader: vi.fn().mockReturnThis(),
    setExpirationTime: vi.fn().mockReturnThis(),
    sign: vi.fn().mockResolvedValue("owner-party-token"),
  })),
}));
vi.mock("@/lib/db-retry", () => ({
  withDbRetry: (_label: string, fn: () => unknown) => fn(),
}));
vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: mocks.selectLimit })),
      })),
    })),
  },
}));

import { POST } from "@/app/api/collab/owner-token/route";

describe("POST /api/collab/owner-token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.COLLAB_JWT_SECRET = "test-secret";
  });

  it("rejects ended sessions before issuing owner tokens", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "owner_1", name: "作者" } });
    mocks.selectLimit.mockResolvedValue([{
      id: "collab_1",
      resumeId: "resume_1",
      ownerId: "owner_1",
      mode: "edit",
      status: "ended",
      expiresAt: new Date(Date.now() + 60_000),
    }]);

    const response = await POST(jsonRequest({ sessionId: "collab_1" }));

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "协作已结束",
      status: "ended",
    });
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("https://intro.test/api/collab/owner-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
```

Create `apps/web/tests/unit/collab-session-status-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  selectLimit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db-retry", () => ({
  withDbRetry: (_label: string, fn: () => unknown) => fn(),
}));
vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: mocks.selectLimit })),
      })),
    })),
  },
}));

import { GET } from "@/app/api/collab/session-status/route";

describe("GET /api/collab/session-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ended as a terminal session status", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "owner_1" } });
    mocks.selectLimit.mockResolvedValue([{
      id: "collab_1",
      ownerId: "owner_1",
      status: "ended",
      mentorName: "导师",
      expiresAt: new Date(Date.now() + 60_000),
    }]);

    const response = await GET(new Request("https://intro.test/api/collab/session-status?sessionId=collab_1"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ended",
      mentorName: "导师",
    });
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
pnpm --filter @intro-builder/web test -- collab-join-route collab-owner-token-route collab-session-status-route
```

Expected: at least join and owner-token tests fail because ended sessions are not rejected.

- [ ] **Step 3: Update join route**

In `apps/web/app/api/collab/join/route.ts`, after the expiry check and before updating the session active, add:

```ts
if (session.status === "ended") {
  return NextResponse.json(
    { error: "协作已结束，请联系对方重新邀请", status: "ended" },
    { status: 410 },
  );
}
```

- [ ] **Step 4: Update owner-token route**

In `apps/web/app/api/collab/owner-token/route.ts`, after the expiry check and before signing the owner token, add:

```ts
if (collab.status === "ended") {
  return NextResponse.json(
    { error: "协作已结束", status: "ended" },
    { status: 410 },
  );
}
```

- [ ] **Step 5: Make session-status preserve ended**

In `apps/web/app/api/collab/session-status/route.ts`, keep the existing derived status shape:

```ts
const status = collab.expiresAt < new Date() ? "expired" : collab.status;
```

No behavioral change is needed if this line already exists. The new test protects that `ended` remains visible while non-expired.

- [ ] **Step 6: Add a shared ended-state component**

Create `apps/web/components/collab/collab-ended-state.tsx`:

```tsx
import { CircleSlash2 } from "lucide-react";

type Props = {
  title?: string;
  description?: string;
};

export function CollabEndedState({
  title = "协作已结束",
  description = "作者已结束本次协作，请联系对方重新邀请。",
}: Props) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md rounded-xl border bg-background p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <CircleSlash2 className="h-6 w-6 text-muted-foreground" />
        </div>
        <h1 className="mt-4 text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Block ended entry pages**

In `apps/web/app/collab/[token]/page.tsx`, import `CollabEndedState` and render it before the expired branch:

```tsx
import { CollabEndedState } from "@/components/collab/collab-ended-state";
```

Inside the page, after `const expired = session.expiresAt < new Date();`, add:

```tsx
if (session.status === "ended") {
  return <CollabEndedState />;
}
```

In `apps/web/app/collab/[token]/edit/page.tsx`, import the same component and replace the current ended behavior:

```tsx
import { CollabEndedState } from "@/components/collab/collab-ended-state";
```

After loading the session:

```tsx
if (!session || session.expiresAt < new Date()) notFound();
if (session.status === "ended") return <CollabEndedState />;
```

- [ ] **Step 8: Run tests**

Run:

```bash
pnpm --filter @intro-builder/web test -- collab-join-route collab-owner-token-route collab-session-status-route
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/app/api/collab/join/route.ts apps/web/app/api/collab/owner-token/route.ts apps/web/app/api/collab/session-status/route.ts apps/web/app/collab/[token]/page.tsx apps/web/app/collab/[token]/edit/page.tsx apps/web/components/collab/collab-ended-state.tsx apps/web/tests/unit/collab-join-route.test.ts apps/web/tests/unit/collab-owner-token-route.test.ts apps/web/tests/unit/collab-session-status-route.test.ts
git commit -m "fix(collab): block ended mentor sessions"
```

---

### Task 3: PartyKit JSON Message Helpers And Session-End Relay

**Files:**
- Modify: `apps/web/hooks/use-collab-provider.ts`
- Modify: `apps/partykit/src/server.ts`
- Test: `apps/web/tests/unit/partykit-collab-server.test.ts`

- [ ] **Step 1: Write the failing PartyKit relay test**

Create `apps/web/tests/unit/partykit-collab-server.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("y-partykit", () => ({
  onConnect: vi.fn(),
}));

import CollabServer from "../../../partykit/src/server";

describe("CollabServer session ending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("relays session-end as session-ended to other connections", () => {
    const owner = fakeConnection("owner");
    const mentor = fakeConnection("mentor");
    const room = {
      id: "room_1",
      getConnections: () => [owner, mentor],
    };
    const server = new CollabServer(room as never);

    server.onMessage(JSON.stringify({ type: "session-end" }), owner as never);

    expect(owner.send).not.toHaveBeenCalled();
    expect(mentor.send).toHaveBeenCalledWith(JSON.stringify({
      type: "session-ended",
      reason: "owner-ended",
    }));
  });
});

function fakeConnection(id: string) {
  return {
    id,
    send: vi.fn(),
  };
}
```

- [ ] **Step 2: Run the failing PartyKit test**

Run:

```bash
pnpm --filter @intro-builder/web test -- partykit-collab-server
```

Expected: FAIL because `session-end` is ignored.

- [ ] **Step 3: Implement PartyKit relay**

In `apps/partykit/src/server.ts`, inside `onMessage` after parsing `data`, add:

```ts
if (data.type === "session-end") {
  const relay = JSON.stringify({ type: "session-ended", reason: "owner-ended" });
  for (const conn of this.room.getConnections()) {
    if (conn.id !== sender.id) {
      conn.send(relay);
    }
  }
  return;
}
```

Keep the existing voice relay logic unchanged after this block.

- [ ] **Step 4: Add provider JSON helpers**

In `apps/web/hooks/use-collab-provider.ts`, extend `CollabState`:

```ts
type JsonMessageHandler = (message: Record<string, unknown>) => void;

type CollabState = {
  ydoc: Y.Doc;
  provider: unknown;
  isConnected: boolean;
  presenceUsers: PresenceUser[];
  sendJson: (message: Record<string, unknown>) => boolean;
  addJsonMessageListener: (handler: JsonMessageHandler) => () => void;
};
```

Inside the effect after the provider is created, add a listener set and helpers:

```ts
const jsonHandlers = new Set<JsonMessageHandler>();

const sendJson = (message: Record<string, unknown>) => {
  const ws = provider.ws as WebSocket | undefined;
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(message));
  return true;
};

const addJsonMessageListener = (handler: JsonMessageHandler) => {
  jsonHandlers.add(handler);
  return () => jsonHandlers.delete(handler);
};
```

Update every `setState({ ydoc, provider, isConnected, presenceUsers })` call to include these helpers:

```ts
setState({ ydoc, provider, isConnected: nowConnected, presenceUsers, sendJson, addJsonMessageListener });
```

Inside the existing WebSocket message listener, after parsing JSON:

```ts
for (const handler of jsonHandlers) {
  handler(msg);
}
```

Keep the presence handling in the same listener.

- [ ] **Step 5: Run the PartyKit test**

Run:

```bash
pnpm --filter @intro-builder/web test -- partykit-collab-server
```

Expected: PASS.

- [ ] **Step 6: Run typecheck for the hook contract**

Run:

```bash
pnpm --filter @intro-builder/web typecheck
```

Expected: PASS or only failures from later unimplemented tasks if running mid-plan. If typecheck fails because existing call sites expect the old `CollabState`, update them to accept the new required helpers.

- [ ] **Step 7: Commit**

```bash
git add apps/web/hooks/use-collab-provider.ts apps/partykit/src/server.ts apps/web/tests/unit/partykit-collab-server.test.ts
git commit -m "feat(collab): relay session end messages"
```

---

### Task 4: Owner End Collaboration UI

**Files:**
- Modify: `apps/web/components/collab/invite-collab-dialog.tsx`
- Modify: `apps/web/app/(app)/resume/[id]/edit/editor-client.tsx`
- Test: `apps/web/tests/unit/invite-collab-dialog.test.tsx`

- [ ] **Step 1: Write failing InviteCollabDialog tests**

Append to `apps/web/tests/unit/invite-collab-dialog.test.tsx`:

```tsx
import { fireEvent, waitFor } from "@testing-library/react";

it("shows an end action for active collaboration and calls onEndSession", async () => {
  const onEndSession = vi.fn().mockResolvedValue(undefined);
  render(
    <InviteCollabDialog
      resumeId="r1"
      onSessionCreated={vi.fn()}
      isActive
      sessionId="collab_1"
      onEndSession={onEndSession}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "邀请协作" }));
  fireEvent.click(screen.getByRole("button", { name: "结束协作" }));

  await waitFor(() => expect(onEndSession).toHaveBeenCalledWith("collab_1"));
});

it("does not clear active collaboration state before end succeeds", async () => {
  const onEndSession = vi.fn().mockRejectedValue(new Error("failed"));
  render(
    <InviteCollabDialog
      resumeId="r1"
      onSessionCreated={vi.fn()}
      isActive
      sessionId="collab_1"
      onEndSession={onEndSession}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "邀请协作" }));
  fireEvent.click(screen.getByRole("button", { name: "结束协作" }));

  await screen.findByText("failed");
  expect(screen.getByRole("button", { name: "结束协作" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the failing dialog tests**

Run:

```bash
pnpm --filter @intro-builder/web test -- invite-collab-dialog
```

Expected: FAIL because the component does not accept `sessionId` or `onEndSession` and the UI still only clears local invite URL.

- [ ] **Step 3: Update InviteCollabDialog props and UI**

In `apps/web/components/collab/invite-collab-dialog.tsx`, update `Props`:

```ts
type Props = {
  resumeId: string;
  onSessionCreated: (sessionId: string) => void;
  isActive?: boolean;
  sessionId?: string | null;
  onEndSession?: (sessionId: string) => Promise<void>;
};
```

Update the function signature:

```ts
export function InviteCollabDialog({
  resumeId,
  onSessionCreated,
  isActive = false,
  sessionId,
  onEndSession,
}: Props) {
```

Add state:

```ts
const [ending, setEnding] = useState(false);
```

Replace `handleReset` with an async handler:

```ts
async function handleEndSession() {
  if (!sessionId || !onEndSession) {
    handleReset();
    return;
  }

  setEnding(true);
  setError("");
  try {
    await onEndSession(sessionId);
    handleReset();
    setOpen(false);
  } catch (e) {
    setError(e instanceof Error ? e.message : "结束协作失败");
  } finally {
    setEnding(false);
  }
}
```

In the `inviteUrl` block, replace the old cancel button with:

```tsx
<Button
  onClick={handleEndSession}
  size="sm"
  variant="outline"
  disabled={ending}
  className="w-full text-xs text-destructive hover:text-destructive"
>
  {ending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
  结束协作
</Button>
```

Add an active-session block before the invite creation options:

```tsx
{isActive && sessionId && !inviteUrl && (
  <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
    <p className="text-xs font-medium">协作进行中</p>
    <p className="text-[11px] text-muted-foreground">结束后导师会立即看到协作已结束，原链接也会失效。</p>
    <Button
      onClick={handleEndSession}
      size="sm"
      variant="outline"
      disabled={ending}
      className="w-full text-xs text-destructive hover:text-destructive"
    >
      {ending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
      结束协作
    </Button>
  </div>
)}
```

Change the invite creation condition to avoid showing create buttons during active collaboration:

```tsx
{!isActive && !inviteUrl && !loading && (
```

- [ ] **Step 4: Add owner end handler in EditorClient**

In `apps/web/app/(app)/resume/[id]/edit/editor-client.tsx`, add:

```ts
const handleEndCollabSession = useCallback(async (sessionId: string) => {
  const res = await fetch("/api/collab/end", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "结束协作失败");
  }

  collabState?.sendJson({ type: "session-end" });
  setCollabConfig(null);
  setCollabSessionId(null);
  toast.success("已结束协作");
}, [collabState]);
```

Update the dialog call site:

```tsx
<InviteCollabDialog
  resumeId={id}
  onSessionCreated={(sid) => setCollabSessionId(sid)}
  isActive={collabSessionId !== null}
  sessionId={collabSessionId}
  onEndSession={handleEndCollabSession}
/>
```

- [ ] **Step 5: Run dialog tests**

Run:

```bash
pnpm --filter @intro-builder/web test -- invite-collab-dialog
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/collab/invite-collab-dialog.tsx apps/web/app/(app)/resume/[id]/edit/editor-client.tsx apps/web/tests/unit/invite-collab-dialog.test.tsx
git commit -m "feat(collab): add owner end collaboration action"
```

---

### Task 5: Mentor Realtime Ended State

**Files:**
- Modify: `apps/web/components/collab/mentor-editor-client.tsx`
- Test: `apps/web/tests/unit/mentor-editor-client-ended.test.tsx`

- [ ] **Step 1: Write the failing mentor-ended test**

Create `apps/web/tests/unit/mentor-editor-client-ended.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ResumeContent } from "@intro-builder/shared/schemas";
import { MentorEditorClient } from "@/components/collab/mentor-editor-client";

let messageHandler: ((message: Record<string, unknown>) => void) | null = null;

vi.mock("@/hooks/use-collab-provider", () => ({
  useCollabProvider: () => ({
    ydoc: {},
    provider: {},
    isConnected: true,
    presenceUsers: [
      { userId: "owner", displayName: "作者", role: "owner", color: "#2563EB" },
      { userId: "mentor", displayName: "导师", role: "mentor", color: "#8B5CF6" },
    ],
    sendJson: vi.fn(),
    addJsonMessageListener: (handler: (message: Record<string, unknown>) => void) => {
      messageHandler = handler;
      return () => { messageHandler = null; };
    },
  }),
}));

vi.mock("@/hooks/use-collab-form-sync", () => ({
  useCollabFormSync: () => ({
    highlightedFields: new Set(),
    changeLog: [],
    isSyncing: true,
  }),
}));

vi.mock("@/hooks/use-annotations", () => ({
  useAnnotations: () => ({
    annotations: [],
    addAnnotation: vi.fn(),
  }),
}));

vi.mock("@/components/preview/live-preview", () => ({
  LivePreview: () => <div data-testid="live-preview">preview</div>,
}));

vi.mock("@/components/collab/voice-chat-controls", () => ({
  VoiceChatControls: () => null,
}));

describe("MentorEditorClient ended state", () => {
  it("switches to an ended screen when PartyKit broadcasts session-ended", async () => {
    window.sessionStorage.setItem("collab:token", "token");
    window.sessionStorage.setItem("collab:roomId", "room");
    window.sessionStorage.setItem("collab:displayName", "导师");

    render(
      <MentorEditorClient
        resumeTitle="测试简历"
        initialContent={minimalContent()}
        resolvedTemplate={{
          id: "classic",
          name: "Classic",
          description: "",
          tags: [],
          html: "<div></div>",
          css: "",
          defaultStyleSettings: {},
        }}
        mode="edit"
      />,
    );

    await waitFor(() => expect(messageHandler).toBeTruthy());
    messageHandler?.({ type: "session-ended", reason: "owner-ended" });

    expect(await screen.findByText("协作已结束")).toBeInTheDocument();
    expect(screen.getByText("作者已结束本次协作，请联系对方重新邀请。")).toBeInTheDocument();
  });
});

function minimalContent(): ResumeContent {
  return {
    basics: { name: "张三", email: "", phone: "", location: "", headline: "", links: [] },
    experience: [],
    education: [],
    projects: [],
    skills: [],
    custom: {},
    sectionOrder: ["basics"],
    styleSettings: {},
  } as ResumeContent;
}
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm --filter @intro-builder/web test -- mentor-editor-client-ended
```

Expected: FAIL because `MentorEditorClient` does not listen for `session-ended`.

- [ ] **Step 3: Implement ended listener**

In `apps/web/components/collab/mentor-editor-client.tsx`, import `CollabEndedState`:

```ts
import { CollabEndedState } from "@/components/collab/collab-ended-state";
```

In `MentorEditorClient`, add state:

```ts
const [ended, setEnded] = useState(false);
```

After `const collabState = useCollabProvider(config);`, add:

```ts
useEffect(() => {
  if (!collabState) return;
  return collabState.addJsonMessageListener((message) => {
    if (message.type === "session-ended") {
      setEnded(true);
    }
  });
}, [collabState]);
```

Before the disconnected loading state, add:

```tsx
if (ended) {
  return <CollabEndedState />;
}
```

- [ ] **Step 4: Run the mentor-ended test**

Run:

```bash
pnpm --filter @intro-builder/web test -- mentor-editor-client-ended
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/collab/mentor-editor-client.tsx apps/web/tests/unit/mentor-editor-client-ended.test.tsx
git commit -m "feat(collab): show mentor ended state in realtime"
```

---

### Task 6: Targeted Regression And Manual Smoke

**Files:**
- No new production files unless previous tasks reveal type issues.

- [ ] **Step 1: Run targeted collaboration tests**

Run:

```bash
pnpm --filter @intro-builder/web test -- collab-end-route collab-join-route collab-owner-token-route collab-session-status-route invite-collab-dialog mentor-editor-client-ended partykit-collab-server
```

Expected: PASS.

- [ ] **Step 2: Run web typecheck**

Run:

```bash
pnpm --filter @intro-builder/web typecheck
```

Expected: PASS.

- [ ] **Step 3: Run PartyKit typecheck**

Run:

```bash
pnpm --filter @intro-builder/partykit typecheck
```

Expected: PASS.

- [ ] **Step 4: Run lint for touched workspaces**

Run:

```bash
pnpm --filter @intro-builder/web lint
```

Expected: PASS.

- [ ] **Step 5: Start local services for smoke**

Run Web and PartyKit in separate terminals:

```bash
pnpm dev:web
pnpm dev:partykit
```

Expected: Web is available at `http://localhost:3000`; PartyKit starts without TypeScript/runtime errors.

- [ ] **Step 6: Manual smoke**

Use two browser contexts:

1. Owner opens a resume editor.
2. Owner creates a mentor invite.
3. Mentor opens the invite link and joins.
4. Owner sees mentor online.
5. Owner clicks "结束协作".
6. Owner toolbar returns to non-collaboration state.
7. Mentor page immediately shows "协作已结束".
8. Mentor refreshes the original link and still cannot rejoin.

- [ ] **Step 7: Run full completion gate before claiming done**

Run:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Expected: all pass. If any gate fails, fix it before reporting completion.

- [ ] **Step 8: Commit verification-only fixes if needed**

Only if Step 7 required code fixes:

```bash
git add <fixed-files>
git commit -m "fix(collab): stabilize mentor disconnect flow"
```

---

## Self-Review

Spec coverage: the plan covers the end endpoint, ended status enforcement, realtime PartyKit broadcast, owner UI clear state, mentor ended screen, and targeted/manual verification. Annotation UI and rollback are intentionally excluded.

Placeholder scan: no placeholder markers remain in this plan.

Type consistency: the plan uses `ended` consistently as the DB/application status and `session-end` / `session-ended` consistently for realtime messages. The provider helper names are `sendJson` and `addJsonMessageListener` throughout.
