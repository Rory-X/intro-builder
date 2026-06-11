# Mentor Collaboration Disconnect Design

## Status

Approved direction from product discussion: build mentor collaboration ending first. Annotation mode UI and UX is intentionally split into a later spec.

## Problem

The current collaboration flow can create an edit or comment invite, but it does not have a real end state. The "取消协作" button in the invite popover only clears local UI state; it does not revoke the invite, disconnect an online mentor, or prevent the mentor from opening the same link again before the 24-hour expiry.

This is confusing for a meeting-like mentor workflow. When the resume owner ends the collaboration, the mentor should immediately see that the owner has ended the session, and the original link should no longer work.

## Goals

1. The resume owner can explicitly end an active or pending mentor collaboration.
2. Ending a collaboration invalidates the existing invite link.
3. If the mentor is online, their current page immediately switches to an ended state that says the owner ended the collaboration.
4. If the mentor is offline or misses the realtime message, refresh and re-entry are still blocked by server state.
5. Owner UI returns to a non-collaborating state after ending the session.

## Non-Goals

Annotation mode UI, annotation threading, annotation history, and rollback mechanics are not part of this slice. Collaboration edit rollback is listed separately in `需求清单.md` and should get its own design because it touches resume content history and autosave.

## Product Behavior

The owner creates a mentor invite from the editor toolbar. Once a link exists, the same popover shows the current collaboration state and an "结束协作" action. If the session is still pending, the action cancels the invite. If the mentor has joined, the action ends the live collaboration.

After the owner confirms ending, the owner UI disconnects from the PartyKit provider, clears local collaboration state, and returns the toolbar button to the normal invite state.

If the mentor page is open, it receives a realtime `session-ended` message through PartyKit. The mentor page stops showing the editor and instead shows a clear ended screen: "作者已结束协作，请联系对方重新邀请". The browser window is not forcibly closed because normal web pages cannot reliably close windows they did not open.

If the mentor refreshes or opens the original link again, the entry page and join API reject the session as ended and show the same ended message.

## Data Model

Use the existing `collab_session` table. Do not add a new table.

The existing `status` text column becomes the lifecycle source of truth:

- `pending`: invite created, mentor has not joined.
- `active`: mentor has joined.
- `ended`: owner explicitly ended the collaboration.
- `expired`: derived or stored expiry state for sessions past `expiresAt`.

No new database column is required for this slice. An `endedAt` timestamp would only be useful if the UI needs to show an exact end time or audit history; neither is required for the current product behavior. Avoiding the column keeps this slice small and avoids a database migration.

Because the column is plain text, the database does not need a migration to accept `ended`. The application schema and tests still need to update their TypeScript unions and expectations.

## Server API

Add an owner-only endpoint:

`POST /api/collab/end`

Request body:

```json
{ "sessionId": "..." }
```

Behavior:

1. Require an authenticated user.
2. Find a `collab_session` row matching `sessionId` and `ownerId`.
3. Return `404` if the row does not exist for this owner.
4. If the session is expired, return a structured expired response and do not reactivate it.
5. Set `status` to `ended`.
6. Return `{ "status": "ended" }`.

Existing endpoints must treat `ended` as terminal:

- `/api/collab/join`: reject ended sessions before issuing a PartyKit token.
- `/api/collab/owner-token`: reject ended sessions before issuing an owner token.
- `/api/collab/session-status`: return `ended` so owner polling and UI can settle.
- `/collab/[token]`: render an ended invitation state.
- `/collab/[token]/edit`: do not render the mentor editor for ended sessions.

## Realtime Flow

DB state remains authoritative. PartyKit handles immediate UX.

When the owner ends a session while connected to PartyKit, the client sends a JSON message:

```json
{ "type": "session-end" }
```

PartyKit relays a normalized message to every other connection in the room:

```json
{
  "type": "session-ended",
  "reason": "owner-ended"
}
```

The owner should not depend on this message for correctness. The owner already has the successful `/api/collab/end` response and can disconnect locally.

The mentor client listens for `session-ended`. On receipt, it marks local state as ended, disconnects voice/collaboration UI, and renders the ended screen.

If the realtime message is missed, the server-side `ended` checks still block refresh, rejoin, and owner-token issuance.

## Client Changes

`InviteCollabDialog` should become state-aware instead of only storing an invite URL. It needs to know the active `sessionId`, call the new end endpoint, and expose an `onSessionEnded` callback so `EditorClient` can clear `collabSessionId` and `collabConfig`.

`EditorClient` should provide an end handler that:

1. Calls `/api/collab/end`.
2. Sends the PartyKit `session-end` message if a provider is connected and exposes a WebSocket-like send path.
3. Disconnects local collaboration state.
4. Shows a Chinese success or error toast.

`MentorEditorClient` should keep an `ended` local state. It should listen to provider messages for `session-ended` and render the ended screen when received.

`useCollabProvider` currently attaches message listeners internally for presence. To avoid duplicating fragile WebSocket listener logic in every component, expose a small `sendJson` and `addJsonMessageListener` interface from the hook state. This keeps PartyKit message handling centralized.

## Error Handling

If ending the session fails, the owner should stay in the current collaboration state and see a Chinese error message. Do not optimistically clear the UI before the server confirms `ended`.

If the realtime broadcast fails after the DB update succeeds, the owner still sees success. The mentor may not be kicked instantly, but any refresh or rejoin is blocked. This is acceptable because DB state is the source of truth.

If a mentor receives `session-ended` while a voice call is active, the ended screen should replace the collaboration UI. Existing voice cleanup should happen through component unmount and provider disconnect.

## Security

PartyKit currently decodes the JWT payload without verifying the signature. This is already a known TODO in the code. This slice should not expand the PartyKit trust boundary. The `session-end` message must not be allowed to become the source of truth. Only the authenticated Web API can mark a session ended.

PartyKit can relay `session-ended` for UX, but ended state must always be enforced by Web API and server-rendered entry pages.

## Testing

Add focused unit tests for:

1. `POST /api/collab/end` requires auth and owner ownership.
2. `POST /api/collab/end` marks a matching session as `ended`.
3. `POST /api/collab/join` rejects `ended`.
4. `POST /api/collab/owner-token` rejects `ended`.
5. `GET /api/collab/session-status` returns `ended`.
6. `InviteCollabDialog` calls the end endpoint and invokes `onSessionEnded` after success.
7. `MentorEditorClient` switches to ended state when receiving `session-ended`.
8. PartyKit relays `session-end` as `session-ended` to other connections.

Manual smoke for implementation:

1. Start Web and PartyKit locally.
2. Create an invite.
3. Open mentor link in a second browser context and join.
4. End collaboration from owner.
5. Confirm owner UI returns to invite state.
6. Confirm mentor page immediately shows the ended screen.
7. Refresh mentor link and confirm it cannot rejoin.

## Open Decisions

None. The selected behavior is realtime broadcast plus DB status fallback. The selected data model is the existing `collab_session.status` field without a new table or new column.
