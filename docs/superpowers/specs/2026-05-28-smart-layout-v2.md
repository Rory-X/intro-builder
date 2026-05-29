# intro-builder Smart Layout v2：算法升级 + v2 模板联动 Spec

> 日期：2026-05-28
> 状态：spec 草稿（关键决策已用 AskUserQuestion 拍板）
> 关联：`2026-05-27-skill-html-templates.md`（v2 自由排版引入的 padding 硬编码设计），`2026-05-24-template-studio-skill.md` §4.2（padding/margin 可硬编码）

## 1. 为什么做

### 1.1 现状

智能排版（`SmartLayoutButton` + `lib/smart-layout.ts`）已经端到端跑通：用户内容溢出 A4 时点一下，算法二分搜索找最大 scale 把 fontSize / lineHeight / pagePadding 三件套压缩到能塞进 1123px 高度。算法本身正确，对内置模板（professional / classic / modern）效果稳定。

### 1.2 痛点

zoo 实测在内容多的真实简历上 status 直接走到 `cannot-fit` —— 即使压到 MIN（fontSize=10 / lineHeight=1.2 / pagePadding=20）仍然装不下。两层根因：

**第一层：v2 模板 padding 物理失效**
Skill v2 自由排版路径（`UploadedLayout` → `SlotRenderer`）旁路了 `ResumePage` wrapper，外层 `<div>` 没有消费 `styleSettings.pagePadding`。SKILL.md §4.2 第 1 条 dual-constraint 只把 `font-size` 列入 `var(--*)` 强制，`padding/margin` 显式允许硬编码 —— 算法即便压到 MIN_PADDING 也无效，因为 v2 模板的 padding 来自 AI 在 customCss 里写死的数值。**算法 3 个调节维度对 v2 模板物理只剩 2 个**。

**第二层：算法可调维度天花板太低**
- MIN_FONT=10 / MIN_LINE_HEIGHT=1.2 / MIN_PADDING=20 偏保守；专业简历下限实际可压到 8 / 1.05 / 8（Linkedin export 也是这个量级）
- section gap / item gap / entry padding 这些"内层间距"完全不在算法可调范围。内置模板里 `mt-3 / mt-4 / mt-3.5` 是 Tailwind 写死的（`lib/templates/shared/resume-section.tsx:47/78/110/134`），v2 模板里也是 AI 在 customCss 里写死。这些间距占的 vertical 空间不亚于字号本身

### 1.3 目标场景

zoo 在真实大内容简历（5-7 工作 + 4-6 项目 + 完整教育 + 技能列表 + 个人总结）上点"整理成一页"，算法能压到 status=optimized 而不是 cannot-fit；压缩后视觉仍可读（不破坏品牌感）。无论用内置模板还是 Skill v2 模板，效果一致。

---

## 2. 目标

按重要度：

1. **算法可调维度从 3 个扩展到 5 个**：加 sectionGap / itemGap，让内层间距也参与压缩。
2. **MIN 三件套压低**：fontSize 10→8 / lineHeight 1.2→1.05 / pagePadding 20→8，给算法更大压缩空间。
3. **内置 + v2 模板都消费新字段**：算法压缩对所有模板物理生效，不分路径。
4. **v2 模板的 page padding 修复**：暴露 `--page-padding / --section-gap / --item-gap` CSS 变量给 SlotRenderer，让 v2 模板通过 `var(--*)` 响应 styleSettings。
5. **现有模板不破坏（向后兼容）**：DEFAULT_STYLE_SETTINGS 加新字段时选合理 default 保持视觉不变。

---

## 3. 不做什么（明确边界）

- ❌ **新字段不暴露给用户调节面板**——sectionGap / itemGap 只是 smart-layout 算法的内部调节维度。`StyleEditor` popover 不加 slider。用户感知是"自动压缩更彻底"，而不是"多了俩拉杆"。
- ❌ **不动 fontSize / lineHeight / pagePadding 的 max 上限**——只压低 min，max 维持现状（避免破坏现有简历视觉）。
- ❌ **不做更激进的压缩维度**：letter-spacing / horizontal padding（左右页边距压缩）等不加进算法。最简方案先看效果。
- ❌ **不做 schema 外的迁移**——现有简历的 `styleSettings` 没新字段时由 Zod `.default()` 兜底，不需要 DB 迁移脚本。
- ❌ **不修内置 ResumeSection 的视觉差异**——professional / classic / modern 的 section variant 视觉差异保留，只是把 mt-X 改成读 CSS 变量。
- ❌ **不改算法整体框架**——仍是二分搜索 + linear interpolation，仅扩展 interpolateSettings 的字段集和 MIN 常量。
- ❌ **不为已有 abbey-stub 等 v1 enum 模板做改动**——v1 enum 路径走 ResumePage，已经响应 pagePadding，自动受益。仅 v2 customHtml 路径需要改。

---

## 4. 产品决策

### 4.1 schema 形状

`lib/resume-schema.ts` 的 `StyleSettings` 加 2 个字段：

```ts
sectionGap: z.number().min(4).max(24).default(16),  // 模块之间间距
itemGap: z.number().min(2).max(16).default(12),     // 模块内条目之间间距
```

`min` 是用户/算法能调的下限，`max` 是上限，`default` 选当前内置模板视觉对应值（mt-4 ≈ 16px / mt-3 ≈ 12px）。

### 4.2 算法 MIN 常量

`lib/smart-layout.ts`：

```ts
const MIN_FONT = 8;          // 原 10
const MIN_LINE_HEIGHT = 1.05; // 原 1.2
const MIN_PADDING = 8;       // 原 20
const MIN_SECTION_GAP = 4;   // 新增
const MIN_ITEM_GAP = 2;      // 新增
```

`interpolateSettings` 扩展到 5 维 linear interpolation。

### 4.3 渲染层联动机制

**统一走 CSS 变量管道**（复用现有 `--font-size / --line-height` 已经在用的模式）：

- **ResumePage** 在 `<article>` 上多注入 2 个 CSS 变量：`--section-gap`、`--item-gap`（pagePadding 已通过 inline style，section/item gap 通过 var）
- **ResumeSection** 把 `mt-3/mt-4/mt-3.5` 等 hardcoded 类去掉，改成 `style={{ marginTop: 'var(--section-gap)' }}`，各 variant 用不同 default fallback 保持视觉差异
- **SlotRenderer** cssVars 加 `--page-padding / --section-gap / --item-gap`，让 v2 模板用 `padding: var(--page-padding)` 等响应

**为什么 padding 同时用 inline style 和 CSS variable**：内置 ResumePage 现在用 inline style `padding: ${ss.pagePadding}px` 直接生效；v2 SlotRenderer 不能简单 inline（外层 div 包不到 user HTML 内的 article），所以 v2 通过 CSS variable 让用户 HTML 自己消费。两条路径都对，不需要统一。

### 4.4 算法测量层

`hooks/use-smart-layout.ts` 的 `measure` 函数扩展：除了原来的 `article.style.fontSize / lineHeight / padding`，再加 `article.style.setProperty("--section-gap", ...)` 和 `--item-gap` —— 让内置模板的 mt-X (改造后读 var) 也响应。这一步是算法对内置模板生效的关键。

### 4.5 SKILL.md 铁律升级

`template-studio-skill/SKILL.md` §4.2 dual-constraint 第 1 条：

**之前**：
- font-size 必须 `var(--font-size)`
- 装饰、颜色、padding/margin、圆角、阴影 → 可硬编码

**之后**：
- font-size / line-height 必须 `var(--*)`
- **page-level padding 必须 `var(--page-padding)`**
- **section / item 间距必须 `var(--section-gap)` / `var(--item-gap)`**
- 装饰、颜色、圆角、阴影、component-level padding（banner 内边距 / 卡片内边距等） → 可硬编码

### 4.6 现有 v2 模板迁移

abbey-blue 和 crimson-banner 两个模板的 customCss 需要把 article padding 和 section gap 改成 `var()` 形式。**手工改 DB 一次**，不写脚本（只 2 个模板，脚本 ROI 低）。

---

## 5. 风险与回滚

- **风险**：内置 ResumeSection 的 mt-X → var 改造可能破坏 3 个内置模板视觉。**缓解**：default 选当前 mt-4 (16) / mt-3 (12) 对应像素值，用 `style={{ marginTop: 'var(--section-gap, 16px)' }}` 形式 fallback；测试加视觉回归 snapshot。
- **风险**：MIN_FONT=8 在某些字体下不可读。**缓解**：保留 default fontSize=13，只有 smart-layout 触发时才会压到 MIN；用户手动调字号面板的 min 维持 10。
- **回滚**：分支 commit 全部按切片组织，单切片 revert 即可还原。

---

## 6. 验收

- [ ] 真实大内容简历（zoo 截图里的那份）在内置模板（professional）下点"整理成一页"，status=optimized 而不是 cannot-fit
- [ ] 同一份简历在 v2 模板（abbey-blue 或 crimson-banner）下点"整理成一页"，status=optimized
- [ ] 不点"整理成一页"时，所有现有简历视觉与本期前一致（验收 default 兼容）
- [ ] `pnpm test` / `pnpm tsc --noEmit` / `pnpm lint` / `pnpm build` 四闸门全绿
- [ ] 改动列表：~6 个文件 + DB 2 个模板手工迁移
