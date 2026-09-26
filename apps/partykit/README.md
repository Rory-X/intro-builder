# @intro-builder/partykit

PartyKit-based real-time collaboration server for intro-builder.

## Overview

This package provides the backend server for real-time collaborative editing using PartyKit and Yjs CRDT.

## Development

```bash
# From the repository root
pnpm --filter @intro-builder/partykit test
pnpm --filter @intro-builder/partykit typecheck
pnpm --filter @intro-builder/partykit dev
```

PartyKit does not expose an offline `build` subcommand in the pinned CLI. The
package `build` script therefore runs `tsc --noEmit`; deployment performs the
actual worker bundle.

## Authentication

Both the Web application and PartyKit deployment must use the same
`COLLAB_JWT_SECRET`. Connections are rejected before Yjs synchronization when
the token is missing, invalid, expired, or issued for another room.

For production the secret is stored on the PartyKit platform itself, alongside
the Web app's signing endpoints, and the Worker reads it from
`room.env.COLLAB_JWT_SECRET`:

```bash
# One-off, per project (intro-collab). Prompts for the value, or pipe it in.
pnpm exec partykit env add COLLAB_JWT_SECRET
pnpm exec partykit env list           # expect: Deployed variables: COLLAB_JWT_SECRET
```

Deployment is then a plain `partykit deploy` and needs no secret of its own:

```bash
pnpm exec partykit deploy
```

The deploy workflow deliberately does not pass `--var`, so it requires no
`COLLAB_JWT_SECRET` GitHub Actions secret. See
`docs/notes/implemented/architecture/2026-09-26-collab-secret-lives-on-platform.md`
for why the earlier `--var` injection was removed.

The value must match the Web app's `COLLAB_JWT_SECRET` environment variable;
otherwise the Web side signs tokens the Worker cannot verify and every
connection is closed with 4401.

## Dependencies

- `partykit`: Server runtime
- `y-partykit`: Yjs PartyKit adapter for CRDT sync
- `jose`: JWT verification for authentication
- `@intro-builder/shared`: Shared types and utilities
