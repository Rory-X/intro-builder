# Superpowers 文档索引

`docs/superpowers/` 是本项目的 vibe 协作落地物存放处：

- **`specs/`** —— 解释「做什么 / 为什么」。可读、可评审。
- **`plans/`** —— 解释「按什么顺序怎么做、退出条件是什么」。可执行、可勾选。
- 两类文件命名一律 `YYYY-MM-DD-<slug>.md`，便于按时间线排序。

> 协作总章程见仓库根 `AGENTS.md`。本文件只做索引。

## 当前状态速览

- **包版本**：`package.json` → `0.3.2`
- **已发布**：v0.1.0 → v0.1.1 → v0.2 → v0.2.2 → v0.2.3 → v0.3
- **进行中**：v0.3.x 编辑器稳定化（富文本字号、autosave flush、dashboard 卡片跳转、预览图导出等）——**尚未写 spec / plan**，第一件事就是补上。

## Specs

| 日期 | 文件 | 版本 / 主题 | 状态 |
|---|---|---|---|
| 2026-04-28 | `specs/2026-04-28-intro-builder-design.md` | v0.1.0 MVP 总体设计：邮箱魔法链接登录、Drizzle + Neon、A4 PDF、Vercel Hobby 配额 | ✅ 已上线 |
| 2026-04-28 | `specs/2026-04-28-v0.1.1-auth-mobile-landing.md` | v0.1.1：全局 Header / UserMenu、落地页、移动端编辑器、14 天滑动会话 | ✅ 已上线 |
| 2026-04-29 | `specs/2026-04-29-v0.2-richtext-drag-pdf.md` | v0.2：TipTap 富文本、分区/条目拖拽、Puppeteer PDF、旧 `string[]` 懒迁移 | ✅ 已上线 |
| 2026-04-29 | `specs/2026-04-29-v0.2.2-ui-overhaul.md` | v0.2.2：UI/UX 升级（暗色模式、Vercel Blob 头像、A4 卡片、Pragmatic D&D） | ✅ 已上线 |
| 2026-05-15 | `specs/2026-05-15-template-editor-ux-deep-optimization.md` | v0.3：Professional 模板 + 共享 template 原语 + 「模板与排版」控制台 | ✅ 已上线 |

> ⚠️ `2026-04-29-v0.2.2-ui-overhaul.md` 实际内容是 **plan 风格**（含「File Structure」「Decisions (locked in)」），但放在 `specs/` 目录。新文档请严格区分二者；现有文件保持不动，避免破坏历史链接。

## Plans

| 日期 | 文件 | 关联 spec | 状态 |
|---|---|---|---|
| 2026-04-28 | `plans/2026-04-28-intro-builder.md` | v0.1.0 spec | ✅ 已上线 |
| 2026-04-28 | `plans/2026-04-28-v0.1.1-auth-mobile-landing.md` | v0.1.1 spec | ✅ 已上线 |
| 2026-04-29 | `plans/2026-04-29-v0.2-richtext-drag-pdf.md` | v0.2 spec | ✅ 已上线 |
| 2026-05-14 | `plans/2026-05-14-v0.2.3-stabilization.md` | 无独立 spec（v0.2.x 发布前稳定化清单） | ✅ 已上线 |

> v0.3（Professional 模板）有 spec 但**没有独立 plan 文件**；实现按 spec 中的「5. Architecture」直接驱动。再次施工请补一份 plan，避免无锚执行。

## 何时写 spec / 何时写 plan / 何时都不需要

- **平凡改动**（拼写、显式重构、纯测试加固）：无需 spec/plan，直接走 TDD + PR 即可。
- **改 UX 行为、引入新模块、跨多个文件**：先写 spec（哪怕只有半页）。
- **超过 3 个有顺序的实现步骤**：在 spec 之上再写 plan，用 `- [ ]` 勾选；执行过程随时改写。
- **修 bug 但根因复杂**：在 plan 顶部写下根因假设与证据链，再列修复步骤。

## 命名与归档

- 文件名：`YYYY-MM-DD-<slug>.md`。`<slug>` 用连字符小写英文，便于检索。
- 一旦上线，**保留原文不删**。后续变更写新文件，并在新文件顶部用 `Depends on:` 注明前置版本。
- 上线后请回到本 README，把对应行的「状态」从 🟡 / 🔧 改成 ✅，并补一句话总结改动。

## 标准模板（最简骨架）

下面是写新 spec / plan 时可以直接复制的最小骨架。

### Spec 骨架

```markdown
# <版本号 或 主题> — Design Spec

**Date:** YYYY-MM-DD
**Status:** Draft / Locked / Shipped
**Depends on:** <前置 spec/plan，可选>

## 1. 为什么做这件事
（用户问题 + 现状缺口，3-5 句）

## 2. 目标 / 非目标
- 目标：可验证的成功条件
- 非目标：本期明确不做的事

## 3. 关键决策
- 选型 / 数据模型 / 交互方式

## 4. 风险与回退
- 已知风险 + 缓解 + 回退方案
```

### Plan 骨架

```markdown
# <版本号 或 主题> — Implementation Plan

**Spec:** <对应 spec 文件路径>
**Goal:** 一句话
**Architecture:** 一段话，说清数据流与模块边界

## File Structure（先锁定再动手）
NEW / MOD / DEL 三类列清楚

## Tasks
- [ ] T1 …
- [ ] T2 …
  - 验证：<跑哪条命令 / 期望输出>
- [ ] T3 …

## Definition of Done
- [ ] pnpm test / tsc --noEmit / lint / build 全绿
- [ ] 关键流程手工冒烟（列出来）
- [ ] 本 README 索引已更新
```
