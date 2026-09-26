# Agent Note: 把旧 Agent 微服务移出源码与部署配置

Status: implemented

## Problem

P07 任务 4 要求把旧微服务的源码与部署配置 `git mv` 进归档（保留结构），
然后移除现役 import。执行前的核实暴露了**三个必须先解决的前置问题** ——
按清单字面执行会让仓库变红或做出错误行为：

1. **清单收录了仍在服役的文件。** `lib/agent/session-store.ts` 仍在被
   `/api/agent/sessions` 实际调用（该路由由上一个提交退役）。
   `lib/agent/client.ts` 则被两个现役按钮 `import type`。
2. **`archive/` 变更会触发全量生产部署。** `affected-apps.ts` 不认这个前缀，
   于是它落进 failSafe → `{web:true, agent:true, partykit:true}`。
   实测确认过。而**归档这个 PR 的 diff 恰好全是归档路径** ——
   也就是说：不修这条，归档动作自己会把线上重新发布一遍。
3. **`apps/agent/**` 的删除会触发 web 与 partykit 部署。** 同上原因
   （路径已不存在于任何分支里，于是落进 failSafe）。

## Decision

### 1. 先迁移类型，再归档 `client.ts`

`client.ts` 里 646 行中，**大部分导出类型是现役的** ——
`RichTextPolishRequest`、`ResumeHelperId`、`ResumeHelperRequest`、
`ResumeHelperResponse` 被 5 个现役文件使用。

而新能力模块**已经自己定义了等价类型**（`lib/ai/capabilities/resume-helpers.ts`
的 `ResumeHelperSuggestion`/`ResumeHelperSection`、`polish.ts` 的
`RichTextPolishRequest`）—— 迁移时逐字移植的纯函数需要它们，
**但两个按钮的 import 忘了跟着改**。这是那批迁移的遗漏。

因此：把两个按钮的 import 改到现役能力模块（结构与语义都等价），
然后 `client.ts` 才真正没有消费者。

### 2. `archive/` 与 `apps/agent/` 都显式拦下

```ts
// INERT_PREFIXES 里
"archive/",   // 只读历史快照，不参与构建

// 路径循环里
if (path.startsWith("apps/agent/")) continue;  // 已退役，无部署目标
```

`agent` 维度**整个从 `AffectedApps` 移除**（不再有部署目标）——
留一个永远为 false 的维度会让 `emit` 输出没人消费的 `agent=...`，
并让「恰好三个 app」这类措辞名不副实。

### 3. 随模块一起归档的测试

`agent-client.test.ts`、`agent-session-store.test.ts` 测的是已归档的模块 ——
**不带走就是孤儿测试**（测一个不存在的模块）。plan 要求「旧实现不是只存在于
Git 历史」，测试也属于「旧实现」。

两个仍在现役的路由测试（`agent-resume-helper-route`、`agent-rich-text-polish-route`）
原本 mock 旧客户端并断言 `expect(createAgentClient).not.toHaveBeenCalled()`。
模块已不存在 ⇒ 那条断言**无对象可断言**。改为**源码层核实**
（`expect(readRouteSource()).not.toMatch(/lib\/agent\/(client|token)/)`）——
这比运行时断言更强：连「悄悄把它 import 回来」也能拦下。

### 4. 一个必须留回的文件：`secret.ts`

第一轮移动时我把 `token.ts`、`direct-run-client.ts`、`secret.ts` 一起移走了，
`pnpm typecheck` 立刻报 `lib/agent/token.ts(5,41): Cannot find module './secret'`。

原因：`direct-runs` 路由与 AG-UI runtime **仍属现役**（panel surface 仍在，
只是默认值已翻转）。它们归档属「删除 panel 形态」那一步，不是本步。
三个文件已移回。

## Alternatives considered

- **按清单字面执行移动**（不改清单）— 最省事。否决原因：清单是当初写下的
  **假设**，而它会留下断裂的 import（`session-store`）并且让归档 PR
  自己触发两个生产部署。执行前核实是这类「按清单操作」任务的必要步骤。
- **把 `client.ts` 整文件归档，让按钮改用新类型但保留旧文件** —
  否决原因：那 `client.ts` 就永远归档不掉，而它含**微服务 HTTP 客户端与
  JWT 签发**（是要退役的东西）。类型与桥必须分开处理。
- **只迁两个按钮用到的那几个类型，其余留给归档** — 否决原因：
  同一个文件里的类型分散在两个位置，下一个人无法判断哪个是权威定义。
- **把 `secret.ts` 也归档，让 `token.ts` 改为内联那段逻辑** —
  否决原因：`token.ts` 本身也要在「删除 panel」时归档，
  为它重构一次毫无收益。
- **给 `archive/` 加 failsafe 例外但不给 `apps/agent/`** — 否决原因：
  归档 PR 的 diff 里两者都在（`apps/agent/**` 是被删除的路径）。
  只修一半，归档仍然会重新发布线上。
- **保留 `agent` 维度但恒为 false** — 否决原因：见上，它会让断言与输出
  名不副实，且掩盖「这个 app 已经没有了」这个事实。

## Consequences

- **收益**：旧微服务的源码、测试与部署配置**真的离开了现役路径**
  （不是复制）；归档动作本身不再触发生产部署；审计清单与
  `AffectedApps` 的维度都与现实一致。
- **代价**：`affected-apps` 的接口从三维度变两维度（破坏性变更，
  但消费方只有自己的测试与两个 workflow）；lockfile 重生成
  （-1009/+290 行）。
- **已知上限（重要的部分）**：
  - **`direct-runs` / `AgentPanel` / `agent-ag-ui-runtime-provider` /
    `token.ts` / `direct-run-client.ts` / `secret.ts` 仍是现役文件。**
    它们只在**显式配 `panel`** 时可走，而默认 surface 已翻转为 `floating`。
    归档它们属「删除 panel 形态」那一步 —— 本步没做，因为它们仍可达。
  - **`AgentPanel` 相关测试仍在跑**（`agent-panel.test.tsx` 837 行、
    `agent-panel-assistant-ui.test.tsx` 3456 行）。后者**同时测浮窗**
    （27 处 `FloatingAgentChat`），因此不能整文件归档 ——
    需要先把它拆成两份。这是下一步的实际工作量。
  - **未做真实浏览器冒烟**：默认 surface 翻转（上一个 PR）与本次归档
    都还没有人在真实环境确认过。
  - **`archive/` 里的旧测试不再执行**（vitest exclude 已加）——
    这是有意的（它们测已退役实现），但意味着归档代码的**未来可执行性
    没有保障**。恢复条件写在归档 README 里。
- **什么信号发生时该重访**：若 CI 出现「归档 PR 触发了 web/partykit 部署」，
  说明 `archive/` 的 inert 前缀丢了。若 `pnpm typecheck` 报
  `Cannot find module '@/lib/agent/…'`，说明有现役文件仍在引用已归档模块 ——
  那是漏改的 import。

## Verification

- **全量**：`pnpm test` 1760 例通过（167 文件）、`pnpm typecheck` 四包全绿、
  `pnpm lint` 0 error（12 warning = 基线）、`pnpm build` 通过、
  `pnpm notes:verify` 60 篇通过。
- **包清单**：`pnpm -r list --depth -1` 已不含 `@intro-builder/agent`
  （plan 的验收条件之一），partykit 测试仍跑（11 例）。
- **归档完整性**：`agent-archive-manifest.test.ts`（19 例）——
  76 条清单、逐文件 blob + SHA-256、`source/` 存在、`apps/agent` 与
  `deploy-agent.yml` **不在现役路径**、归档实现可读。
- **部署闸门**：实测四种路径的判定 —— `archive/**` → 不部署、
  `apps/agent/**` → 不部署、`apps/web/**` → 只 web、
  `apps/partykit/**` → 只 partykit。
- **审计棘轮**：`KNOWN_LEGACY_MODULES` 从 3 降到 2（`client.ts` 已归档），
  并新增反向断言「`client.ts` 确实不在现役目录里」。
- **两个路由测试**：从「运行时没调用旧客户端」改为源码层核实（32 例通过）。
