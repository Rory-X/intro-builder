# Agent AI Result Cache Spec

## 背景

当前 AI 润色、AI 诊断、AI 建议和 Agent 消息入口在请求内容不变时仍会重复调用模型 provider。Redis 已用于 readiness、JWT replay guard 和 rate limit，但还没有承担 AI 结果缓存。

## 目标

- 当同一用户、同一简历、同一 AI 输入语义没有变化时，Agent 直接返回缓存结果，不再调用模型 provider。
- 缓存只影响生成结果复用，不改变 Web auth、resume ownership、Agent JWT、replay guard、用户确认写回和 autosave 语义。
- cache hit 不消耗模型调用额度；cache miss 才进入现有 rate limit 和 provider 调用。
- 返回体在缓存命中时带 `cached: true` 和 `cachedAt`，方便 Web/UI/日志识别。

## 范围

首版覆盖三个 Agent 生成入口：

- `POST /v1/rich-text/polish`
- `POST /v1/resume/helpers/:helperId`
- `POST /v1/agent/messages`

缓存 key 必须包含：

- scope
- user hash
- resume hash
- validated request payload
- prompt/cache version
- model name

## 非目标

- 不做语义相似缓存。
- 不把完整简历作为长期 memory 存 Redis。
- 不绕过 JWT replay guard。
- 不在 Web 前端本地缓存 provider 结果。

## Redis 策略

Key 形状：

```text
ai_cache:{scope}:{userHash}:{resumeHash}:{inputHash}
```

TTL：

- `rich_text:polish`: 7 天
- `resume:helper`: 24 小时
- `agent:chat`: 10 分钟

缓存 value 保存解析后的结构化响应和 `createdAt`。缓存写入失败不应让已经生成成功的请求失败；缓存读取失败也不应阻断 provider 调用。

## 验收

- 同一 AI 润色请求第二次调用不触发 provider。
- 同一 AI 诊断/建议请求第二次调用不触发 provider。
- 完全相同 Agent chat 请求第二次调用不触发 provider。
- 不同请求内容不会共用缓存。
- Web BFF 能透传 `cached` 元数据。
