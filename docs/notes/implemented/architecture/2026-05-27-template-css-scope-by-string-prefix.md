# Agent Note: 模板 CSS 用字符串前缀加 scope，不引 PostCSS

Status: implemented

## Problem

页面上可能同时存在多个模板的 DOM——编辑器实时预览、模板选择面板的缩略图、模板预览抽屉。如果两个模板都定义了 `.section-title`，不加隔离的 CSS 会互相覆盖，后加载的赢，导致**用户正在编辑的简历样式被另一个模板的缩略图污染**。这类 bug 表现为「预览突然变了样」，但根因在完全不相干的另一个组件里，极难归因。

## Decision

`SlotRenderer` 渲染上传/模板库模板的 `customCss` 时，先用 `scopeCss(css, templateId)` 给所有选择器加上 `[data-template-id="<id>"]` 前缀，再注入页面（`apps/web/lib/templates/uploaded/css-scope.ts`，约 40 行）。

实现是**简单字符串前缀替换**，不引入 PostCSS。决策依据来自 `docs/superpowers/specs/2026-05-27-skill-html-templates.md`（§5、R5、§11 的开放问题 2）：模板 CSS 通常不到 200 行，简单实现已覆盖绝大多数用例。

**已知上限（必须与实现一起记住）**：字符串替换处理不了 `@media` / `@keyframes` 等 at-rule——前缀会被加到 at-rule 本身而不是它内部的 selector 上。**触发重访的信号**：模板 CSS 开始普遍使用 at-rule，或出现 scoped 失败导致的实际样式串扰。届时升级到 PostCSS，而不是继续给字符串替换打补丁。

## Alternatives considered

- **引入 PostCSS 的 `postcss-prefix-selector` 做真解析** — 能正确处理 at-rule、嵌套与注释，是长期正确的方案。但当时（2026-05）模板 CSS 规模很小，为它拉一条构建期依赖不划算；且模板 CSS 是运行期来自数据库的内容，接进 PostCSS 需要额外的按请求处理成本。故留作上限触发后的升级路径。
- **用 Shadow DOM / iframe 做样式隔离** — 隔离最彻底，浏览器原生保证不串扰。但会切断模板与宿主页面的字体、主题变量（暗色模式）继承，且缩略图与预览需要跨边界通信，改造成本远高于收益。
- **约定式唯一前缀（要求模板作者自己写 `.tpl-xxx-` 前缀）** — 零实现成本。但依赖每个模板作者（包括 AI 生成模板）自己遵守，这条约定没有任何机械约束，一旦违反就是静默的样式污染——属于「写在散文里的规矩」。

## Consequences

- **收益**：模板样式互不污染，且没有引入构建期依赖；`scopeCss` 是纯函数，行为可用单测锁死。
- **代价与已知上限**：无法正确处理 at-rule，遇到时需要让模板改写（spec R5 明确接受这个限制并留了升级路径）。此外前缀加的是属性选择器，会轻微提高选择器特异性，模板自己的 `!important` 仍可能穿透——这是当前接受的边界。

## Verification

- 实现：`apps/web/lib/templates/uploaded/css-scope.ts`。
- 单元测试：`apps/web/tests/unit/css-scope.test.ts`。
- 回归方式：`/templates` 打开模板选择面板，确认正在编辑的简历预览样式不被缩略图污染；切换暗色模式确认模板样式跟随。
