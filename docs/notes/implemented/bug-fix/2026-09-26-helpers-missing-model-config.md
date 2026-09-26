# Agent Note: 迁移后调用方漏传模型配置（一次被测试盲区掩盖的回归）

Status: implemented

## Problem

P05 任务 4 把润色与 helpers 三条路径从「HTTP 转发到 Agent 微服务」改成
「Web 侧直连」时，服务端的契约随之改变：**缺 `modelConfig` 会返回
`model_not_configured`**，不再回退已退役的服务。

润色那条路径的调用方（`rich-text-editor.tsx`）我同步改了，但 **helpers 的两个
调用方漏了**：

- `components/agent/section-helper-button.tsx`
- `components/agent/resume-diagnose-button.tsx`

它们经 `requestResumeHelper()` 发请求，body 里没有 `modelConfig`。
后果是这两个按钮在真实使用中**必然失败**（拿到 `model_not_configured`），
而 `pnpm typecheck`、`pnpm lint`、`pnpm build` 全部通过 ——
这是一个纯运行时的功能回归。

## 为什么没被发现

**既有测试没有覆盖这个字段**。`resume-diagnose-button.test.tsx` 与
`section-helper-button.test.tsx` 断言了 `resumeId` / `target` / `intent` /
`context`，但没断言 `modelConfig`。

于是：改了服务端契约 → 调用方漏传 → 测试照常通过。
测试覆盖的是「我改之前就存在的东西」，对新契约没有任何防线。

**这是本次最值得记住的一点**：迁移服务端契约时，
「改了 A 端」与「A 端的测试通过」完全不能推出「B 端也跟着改了」。
测试的通过只说明它断言的那些东西没坏。

## Decision

### 1. 调用方补上配置

`requestResumeHelper()` 在发送前合并 `modelConfig`，来源与浮窗、润色**同一份**：

```ts
const requestBody = isRecord(body) ? { ...body, modelConfig: currentModelConfig() } : body;
```

`currentModelConfig()` 用 `readStoredAgentModelSettings()`（它内部已合并
sessionStorage 的 apiKey）+ `readSessionAgentModelApiKey()`，与
`rich-text-editor.tsx` 里的实现一致。

刻意**保留显式调用 `readSessionAgentModelApiKey()`**：`readStoredAgentModelSettings()`
已经合并了它，所以这一行在功能上是冗余的 —— 但它让「key 存在 sessionStorage、
不落 localStorage」这件事在调用点可见，而不是藏在另一个函数的实现细节里。
这类安全相关的行为值得在阅读路径上显式出现。

### 2. 测试补上断言（真正的修复点）

两个测试各加两条：

- 预置模型配置（localStorage 的 baseUrl/modelName + sessionStorage 的 apiKey）；
- 断言请求体里的 `modelConfig` 等于预置值。

补断言时立刻发现：**不预置配置时 `modelConfig` 是 `null`** ——
这正说明此前即使加了断言也会因为没有配置而「通过得没有意义」
（断言 `null` 满足不了 `toMatchObject`，所以会失败）。两件事要一起做。

## Alternatives considered

- **只在服务端放宽：缺配置时回退到旧微服务** — 调用方不用改，按钮立刻能用。
  否决原因：这正是 P07/P08 要退役的那条路径。回退会让「旧服务无请求」
  这个退役信号永远达不到，也会让用户看到「明明没配模型却能诊断」。
- **服务端改为从环境变量取默认 provider** — 调用方同样不用改。
  否决原因：spec 任务 5 允许迁移服务端默认 provider，但要求「使用新的 Web-only
  环境键并在部署中安全转移值」。当前没有这样的配置，凭空加一个环境键依赖
  等于把「没配就报错」换成「配错了才报错」，更难排查。
- **只改调用方，不补测试断言** — 修好了就行。否决原因：那样下次改服务端契约时
  同一个坑会再踩一次。这次回归能发生，根因就是断言缺失，不是代码写错。
- **让 `requestResumeHelper` 在缺配置时不加 `modelConfig` 字段**（保持原样）—
  否决原因：服务端需要区分「没配模型」与「传了空配置」，前者应给出
  `model_not_configured` 的具体提示。始终带上（可能为 `null`）让服务端拿到
  一致的输入形状，由它统一决定怎么报错。
- **把 helpers 的调用收进一个共享模块**（像 `rich-text-editor` 那样）—
  减少重复。否决原因：两个按钮已经共用 `requestResumeHelper()`，
  它就在 `resume-diagnose-button.tsx` 里被导出。位置不够理想但不值得为此
  在新切片里重构（那会扩大改动面，而这正是本次回归的成因模式）。

## Consequences

- **收益**：helpers 两个按钮恢复可用；两个测试现在对「请求必须带模型配置」
  有机械防线。
- **代价**：`resume-diagnose-button.tsx` 里多了一个 `currentModelConfig()`，
  与 `rich-text-editor.tsx` 里的实现重复（两处约 8 行）。这是有意的重复：
  共享需要新建模块，而当前正确性优先于去重。
- **已知上限**：
  - 三段重复的 `currentModelConfig()`（浮窗用 `toAgentModelConfig(modelSettings)`，
    另两处各写一遍）。若将来有第四处，应当抽成共享模块。
  - 测试断言的是「配置被带上」，**不是**「服务端接受它」。端到端仍需要
    真实浏览器冒烟（尚未做）。
- **什么信号发生时该重访**：若出现第三处需要读模型配置的调用点，
  抽 `lib/agent/current-model-config.ts`。若用户报告「按钮说没配模型但我配过了」，
  先查 `readStoredAgentModelSettings()` 的合并逻辑（它跨 localStorage 与
  sessionStorage 两处，是最可能的失效点）。

## Verification

- `apps/web/tests/unit/resume-diagnose-button.test.tsx`（2 例）与
  `section-helper-button.test.tsx`（1 例）：预置配置后断言请求体的
  `modelConfig` 等于预置值。
- **红 → 绿证据**：加断言后立刻失败（`expected null to match object`），
  说明此前断言缺失确实掩盖了回归；补上调用方合并逻辑后通过。
- 全量：`pnpm test` 1326 例通过、`typecheck` 四包全绿、
  `lint` 0 error（12 warning = 基线）。
