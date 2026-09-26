# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.4 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/agent/package.json apps/agent/package.json
# The root workspace postinstall builds docs and needs files that are not part of
# the Agent image context, so keep this install scoped to dependencies only.
RUN pnpm install --frozen-lockfile --filter @intro-builder/agent... --ignore-scripts

COPY apps/agent apps/agent
RUN pnpm --filter @intro-builder/agent build

FROM node:22-alpine AS runner
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.4 --activate

ENV NODE_ENV=production
ENV AGENT_HOST=0.0.0.0
ENV AGENT_PORT=8787

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/agent/package.json apps/agent/package.json
RUN pnpm install --prod --frozen-lockfile --filter @intro-builder/agent --ignore-scripts

COPY --from=build /app/apps/agent/dist apps/agent/dist

WORKDIR /app/apps/agent

EXPOSE 8787

CMD ["node", "dist/index.js"]
