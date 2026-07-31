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

For production, configure the GitHub Actions secret `COLLAB_JWT_SECRET`. The
PartyKit deployment workflow validates it and injects it with the CLI `--var`
option:

```bash
COLLAB_JWT_SECRET=... pnpm exec partykit deploy \
  --var "COLLAB_JWT_SECRET=$COLLAB_JWT_SECRET"
```

## Dependencies

- `partykit`: Server runtime
- `y-partykit`: Yjs PartyKit adapter for CRDT sync
- `jose`: JWT verification for authentication
- `@intro-builder/shared`: Shared types and utilities
