# Agent Note: 本轮依赖更新按兼容性筛选，并在一个锁文件中验证

Status: implemented

## Problem

本轮 10 个自动依赖 PR 不等于 10 个可直接合并的改动。assistant-ui 0.15 移除面板使用的 hooks；ESLint 10 使 React 插件抛出 TypeError；shared 的 Zod 4 更新使四处 z.record 类型检查失败。其余单独的 CI 成功也无法证明多个锁文件更新组合后正确。

## Decision

本轮整合 #107、#108、#109、#112、#157，使用原目标版本，并协调 Next.js / eslint-config-next 16.3.8 与 React / React DOM 19.3.0。auto-scroll 3 去掉的是 TypeScript 4 声明支持；仓库使用 TypeScript 5，因此不需要业务 API 迁移。决策不构成未来所有 major 可自动合并的规则。

根 dev / build 使用跨平台双引号过滤 ./apps/*，并通过 --fail-if-no-match 拒绝空匹配。旧单引号在 Windows cmd 中是字面量，本地已复现 pnpm build 输出 No projects matched 却返回 0；依赖验证必须看到实际 Next.js 构建与 PartyKit 的 tsc 输出，不能接受这个假成功。

Next.js 16.3 的 dev 启动会生成 apps/web/AGENTS.md 与 CLAUDE.md。保留其自动维护的版本指南块，并让 app 入口明确指向根 AGENTS.md；项目协作规则继续只维护一份。

#106、#111、#114 保留现有版本，分别需要 assistant-ui API、ESLint 插件链、共享 Zod 契约的独立迁移。#115 的 client 1.0 改变事件校验、协议版本与 snapshot 语义，而 core / encoder 仍为 0.0.56；本轮保留协议组合。#113 只升级 Chromium 153，而 Puppeteer 24.42 官方对应 Chrome 147；保留当前浏览器组合，配套升级另做 PDF 验证。该 PR 的 CI 失败来自面板断言，不能归因于 Chromium。

## Alternatives considered

- **逐个合并绿灯 PR** — 保留分组历史与已有 CI 最简单。否决原因：#109 / #157 的 manifests 与锁文件存在冲突，Next.js 与 eslint-config-next 也分属不同分组；一个组合 PR 可以直接验证最终部署状态。
- **只按 major 标签关闭所有大版本** — 筛选成本最低。否决原因：auto-scroll 3 的 TS4 清理与本项目兼容；Chromium 的版本号跟随浏览器周期，也不遵循 SemVer。实际变更与使用方式才是依据。
- **顺便迁移所有红灯依赖** — 一次消除所有版本落后。否决原因：这会把业务 API、共享内容契约、流式协议和 PDF 配套迁移混进维护切片，既没有当前产品需求，也没有必要的兼容性验证。

## Consequences

- **收益**：保留可用维护更新，直接验证共同锁文件；不把已证实的破坏性升级带入主线。
- **代价**：本轮需要新整合 PR，原 PR 以被替代方式关闭；被推迟的依赖仍需后续维护。
- **重访信号**：被推迟依赖出现适用安全修复、当前功能缺陷或明确的新功能需求时，按对应迁移范围重新评审，而不是把本轮关闭当作永久禁用。
- **验证上限**：本地无真实数据库、邮件和模型服务配置；公开页面冒烟与现有自动测试不能声称覆盖登录后完整编辑、AI、协作和实际 PDF 导出。
- **本地运行差异**：Windows 完整历史下的逐项 Git 校验比 CI 浅克隆路径慢，冷加载超时还会污染后续 mock / DOM。本轮在独立 Node 22.23.3 下串行验证测试与构建，并仅对本地命令使用 30 秒时限；不修改测试配置、断言或 CI 默认时限。

## Verification

- [Spec](../../../superpowers/specs/2026-10-12-reviewed-dependency-updates.md) 与 [Plan](../../../superpowers/plans/2026-10-12-reviewed-dependency-updates.md) 记录本轮范围与验证结果。
- [auto-scroll 上游变更](https://github.com/atlassian/pragmatic-drag-and-drop/blob/main/packages/auto-scroll/CHANGELOG.md)、[AG-UI client 上游变更](https://github.com/ag-ui-protocol/ag-ui/blob/main/sdks/typescript/packages/client/CHANGELOG.md)、[Puppeteer 支持表](https://pptr.dev/supported-browsers) 为配套判断依据。
- 各关闭 PR 的评论保留对应 CI job 或上游依据。
