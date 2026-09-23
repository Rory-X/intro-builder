# Agent Note: PDF 复用预览页渲染，不另建一套排版管线

Status: implemented

## Problem

简历需要导出 A4 PDF，同时编辑器右侧要有实时分页预览。如果 PDF 与预览各用一套渲染实现，两边一定会漂移——用户在预览里看到的换行、分页、字距与下载到的 PDF 不一致，而这类漂移极难归因（往往表现为「PDF 里多出半页空白」这种模糊反馈）。

真正要守住的是：**屏幕上看到的和打印出来的必须是同一份 DOM 的两种输出**。

## Decision

PDF 路由 `/api/pdf/[id]` 用 Puppeteer 打开**同一个预览页** `/resume/<id>/preview?_pdf=1`，并把 session cookie 转发过去（`docs/superpowers/specs/2026-04-29-v0.2-richtext-drag-pdf.md`）。预览页在带 `?_pdf=1` 时隐藏 AppShell header，得到干净纸面。Puppeteer 的启动配置与字体等待集中在 `apps/web/lib/pdf-route-helpers.ts`，其中 `waitForPdfFonts` 负责在截图前等字体加载完成——不等字体就会得到回退字体的 PDF。

**推论（这条比决定本身更重要）：预览坏 ⇒ PDF 必坏。** 排查任何 PDF 问题时第一步是打开 `/resume/<id>/preview` 看预览是否正常，而不是去读 Puppeteer 代码。

## Alternatives considered

- **`@react-pdf/renderer` 另写一套 PDF 排版** — 当时确实落地过，并在 `174eb091f` 被移除（连同 `Pdf.tsx`、PDF API route 与 16MB 字体）。它的排版模型是独立的（Yoga + 自己的样式系统），意味着每加一个模板都要在预览与 PDF 两处各实现一次，且带 16MB 字体进仓库。放弃。
- **客户端 `window.print()` / 浏览器打印为 PDF** — 零服务端成本，且天然复用屏幕 DOM。但无法控制分页边界与页面尺寸，且在移动端与去 header 场景不可控，无法满足「必须 A4、必须与预览一致」的产物要求。
- **服务端自己拼 HTML 字符串后渲染** — 能完全控制产物。但它需要把简历内容重新序列化一遍，等于维护第二份渲染真相，与「PDF = 预览同源」直接冲突。

## Consequences

- **收益**：模板只需实现一次（预览），PDF 免费获得一致结果；模板的 print-safe 约束变成可推理的规则，而不是两处的重复劳动。
- **代价与已知上限**：PDF 生成依赖能跑起 Next 路由与 Puppeteer 的完整运行时，比纯函数式渲染重；PDF 与预览共享故障域——预览的 bug 会同时是 PDF 的 bug（这是刻意的取舍）。**模板样式必须 print-safe**：避免 `position: fixed`、`overflow: hidden` 这类会裁切打印输出的属性；背景默认为白纸，不引入未被 `waitForPdfFonts` 等待的字体源。

## Verification

- 实现：`apps/web/app/api/pdf/[id]/route.tsx`、`apps/web/lib/pdf-route-helpers.ts`、`apps/web/app/(app)/resume/[id]/preview/`。
- 单元测试：`apps/web/tests/unit/pdf-route-helpers.test.ts`。
- 回归方式：`pnpm dev` 进 `/resume/<id>/edit` 点「下载 PDF」，对比 PDF 与实时预览是否一致（分页、字体、间距）。
