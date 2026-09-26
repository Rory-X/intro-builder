# Agent Note: findBy* 之后断言 mock 调用要包 waitFor，否则抢跑 passive effect

Status: implemented

## Problem

`apps/web/tests/unit/editor-onboarding.test.tsx` 的第一条用例在 CI 上间歇性失败：

```
AssertionError: expected last "vi.fn()" call to have been called with [ true ]
- Expected: [ true ]
+ Received: undefined
```

`Received: undefined` 是关键线索：不是收到了 `false`，而是这个 mock **一次都没被调用过**（`vi.fn()` 无调用时 last call 为 `undefined`）。本地重复执行可复现（12 次里偶发 1–2 次失败）。

根因在组件与断言的时序，而非组件行为错误。`EditorOnboarding` 通过 passive effect 上报可见性：

```ts
useEffect(() => {
  if (!hydrated) return;
  onVisibilityChange(visible);
}, [hydrated, onVisibilityChange, visible]);
```

React 的 passive effect 在 DOM 提交**之后**异步 flush，而 `findByRole` 只保证 DOM 中出现目标元素——它在那个 effect 之前就可能 resolve。于是紧跟 `findByRole` 的裸断言会与 flush 竞争，偶发看到「尚未调用」。同一文件其余用例不受影响，因为它们的断言对象是 DOM（`findByRole` / `getByText`），而不是 effect 的副作用。

该用例由 `90b1516c7`（v0.5 引导）引入，而那个提交此前从未在 `main` 上跑过 CI（属积压提交），所以这个 flaky 是随首次推送才进入 CI 的，不是既有回归。

## Decision

断言 mock 调用时等待副作用落地：

```ts
expect(await screen.findByRole("region", { name: "编辑器新手引导" })).toBeInTheDocument();
// ...DOM 断言...
await waitFor(() => expect(onVisibilityChange).toHaveBeenLastCalledWith(true));
```

这是对既有惯例的就地收紧，不是新框架：`findBy*` 等待的是**元素出现**，`waitFor` 等待的是**副作用被观察到**。两者不可互相替代。

判定规则：**被断言的 mock 若由 `useEffect` 写入，就必须用 `waitFor` 断言**，无论前一行是否已经有 `await`。

## Alternatives considered

- **在组件里把上报改成同步（如 `useLayoutEffect` 或渲染期调用）** — 能让裸断言稳定通过。被否：这是为了让测试好写而改动生产渲染语义（`useLayoutEffect` 会让上报阻塞绘制，渲染期调用则违反 React 的纯渲染约束），代价落错了地方。
- **给该用例加 `await act(async () => {})` 手动 flush** — 也能修好。被否：依赖「恰好 flush 一次」的隐式假设，且读代码的人看不出它在等待什么语义；`waitFor` 自述意图。
- **提高 vitest 的 `testTimeout` / 加 `retry`** — 让失败不再暴露。被否：把不确定性藏起来，失败仍会在别处以更费解的形式出现。
- **删掉这条断言** — 减少维护面。被否：它覆盖的是「首次访问会通知父组件展开引导」这一真实契约，删掉等于丢掉回归保护。

## Consequences

- **收益**：该用例在本地连跑 15 次全绿（修复前 12 次中偶发失败）；CI 不再因无关提交出现假红。
- **代价与已知上限**：`waitFor` 默认轮询会带来极小的额外等待（通过即立即返回）。规则是**约定而非机制**——没有 lint 规则强制「mock 断言必须包 waitFor」，同类模式仍可能在新增测试里被写入。**重访信号**：再出现 `Received: undefined` 这类「mock 无调用」的间歇失败时，优先怀疑此处描述的抢跑，而不是先怀疑组件。
- **重访触发条件**：若该组件改为不需要异步 hydration（例如可见性由 props 直接决定），这条断言可以退回裸形式。

## Verification

- `pnpm test` — `apps/web/tests/unit/editor-onboarding.test.tsx` 全绿。
- 稳定性：对该文件连跑 15 次，`Tests 1 failed` 出现 0 次（修复前可复现）。
- 修复前诊断证据：临时探针打印 `CALLS: []`（mock 零调用）与 region 已存在同时发生，确认是 flush 竞争而非组件未渲染。
