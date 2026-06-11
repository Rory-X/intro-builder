# @intro-builder/partykit

PartyKit-based real-time collaboration server for intro-builder.

## Overview

This package provides the backend server for real-time collaborative editing using PartyKit and Yjs CRDT.

## Development

```bash
# Start dev server
pnpm dev

# Type check
pnpm typecheck

# Deploy
pnpm deploy
```

## Dependencies

- `partykit`: Server runtime
- `y-partykit`: Yjs PartyKit adapter for CRDT sync
- `jose`: JWT verification for authentication
- `@intro-builder/shared`: Shared types and utilities
