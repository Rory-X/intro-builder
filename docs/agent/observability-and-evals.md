# Agent Observability And Evals

本文档说明 Agent Mode 的 Langfuse 接入边界、隐私约束和评测命令。

## 目标

- 让 `/v1/agent/messages` 的一次运行可以按 request id 追踪到 cache、provider、parse、tool card、proposal count 和错误状态。
- 让 Agent 结构化输出 contract 可以在 CI 本地离线评测，不依赖 Langfuse 凭据或 live model。
- 当配置 Langfuse 凭据时，把同一套 deterministic eval cases 作为 Langfuse experiment 跑起来，便于后续比较 prompt、模型和 parser 改动。

## Langfuse Tracing

Agent 服务默认不启用 Langfuse。必须同时满足：

```bash
LANGFUSE_TRACING_ENABLED=true
LANGFUSE_PUBLIC_KEY=...
LANGFUSE_SECRET_KEY=...
```

可选配置：

```bash
LANGFUSE_BASE_URL=https://cloud.langfuse.com
LANGFUSE_TRACING_ENVIRONMENT=development
LANGFUSE_RELEASE=0.0.0-dev
LANGFUSE_TIMEOUT=5
LANGFUSE_SAMPLE_RATE=1
```

启用后，Agent 服务会通过 `apps/agent/src/observability.ts` 创建项目自有 adapter。业务代码只依赖 `AgentObservability`，不直接调用 Langfuse SDK。

### 记录内容

默认 trace metadata 包含：

- `requestId`
- `workflowId`
- `serviceName`
- `serviceVersion`
- `environment`
- `modelName`
- hashed `userHash`
- `resumeId`
- `activeSection`
- message 和 section 数量
- cache hit/miss
- parse success/failure
- tool call 和 proposed operation 数量
- interrupt reason summary
- provider usage token 计数

### 隐私规则

默认不上传：

- 简历原文
- 用户自由输入
- provider prompt 全文
- provider output 全文
- provider API key、JWT、authorization token

仅本地排查可临时开启：

```bash
LANGFUSE_CAPTURE_RAW_PAYLOADS=true
```

生产环境保持 `false`。

## Offline Evals

离线评测数据位于：

```text
apps/agent/evals/agent-message-contract-cases.json
```

评测逻辑位于：

```text
apps/agent/src/evals/agent-message-contract-eval.ts
```

运行：

```bash
pnpm --filter @intro-builder/agent eval:agent:offline
```

它会复用生产 parser `parseAgentMessageProviderResponse`，并检查：

- provider output 是否是合法 JSON
- Agent message/tool/proposed operation contract 是否有效
- proposed operation 数量
- 必要 risk flag
- 必要 field path
- forbidden fabrication token 是否不存在

任一必需分数失败时命令非零退出。

## Langfuse Experiment

配置 `LANGFUSE_PUBLIC_KEY` 和 `LANGFUSE_SECRET_KEY` 后可运行：

```bash
pnpm --filter @intro-builder/agent eval:agent:langfuse
```

该命令不要求 `LANGFUSE_TRACING_ENABLED=true`；tracing flag 只控制服务运行期 trace。experiment 只需要 Langfuse 凭据。

可选指定 run name：

```bash
LANGFUSE_EXPERIMENT_RUN_NAME=agent-message-contract-pr-123 pnpm --filter @intro-builder/agent eval:agent:langfuse
```

没有凭据时命令会打印 skip message 并以 0 退出，避免阻塞本地开发和 CI。

## 排查卡住状态

当 UI 卡在“正在使用工具”或等待态时，优先按 request id 查 Langfuse trace：

1. 看 `agent.message.run` 是否结束以及 output status。
2. 看 `agent.message.provider` 是否超时或报错。
3. 看 `parseStatus` 是 `ok` 还是 `error`。
4. 看 `toolCallCount`、`proposedOperationCount` 和 `interruptReasons` 是否符合预期。
5. 如果 trace 已完成但 UI 仍等待，转向 Web BFF、AG-UI event adapter 和 assistant-ui 状态映射。
