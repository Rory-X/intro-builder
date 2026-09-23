# Agent Note: 单元测试镜像源码路径，一文件一单元

Status: implemented

## Problem

仓库有 100+ 个单元测试文件（`apps/web/tests/unit/`）加 Agent 与 PartyKit 各自的测试。如果测试命名与位置没有统一约定，找「某个模块的测试在哪」会退化成全文搜索，Agent 也无法从「改了哪个源文件」直接推出「该跑哪个测试」——而后者正是 TDD 回路能自动运转的前提。

## Decision

**测试文件路径镜像被它覆盖的源文件路径**，命名等于源文件路径换连字符：

- `apps/web/components/editor/projects-editor.tsx` → `apps/web/tests/unit/projects-editor.test.tsx`
- 新增模板补 `templates-<id>-layout.test.tsx`

测试代码集中在一个扁平的 `tests/unit/` 下（**不在源码旁边放 `__tests__`**），三个子包各自持有自己的测试根：`apps/web/tests/unit/`、`apps/agent/tests/`、`apps/partykit/src/*.test.ts`。根 `pnpm test` 递归跑全部三个。

测试运行在 Vitest + jsdom + Testing Library，环境配置在 `apps/web/vitest.config.ts`，共享 setup 在 `apps/web/tests/setup.ts`。

**推论**：改一个源文件后，应当能直接推出它的测试文件名并定向跑（`vitest run tests/unit/<name>.test.ts`），不必先全量跑一遍。新增模块时先建对应测试文件（TDD），路径由源文件路径决定，不需要另外决策。

## Alternatives considered

- **测试与源码同目录（`foo.ts` 旁边放 `foo.test.ts`）** — 就近可见，改代码时测试就在眼前，也是社区常见做法。但这个仓库的 `tsconfig` 明确 `exclude: ["tests"]`，且 `apps/web` 的源码树按 `app/` `components/` `lib/` 分层；测试混进源码树会让「哪些文件是要发布的产物」变模糊，也会让 `tsc` 的 include 边界更难维持。放弃。
- **按功能域分子目录（`tests/unit/editor/`、`tests/unit/agent/`）** — 规模大时更好导航。但当前扁平结构配合「镜像源码路径」的命名已经足够可检索（`editor-*`、`agent-*` 前缀天然分组），额外引入层级反而让「源文件 → 测试文件」的映射不再是一一对应。规模显著变大时可重访。
- **不写单测，只靠手工冒烟** — 成本最低。但这个仓库的核心逻辑（schema 解析、内容迁移、autosave 串行队列、PDF 助手）都是「坏了不报错、只表现为用户数据异常」的类型，没有单测兜不住。手工冒烟只作为 UI 数据流的补充（见完成定义）。

## Consequences

- **收益**：从源文件路径可机械推出测试文件路径；`pnpm test` 一条命令覆盖三个包；定向跑测试的成本很低，适合 TDD 回路。
- **代价与已知上限**：扁平目录在测试数量很大时会变长；`tests/` 被 `tsconfig` 排除，**测试文件本身不参与类型检查**（`tsc --noEmit` 的 269 个文件里 tests 为 0），这意味着测试内的类型错误只能靠 Vitest 运行时暴露。**重访触发条件**：若测试内的类型错误开始反复逃逸到 CI 之后才被发现，应把 `tests/` 纳入类型检查（单独一份 tsconfig 或调整 exclude），而不是继续靠运行时兜。

## Verification

- 配置：`apps/web/vitest.config.ts`（environment、setupFiles、exclude）、`apps/web/tests/setup.ts`。
- 规模：`apps/web/tests/unit/` 约 114 个文件，`apps/agent/tests/` 18 个，`apps/partykit` 2 个。
- 回归方式：`pnpm test`（递归跑三个包）。
