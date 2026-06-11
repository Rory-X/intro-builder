# Agent Diagnosis Timeout Spec

## Why

`AI 简历诊断` 是一次非流式 JSON 生成请求。当前 Web Agent client 的普通 JSON
timeout 默认为 10 秒，而 Agent 服务端模型调用默认允许 20 秒。诊断内容较长时，
Web 侧会先 abort 请求，Next route 再把 `agent_timeout` 脱敏成
`Agent 服务暂不可用`，用户无法判断是生成超时还是服务不可用。

## What

- 生成类 JSON 请求使用独立、更长的 timeout，不再复用 10 秒会话/轻量请求预算。
- `resume-diagnose` 和 rich text polish 这类模型生成链路默认允许 90 秒，与流式聊天
  预算保持一致。
- Agent 服务端模型 provider 默认 timeout 同步提高到 90 秒，避免 Web 侧放宽后仍在
  20 秒触发 `provider_timeout`。
- 诊断 helper route 显式声明 `maxDuration`，避免 Vercel 项目级默认时长被调低时
  先于应用层 timeout 终止请求。
- 诊断 route 和 UI 在 `agent_timeout` / `provider_timeout` 时返回可恢复中文文案：
  `AI 生成超时，请稍后重试或减少简历内容后再试`。

## Non-goals

- 不改变诊断结果 schema。
- 不改模型 prompt、provider 或缓存策略。
- 不隐藏 request id / code，方便线上排障。

## Definition of Done

- `tests/unit/agent-client.test.ts` 覆盖生成类 JSON 请求不会在 10 秒默认预算处中断。
- `tests/unit/agent-resume-helper-route.test.ts` 覆盖 timeout 错误映射为可操作文案。
- `tests/unit/resume-diagnose-button.test.tsx` 覆盖 UI 使用 timeout code 时展示可操作文案。
- `apps/agent/tests/config.test.ts` 覆盖 Agent 模型默认 timeout 为 90 秒。
- `tests/unit/agent-resume-helper-route.test.ts` 覆盖 helper route 的 `maxDuration`。
- 定向测试、`pnpm tsc --noEmit`、`pnpm lint` 通过。
