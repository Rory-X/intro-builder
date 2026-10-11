# 已评审的依赖更新

日期：2026-10-12

## 为什么

开放的 10 个 Dependabot PR 中，5 项可作为当前依赖维护落地，另外 5 项需要独立迁移或配套验证。各分组的锁文件有冲突，且 Next.js 与 eslint-config-next 分属不同 PR；逐个合并会产生暂时不协调的版本组合。

## 做什么

把 #107（TipTap）、#108（React Hook Form）、#109（工具链）、#112（auto-scroll）、#157（其余依赖）整理为一个 PR。采用原 PR 的目标版本，Next.js / eslint-config-next 同为 16.3.8，React / React DOM 同为 19.3.0。auto-scroll 3 的破坏性变更仅去掉 TypeScript 4 支持，本项目已使用 TypeScript 5。

关闭 #106（assistant-ui 已移除正在使用的 API）、#111（ESLint 10 与现有 React 插件不兼容）、#114（shared 的 Zod 3 契约尚未迁移）、#115（AG-UI 1.0 协议迁移缺少配套）、#113（Chromium 153 未配套升级 Puppeteer）。每项保留证据与重访条件。

同时修正根 dev / build 脚本的跨平台引号：Windows 的 cmd 不识别单引号，旧 pnpm build 只输出 No projects matched 却退出 0。改用双引号并加 --fail-if-no-match，保证无匹配时失败。

保留 Next.js dev 自动生成的 app 级指南入口，并指向根 AGENTS.md，避免每次启动产生未提交文件或出现第二套协作规则。

## 边界

不改变产品功能、简历 Schema、Agent 协议或 PDF 浏览器组合。不新增依赖，不修改归档。复用现有行为测试，不为版本号编写镜像测试。没有新视觉、交互或架构，不需要 PoC。

## 成功条件

本地五项闸门及最终 PR CI 通过，完成可运行的页面冒烟，记录未能覆盖的真实服务流程；合并整合 PR 后关闭被替代的分组 PR。AGENTS.md 与现行框架、CI 事实一致。
