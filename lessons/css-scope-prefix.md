# CSS Scope 前缀机制

## 机制

SlotRenderer 渲染模板 CSS 时，自动给所有选择器加 `[data-template-id="xxx"]` 前缀。

代码位置：`lib/templates/uploaded/css-scope.ts` 的 `scopeCss(css, templateId)` 函数。

## 为什么需要

页面上可能同时存在多个模板的 DOM（编辑器预览 + 模板选择面板缩略图）。如果两个模板都定义了 `.section-title`，不加前缀的 CSS 会互相覆盖——后加载的赢，导致正在编辑的简历样式被别的模板污染。

加前缀后每个模板的样式只作用于自己的 `[data-template-id]` 范围内，互不干扰。

## 使用方式

写模板 CSS 时正常写 class 名，不需要手动加前缀。引擎自动处理。
