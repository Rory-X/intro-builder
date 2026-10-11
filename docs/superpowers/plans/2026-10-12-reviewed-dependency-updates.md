# 已评审的依赖更新执行计划

日期：2026-10-12
状态：本地交付已完成；远端 CI、合并与原 PR 处置以整合 PR（codex/pr-dependency-review）的状态和交接记录为准。
Spec：[已评审的依赖更新](../specs/2026-10-12-reviewed-dependency-updates.md)

## 步骤

1. [x] 核对 origin/main、10 个 PR 的 diff、head SHA、CI、评审与上游变更。
2. [x] 关闭 5 个不适合直接合并的 PR，逐项留下具体依据。
3. [x] 整理 5 项可保留更新，限定原 PR 目标版本，生成一致锁文件；同步 AGENTS.md 与决策笔记，并修正 Windows 下 dev / build 过滤器的假成功。
4. [x] 跑 frozen install、test、typecheck、lint、build、notes:verify，保存输出并做页面冒烟。
5. [x] 整理 PR 的验证证据与处置清单，发布门禁和远端状态由整合 PR 管理。
6. [x] 关闭本地交付步骤并留交接；最终合并与关闭结果写入整合 PR，避免在合并前把远端动作写成既成事实。

## 风险

- 锁文件 peer 组合会随着 React / TipTap / 工具链变动而重建；检查实际解析版本，避免未评审的大版本进入。
- 本机 Node 22.6 低于 jsdom 的 22.13 下限，验证使用校验过官方 SHA256 的独立 Node 22.23.3，不更改系统 Node。
- 工作区无数据库/邮件/模型服务配置，无法把公开页面冒烟当作登录后编辑、AI、协作、PDF 的端到端验证；现有测试覆盖这些路径，限制需写入交接。
- 原 PR 各自 CI 通过不能代替组合后的验证；最终 PR 必须重新跑 CI。
- 已复现旧根 build 在 Windows 退出 0 却报告 No projects matched；改双引号并加 --fail-if-no-match 后，以实际 Next 构建和 PartyKit 校验输出为准，不能只看退出码。
- Windows 的归档完整性测试逐项启动 Git，单独复跑耗时约 10 秒；与构建 15 个进程并发时会超过 30 秒。完整测试与构建串行，本地用 --maxWorkers=4 --testTimeout=30000，CI 默认时限保持不变。三份失败相关文件单独复跑 43 项通过，证明首轮冷加载超时后的跨用例污染。
- 字体下载使用系统已配置的本地代理，仅在构建进程设置，不修改项目网络配置，不使用字体 mock。

## DoD 与交接

目标：处理本轮 10 个依赖 PR，保留兼容更新并关闭需要迁移的自动升级。

交付：Next.js / eslint-config-next 16.3.8、React / React DOM 19.3.0、TipTap 3.31.4（y-tiptap peer 3.0.9）、React Hook Form 7.89.0、auto-scroll 3.2.0，与原 #109 / #157 的其余更新共享一个锁文件；没有新增直接依赖。根 dev / build 修正 Windows 引号并拒绝空匹配。根指南同步实际版本、JWT 会话、CI 构建与可用 skill，app 的 Next 指南引用根规则。

本地验证使用 Node 22.23.3 / pnpm 10.30.2，日志位于 C:/Users/fool/.codex/pr-review/2026-10-12/：

| 闸门 | 结果 |
| --- | --- |
| pnpm install --frozen-lockfile --prefer-offline | 通过，锁文件无需解析 |
| pnpm test --maxWorkers=4 --testTimeout=30000 | Web 168 文件、1769 项通过 / 1 跳过；PartyKit 2 文件、11 项通过 |
| pnpm typecheck | shared、web、partykit 通过 |
| pnpm lint | 通过，0 error / 12 条既有 warning |
| pnpm build | Web 真实 webpack 编译、类型检查、30 个静态页面生成与路由产物完成；PartyKit tsc 通过 |
| pnpm notes:verify | 63 篇笔记的目录、链接、格式与封印检查通过 |
| 空 app 过滤器回归 | --fail-if-no-match 正确返回非零 |

手工冒烟：默认 Turbopack dev 启动通过；/docs 正常显示且可切暗色，/ 首页标题与主要板块可见（opacity 1），未登录 /dashboard 跳转 /login?next=%2Fdashboard，登录邮箱控件存在；验证期间无客户端 error。

遗留：整合 PR 必须等待标准 CI / 预览部署通过后才合并，并确认 PartyKit 的 main 部署结果。真实登录后编辑、AI、协作、PDF 的端到端流程因无服务配置未执行，不把公开页面冒烟当成这些流程的验证。原 #106 / #111 / #113 / #114 / #115 已关闭，理由留在各 PR；其余 5 项在整合 PR 合并后关闭。

奇怪的发现：原 Windows build 是退出 0 的空匹配；Node 22.6 不满足 jsdom 下限；并行构建会拖慢逐项 Git 归档测试；Next dev 自动生成 app 指南。这次没有新增业务行为，使用既有回归测试而不新增版本断言。
