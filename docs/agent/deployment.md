# Agent Deployment Runbook

本文档记录 Agent 微服务当前的服务器、Docker Compose、GitHub Actions 和 DNS 状态。它只覆盖新增 Agent 微服务，不涉及已上线的 OCR、导入简历、AI 解析迁移。

## Current Status

Status date: 2026-06-06

- Server: `101.36.117.253`
- OS: CentOS Stream 9
- Deploy user: `intro-deploy`
- Deploy path: `/opt/intro-agent`
- GitHub repo: `Rory-X/intro-builder`
- Deploy workflow: `.github/workflows/deploy-agent.yml`
- Agent domain variable: `api.rory-x.me`
- Public base path: `/intro-builder/agent`
- Public Agent base URL: `https://api.rory-x.me/intro-builder/agent`
- Current public DNS/Cloudflare status: `api.rory-x.me` resolves through Cloudflare Proxied DNS and public `/health` plus `/ready` return `200`.

## Server Setup

Docker was installed from Docker's official CentOS RPM repository, which supports CentOS Stream 9 and installs Docker Engine plus the Compose plugin via `dnf`.

Installed versions:

```bash
docker --version
# Docker version 29.5.3

docker compose version
# Docker Compose version v5.1.4
```

System service:

```bash
systemctl is-active docker
# active
```

Firewall status on the server includes open `80/tcp` and `443/tcp`.

The long-lived deploy user is `intro-deploy`, not `root`. It is a member of the `docker` group and owns `/opt/intro-agent`.

## Compose Stack

The production stack is managed from:

```bash
cd /opt/intro-agent/apps/agent
docker compose ps
```

Services:

- `agent`: Node 22 Agent HTTP service, internal port `8787`.
- `redis`: `redis:8-alpine`, append-only persistence enabled.
- `caddy`: `caddy:2-alpine`, public `80`/`443`, reverse proxies to `agent:8787`.

Persistent Docker volumes:

- `agent_redis_data`
- `agent_caddy_data`
- `agent_caddy_config`

Server environment file:

```bash
/opt/intro-agent/apps/agent/.env
```

Current non-secret keys:

```bash
AGENT_HOST=0.0.0.0
AGENT_PORT=8787
AGENT_SERVICE_NAME=intro-agent
AGENT_VERSION=<set by deploy>
AGENT_SHUTDOWN_TIMEOUT_MS=10000
AGENT_SITE_ADDRESS=api.rory-x.me
AGENT_PUBLIC_BASE_PATH=/intro-builder/agent
REDIS_URL=redis://redis:6379
```

## GitHub Actions Deployment

Workflow:

```bash
.github/workflows/deploy-agent.yml
```

Triggers:

- `push` to `main` when Agent-related files change.
- Manual `workflow_dispatch`.

Path filters:

- `apps/agent/**`
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `.dockerignore`
- `.github/workflows/deploy-agent.yml`

Deployment steps:

1. Checkout repository.
2. Install with pnpm 10 on Node 22.
3. Run `pnpm verify`.
4. Run `pnpm agent:build`.
5. Configure SSH from GitHub Secrets.
6. Sync deploy files with `rsync`.
7. Run `docker compose up -d --build --remove-orphans`.
8. Verify `agent` direct health and Caddy local TLS health.

Configured GitHub Secrets:

```text
AGENT_SSH_HOST
AGENT_SSH_PORT
AGENT_SSH_USER
AGENT_SSH_KEY
AGENT_SSH_KNOWN_HOSTS
```

Configured GitHub Variables:

```text
AGENT_DEPLOY_PATH=/opt/intro-agent
AGENT_DOMAIN=api.rory-x.me
AGENT_PUBLIC_BASE_PATH=/intro-builder/agent
```

The workflow uses `intro-deploy`, not `root`.

## Verification Record

Baseline verified on 2026-06-05 before the public domain/path change:

```bash
actionlint .github/workflows/deploy-agent.yml
# passed

pnpm verify
# passed
```

Remote deploy smoke before the domain/path change:

```bash
docker compose ps
# agent, caddy, redis are running

docker compose exec -T agent node -e 'fetch("http://127.0.0.1:8787/health").then(async r => console.log(await r.text()))'
# {"status":"ok",...}
```

After the 2026-06-06 domain change, verified:

- GitHub Variables: `AGENT_DOMAIN=api.rory-x.me`, `AGENT_PUBLIC_BASE_PATH=/intro-builder/agent`.
- Server `.env`: `AGENT_SITE_ADDRESS=api.rory-x.me`, `AGENT_PUBLIC_BASE_PATH=/intro-builder/agent`.
- `pnpm verify` passes locally after the domain/path change.
- `docker compose ps`: `agent`, `caddy`, and `redis` are running.
- Direct Agent health inside the server returns `200`.
- `caddy adapt --config /etc/caddy/Caddyfile` confirms host `api.rory-x.me`, paths `/intro-builder/agent` and `/intro-builder/agent/*`, and `strip_path_prefix: /intro-builder/agent`.
- Caddy logs show `certificate obtained successfully` for `api.rory-x.me`.
- Public `https://api.rory-x.me/intro-builder/agent/health` returns `HTTP/2 200`.
- Public `https://api.rory-x.me/intro-builder/agent/ready` returns `HTTP/2 200`.

Observed DNS after Cloudflare was updated:

```bash
dig +short api.rory-x.me A
# 172.67.140.67
# 104.21.8.214
```

Because those are Cloudflare edge IPs, the current record is Proxied. The origin Caddy path is also healthy:

```bash
curl -kfsS --resolve "api.rory-x.me:443:127.0.0.1" \
  "https://api.rory-x.me/intro-builder/agent/health"
# {"status":"ok",...}

curl -kfsS --resolve "api.rory-x.me:443:127.0.0.1" \
  "https://api.rory-x.me/intro-builder/agent/ready"
# {"status":"ready",...}
```

## DNS and Cloudflare

Previous observation from local development machine for the now-deprecated second-level host:

- `api.intro-builder.rory-x.me` resolves to Cloudflare edge IPs.
- `http://api.intro-builder.rory-x.me/health` returns a Cloudflare HTTP -> HTTPS redirect.
- `https://api.intro-builder.rory-x.me/health` fails during TLS handshake.
- Direct Caddy TLS from inside the server succeeds.

Cloudflare's Universal SSL coverage for a full setup covers the root domain and first-level subdomains. If the active Cloudflare zone is `rory-x.me`, then `api.intro-builder.rory-x.me` is a second-level subdomain and is not covered by the default Universal SSL certificate.

Selected option on 2026-06-06:

- Use first-level hostname `api.rory-x.me`.
- Expose this project under path prefix `/intro-builder/agent`.
- Public health URL becomes `https://api.rory-x.me/intro-builder/agent/health`.

Cloudflare DNS record should be:

```text
Type: A
Name: api
Content: 101.36.117.253
Proxy status: Proxied is the current working state; DNS only is also valid for direct Caddy debugging
```

The current production path is Cloudflare Proxied -> Caddy -> Agent. Since Caddy has a valid Let's Encrypt origin certificate, Cloudflare SSL/TLS mode should be `Full (strict)` where possible. Do not use `Flexible`.

DNS-only remains useful when debugging origin connectivity because clients connect directly to Caddy and bypass Cloudflare cache/WAF/edge behavior.

Historical server-side Caddy status before DNS was added:

```text
DNS problem: NXDOMAIN looking up A for api.rory-x.me
```

This meant the Caddy config was loaded, but certificate issuance was waiting for DNS. It is no longer the current state.

Current public verification commands:

```bash
dig +short api.rory-x.me A
# Cloudflare edge IPs when Proxied, or 101.36.117.253 when DNS-only

curl -sS -i https://api.rory-x.me/intro-builder/agent/health
curl -sS -i https://api.rory-x.me/intro-builder/agent/ready
```

Both should return `200` JSON.

## Runtime Dependency Note

The Agent service now has a production runtime dependency on `redis`. The Dockerfile runner stage uses a scoped production install for `@intro-builder/agent`, so runtime dependencies are present without copying the full Web app dependency graph into the Agent image.

Before adding provider SDK runtime dependencies, keep the same scoped runner strategy and verify the server image build again.

Required check after changing runtime dependencies:

```bash
docker compose up -d --build
docker compose exec -T agent node -e 'fetch("http://127.0.0.1:8787/health").then(async r => console.log(await r.text()))'
docker compose exec -T agent node -e 'fetch("http://127.0.0.1:8787/ready").then(async r => console.log(r.status, await r.text()))'
```

## Useful Operations

Inspect containers:

```bash
ssh intro-deploy@101.36.117.253
cd /opt/intro-agent/apps/agent
docker compose ps
docker compose logs --tail=100 agent
docker compose logs --tail=100 caddy
docker compose logs --tail=100 redis
```

Manual redeploy from server directory:

```bash
cd /opt/intro-agent/apps/agent
docker compose up -d --build --remove-orphans
```

Rollback expectation:

- Web editor, preview, and autosave must continue working when Agent is down.
- Agent deployment should not require rolling back the Web app unless the Web-to-Agent client contract changed.
