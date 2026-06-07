# Agent Service Foundation Design

**Status:** Approved by follow-up instruction to start building the basic agent service.

## Goal

Create the first runnable foundation for the new Agent microservice without implementing any resume-polish, prompt, model, memory, or tool-calling behavior yet.

## Product Boundary

This service is only for new Agent capabilities. Existing OCR, resume import, and AI parsing stay in the current shipped system and are not migrated by this work.

The Web app remains responsible for auth, short-lived Agent JWT issuance, editor UI, React Hook Form state, preview, and autosave. The Agent service will eventually own model calls, prompts, streaming, tool calling, Redis memory / rate limits, and Docker / Caddy deployment.

## Foundation Slice

This first slice creates `apps/agent` as an independent pnpm workspace package. It exposes a small Node HTTP server with health and readiness endpoints, typed configuration loading, graceful shutdown, and local/deploy entrypoints.

The server intentionally has no model provider dependency and no Redis client yet. Those belong to later slices once the Web-to-Agent JWT contract and Phase 1 polish API are specified.

## Runtime Contract

- `GET /health` returns `200` JSON with service name, status, version, uptime, and timestamp.
- `GET /ready` returns `200` JSON with readiness status and the same service identity fields.
- Unknown paths return `404` JSON.
- Unsupported methods on known endpoints return `405` JSON.
- Config defaults are local-development friendly: host `0.0.0.0`, port `8787`, service name `intro-agent`.
- Invalid ports fail fast during startup.

## File Ownership

- `apps/agent/src/config.ts`: typed environment parsing and validation.
- `apps/agent/src/http.ts`: route handling and JSON response helpers.
- `apps/agent/src/index.ts`: process entrypoint, listen, logging, graceful shutdown.
- `apps/agent/tests/*.test.ts`: node-environment unit tests for config and HTTP behavior.
- `apps/agent/Dockerfile`: production image for the microservice.
- `apps/agent/Caddyfile`: reverse proxy template for the Hong Kong server.
- `apps/agent/.env.example`: local and deploy configuration hints.

## Non-Goals

- No OpenAI / model provider calls.
- No prompt templates.
- No streaming endpoint.
- No tool-calling runtime.
- No Redis connection.
- No JWT verification yet.
- No Web app UI changes.
- No assistant-ui integration.

## Verification

- Agent package tests must pass through `pnpm --filter @intro-builder/agent test`.
- Root `pnpm test` must keep passing and include the agent test command.
- Root `pnpm tsc --noEmit`, `pnpm lint`, and `pnpm build` must still pass.
