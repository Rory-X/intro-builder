# Agent Note: 默认形态翻转为 floating —— 默认用户不再经过待退役的微服务

Status: implemented

## Problem

P07 任务 3 的核心动作之一是「翻转默认 surface」。核实后发现它不是一个
界面偏好问题，而是一个**退役进展**问题 —— 两种形态走**不同的服务端路径**：

| 形态 | 服务端路径 | 是否依赖旧微服务 |
|---|---|---|
| `panel` | `AgentPanel` → AG-UI runtime → `/api/agent/direct-runs` | **是**（签发 JWT + 把 `streamUrl` 指向微服务） |
| `floating` | `/api/agent/floating/chat` | 否（Web 侧直接用 AI SDK） |

也就是说：**默认形态决定了默认用户是否还在依赖待退役的微服务**。

而此前默认是 `panel` —— 退役审计（`agent-retirement-audit.test.ts`）
把这个事实钉成了一条断言：`expect(readAgentSurface({})).toBe("panel")`。
那条断言的设计意图就是「**它失败的时候正是翻转完成的时候**」。

## Decision

把默认值从 `panel` 翻转为 `floating`，取值语义也随之反转：

```ts
// 翻转前：raw === "floating" ? "floating" : "panel"
// 翻转后：raw === "panel" ? "panel" : "floating"
```

**只有显式 `panel` 才回到旧面板。无法识别的取值按 `floating` 处理** ——
与之前相反，而这是有意的：`panel` 会走 `direct-runs`（依赖待退役的微服务），
**拼错的开关名不该把用户留在一条正在退役的路径上**。

### 为什么现在可以翻转

浮窗一侧的前置能力已全部就绪：

- 分流点与 `runBridge` 注入（前两个提交）；
- 事件翻译（`floating-adapter`）；
- 内容同步（`commit-sync`，含基准内容的修正）；
- 消息持久化（`buildPersistableAssistantMessage`）；
- 且 `floating/chat` 本身**不依赖微服务**。

因此翻转后默认用户不再经过 `direct-runs`。

### 翻转**不等于**启用统一 Run 路由

统一 Run 路由仍由 `NEXT_PUBLIC_AI_RUN_PATH` 控制（见 `run-path-flag`）。

两件事刻意分开：
- **本步**只把默认形态从「旧面板」换成「浮窗」—— 后者本身已是 Web 自足路径；
- **启用统一 Run 路由**是另一步，需要开关 + 人工冒烟。

混在一起会让「默认形态」这个可见变化与「新链路可用性」这个未验证变化
同时上线，出问题时无法区分是哪一边。

## 实测：3 处断言的更新是**预期信号**，不是回归

翻转后 3 例失败：

- `agent-surface.test.ts`：「默认回落 panel」
- `agent-retirement-audit.test.ts`：「**默认 surface 是 panel**」
- `agent-retirement-audit.test.ts`：「取值不认识时回落到 panel」

**这正是 plan 与笔记里预告过的信号**（那条断言的设计意图就是标记翻转时刻）。
已更新为记录新事实，并在注释里写明翻转前后的差异与仍欠的债。

**仍欠债的部分**：`direct-runs` 那条路径**本身**仍在
`KNOWN_LEGACY_CALL_SITES` 里（显式配 `panel` 时才会走）——
余额数字不变（2 处），但**默认路径已经不再经过它**。
这是「欠债余额」与「默认可达性」两个不同维度的进展。

## Alternatives considered

- **保持默认 `panel`，只靠开关灰度** — 最保守。否决原因：那样默认用户的
  流量**仍在待退役的服务上**，而 P07 的目标正是让默认路径离开它。
  开关只控制「新统一路由是否启用」，与「默认界面形态」是两件事。
- **同时启用统一 Run 路由**（翻转 + 开开关）— 一步到位。
  否决原因：新统一路由**从未在真实浏览器冒烟过**。把它与默认形态翻转一起
  上线，一旦出问题无法区分是「浮窗有问题」还是「新路由有问题」。
- **无法识别的取值仍回落到 `panel`** — 与之前行为一致，改动更小。
  否决原因：见上 —— 那会把拼错开关名的用户留在一条正在退役的路径上。
  回落到 `floating` 让拼错只导致「用新形态」，而不是「继续用待退役路径」。
- **删除 `panel` 形态**（不再支持）— 退役最彻底。
  否决原因：`direct-runs` 与 `AgentPanel` 的归档是 P07 任务 3/4 的后续步骤，
  且显式配置 `panel` 的能力对排查有用（需要时能切回去看旧行为）。
  先翻转默认值，删除留给归档步骤。
- **翻转的同时改 `agent-retirement-audit` 的清单数字** —
  否决原因：清单记的是**调用点是否存在**，而翻转改的是**默认是否经过它**。
  两者是不同维度，混在一起会让「余额」失去意义。

## Consequences

- **收益**：默认用户不再经过待退役的微服务路径；「默认 surface」这条审计断言
  完成了它的设计使命（标记翻转时刻）。
- **代价**：默认界面形态变化 —— 用户看到的从「侧边面板」变成「浮窗」。
  需要**人工冒烟**确认浮窗/停靠、移动端、暗色、键盘都正常。
- **已知上限**：
  - **未做人工冒烟**。这是本次翻转最重要的未验证项 ——
    界面形态变化必须由人在真实浏览器确认（浮窗/停靠、移动端、暗色、键盘）。
    若要临时回到旧形态，显式设 `AGENT_ASSISTANT_SURFACE=panel`。
  - **`direct-runs` 与 `AgentPanel` 代码仍在现役**：显式配 `panel` 时仍会走
    待退役的微服务。归档它们是任务 3/4 的后续步骤。
  - **统一 Run 路由仍未启用**（`NEXT_PUBLIC_AI_RUN_PATH` 未设）：
    浮窗当前走 `/api/agent/floating/chat`（Web 自足，但不带 Run 的幂等/租约/留痕）。
- **什么信号发生时该重访**：若人工冒烟发现浮窗有问题而旧面板正常，
  可以先用 `AGENT_ASSISTANT_SURFACE=panel` 回退（这条回退能力是刻意保留的）。
  若要完成归档，需要：确认浮窗冒烟通过 → 启用统一 Run 路由 →
  删除 `panel` 形态与 `direct-runs` → 归档 `apps/agent`。

## Verification

- `apps/web/tests/unit/agent-surface.test.ts`（更新）：
  **默认是 floating**、**只有显式 panel 才回到旧面板**、
  公开环境变量名仍可用。
- `apps/web/tests/unit/agent-retirement-audit.test.ts`（更新 2 处）：
  **默认 surface 是 floating**（注明翻转前后差异与仍欠的债）、
  **取值不认识时回落到 floating**。
- 全量：`pnpm test` 1778 例通过、`typecheck` 四包全绿、
  `lint` 0 error（12 warning = 基线）。
