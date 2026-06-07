# Agent Microservice Architecture

## 一句话架构

intro-builder 的 Agent 能力采用 Web 主站 + 独立 Agent 微服务的双服务架构。Web 主站保留用户身份、编辑器状态和文档写入权；Agent 微服务只处理新增 Agent 能力的模型编排、流式输出、工具调用与 Redis 支撑能力。

## 系统边界

```mermaid
flowchart LR
  Browser["Browser: editor UI"] --> Web["Next.js Web App"]
  Web --> DB["Postgres"]
  Web --> Blob["Vercel Blob"]
  Web --> Agent["Agent Microservice"]
  Agent --> Redis["Redis"]
  Agent --> Provider["Model Provider"]
  Caddy["Caddy"] --> Agent

  Web -. "short-lived Agent JWT" .-> Agent
  Agent -. "streamed suggestion" .-> Web
  Web -. "RHF write / autosave" .-> Browser
```

## 服务职责

| 系统 | 负责 | 不负责 |
| --- | --- | --- |
| Browser | 用户交互、局部选择、取消请求、展示 streaming 状态 | 保存最终真源、持有 provider key |
| Next.js Web App | auth、resume ownership 校验、短期 Agent JWT、React Hook Form、preview、autosave | 模型编排、长期 Agent memory、provider 直连 |
| Agent Microservice | prompt、model call、streaming、tool calling、Redis memory/rate limit、结构化错误 | 用户登录、resume DB 写入、编辑器状态 |
| Redis | rate limit、jti replay guard、短期 memory、后续 job/stream state | 永久简历内容真源 |
| Postgres | 用户、简历、模板、分享链接等主数据 | Agent 临时 memory |

## 当前已实现

- `apps/agent` 作为独立 pnpm workspace package。
- Node HTTP 服务入口：`apps/agent/src/index.ts`。
- 配置解析：`apps/agent/src/config.ts`。
- HTTP contract：`apps/agent/src/http.ts`。
- 测试：`apps/agent/tests/config.test.ts`、`apps/agent/tests/http.test.ts`。
- 部署骨架：`Dockerfile`、`compose.yaml`、`Caddyfile`。

## 下一层架构

Phase 0B 后，Agent 服务应该具备这些内部模块：

```mermaid
flowchart TB
  Server["HTTP server"] --> Middleware["request id / error envelope / auth"]
  Middleware --> Routes["versioned routes"]
  Routes --> RateLimit["rate limit"]
  Routes --> RedisHealth["Redis readiness"]
  Routes --> Agents["Agent capability handlers"]
  Agents --> Prompts["prompt builders"]
  Agents --> Providers["model provider adapters"]
  Agents --> Tools["tool registry"]
  RateLimit --> Redis["Redis"]
  RedisHealth --> Redis
  Providers --> Model["OpenAI-compatible provider"]
```

## 调用形态

### 短请求

适合 health、ready、capabilities、session 验证、非生成型 metadata。

要求：

- Web 端统一通过 Agent client 调用。
- 允许有限 retry，只用于幂等 GET 或只读请求。
- 响应必须是 JSON。

### 流式生成请求

适合富文本润色、模块建议、聊天式 Agent panel。

要求：

- 使用短期 JWT。
- 支持 AbortController 取消。
- 不做盲目 retry。
- 每个 chunk 必须有类型，不能让前端猜字符串语义。
- Web 端仍负责确认写回和 autosave。

## 稳定性原则

1. `/health` 只代表进程存活，不依赖 Redis 或模型 provider。
2. `/ready` 代表服务可接业务流量，应检查 Redis 等关键依赖。
3. Agent 服务不可用时，Web 编辑器、preview、autosave 必须继续可用。
4. 模型 provider key 不进入浏览器，也不进入 Next.js client bundle。
5. 所有 Agent 请求必须带 request id，并在 Web 与 Agent 日志间贯通。
6. 生成类请求默认非幂等，失败后由用户显式重试。
7. Redis 只存临时状态，不成为简历内容真源。
8. 旧 OCR、导入简历、AI 解析不穿过这个微服务，除非未来有单独迁移 plan。

## 香港 2C4G 部署约束

香港服务器资源较小，架构要主动限制常驻开销：

- Node 进程保持单服务优先，不一开始拆多个 worker。
- Redis 与 Agent 可同机部署，但需要限制日志体积和内存策略。
- Caddy 负责 TLS、gzip/zstd、反代和基础安全 header。
- Agent 进程必须有 readiness endpoint，方便未来加入 systemd、compose healthcheck 或外部监控。
- streaming 请求要限制最大并发、最大输入长度、最大输出时间。

## 不做的架构

- 不把 Agent 能力塞进 Next.js route handler 里长期运行。
- 不让浏览器直接持有 provider key。
- 不把 resume content 的最终写入权交给 Agent 服务。
- 不一开始引入复杂队列系统。
- 不为了单个富文本按钮引入 assistant-ui。
