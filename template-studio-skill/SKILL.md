---
name: template-studio
description: 把一张参考简历（图/PDF 截图）做成 intro-builder 的可用模板。当用户说"把这张简历做成模板"、"用这个 PDF 生成模板"、"参考这张图做一个模板"、"复刻这个简历的样式"，或在 intro-builder-zoo 项目里要新增模板时，调用此 skill。前置条件：cwd 必须是 intro-builder-zoo 项目根（脚本要读项目的 .env.local 拿 DATABASE_URL，并把装饰图写进项目 public/）。
---

# template-studio — 把参考简历转成模板

把一张参考简历图复刻成 intro-builder 系统能识别的模板。**核心思路**：参考图 → 装饰底图（gpt-image-2 提取）+ 排版配置（Claude 看图推断）→ 写一行 templates 表 → 系统自动可用。

## 何时触发

用户给你一张简历参考图（PDF 截图 / PNG），并希望系统里多一个跟它视觉相似的模板可选。典型说法："把这张做成模板"、"复刻这个样式"、"用这个 PDF 生成模板"。

## 你需要从用户拿到

1. **参考图路径** —— 项目里某个 PNG/JPG。如果用户给的是 PDF，先 `pdftoppm -r 150 input.pdf out -png` 转图。
2. **模板 id** —— 短 kebab-case，如 `red-banner`、`blue-fresh`、`science-classic`。会成为 DB 主键，必须唯一。
   - **只用于内部识别**，**用户看不到**。可用英文，但避免 `abbey` / `crimson` 这种参考图原品牌代号 —— 改用描述性英文（color + style）。
3. **模板名（display name）** —— **必须纯中文，2-6 字**。**禁止**：
   - ❌ 英文产品代号：`Abbey`、`Crimson Banner`、`Foundation`
   - ❌ 个人姓名：`陈媛媛 Abbey`、`张三同款`
   - ❌ 内部技术词：`v2 PoC`、`Stub（验证用）`
   - ✅ 视觉型：`红调封面`、`蓝调清新`、`蓝调侧栏`
   - ✅ 场景型：`互联网职场`、`商务严选`
   - 用户在模板库看到的就是这个名字，**他们不关心 abbey 是谁**。
4. **模板描述（description）** —— 一句话面向**普通求职者**：写**适合什么人 + 视觉特点**，不要写技术名词。
   - ❌ 「Skill v2 PoC：红色 banner + 粉底 section title，A4 单页约束」
   - ✅ 「红色封面横幅 + 粉底分区标题，视觉感强，适合设计 / 创意 / 营销岗」

## 流程（你按顺序做）

### Step 1：观察参考图，决定装饰提取 prompt

用 `Read` 工具看参考图。识别**装饰元素**（不是内容）：

- 哪里有几何装饰？（圆环/线条/色块/水印？位置？颜色？）
- 是不是只有微弱装饰、整体偏纯色？

写一段 prompt 给 gpt-image-2，**收紧三件事**才能稳定输出：
1. **指明位置**："place the decorations in the TOP-RIGHT corner only, exactly mirroring the input"。如果不指明，model 会镜像/挪位。
2. **禁止编造**："Do NOT add any decorative elements that do not exist in the input — no extra triangles, dot patterns, halftone, etc.。" 否则 model 会自由发挥加东西。
3. **明确移除**："Completely remove ALL text, photos, icons, bullet points, section titles, colored bars。"

### Step 2：调 extract-decoration.py 生成装饰底图

```bash
python3 template-studio-skill/scripts/extract-decoration.py \
  --reference <参考图路径> \
  --prompt "<Step 1 写的 prompt>" \
  --output public/templates/decorations/<模板id>.png
```

完成后 `Read` 输出图确认效果。**位置/数量不对就调 prompt 再跑**——别凑合，丑装饰会污染整套模板。

### Step 3：观察参考图，推断 layout config

再次看参考图，决定 `LayoutConfig`（schema 在 `lib/templates/uploaded/types.ts`，已是 Zod 校验，**少字段会被 fetch.ts 的 safeParse 拒绝整行**）。下面 5 个字段都要填：

#### 3.1 `frame`（必填）—— 整页骨架

看参考图判断这是纵向还是横向：

- **所有内容都在一栏从上到下** → `{ "kind": "vertical" }`
- **一侧有窄条 sidebar（放头像/技能/教育这种次要内容）** → `{ "kind": "horizontal", "sidebar": { "side": "left"|"right", "width": "240px", "sections": [...], "bgColor": "...", "textColor": "..." } }`
  - `sections` 字段写**这些 sectionId 进 sidebar**（其余进 main），常见 `["education", "skills"]` 或 `["education", "skills", "summary"]`
  - `bgColor` 深色（如 `#1F2937`）+ `textColor` 浅色（如 `#F9FAFB`）= 深色 sidebar
  - 都不写 = 透明 sidebar，跟主页一色
- 不确定就 vertical（更常见、更安全）

参考完整示例：`lib/templates/uploaded/examples.ts` 里的 `VERTICAL_EXAMPLE` / `HORIZONTAL_EXAMPLE`。

#### 3.2 三个 variant 字段（必填，都从对应枚举挑）

**注意三个的可选值不完全一样**：

- `headerVariant`: `"classic" | "professional" | "modern-sidebar"`
- `sectionTitleVariant`: `"classic" | "professional" | "modern" | "card-wrapped"`
- `itemHeaderVariant`: `"professional" | "classic" | "modern"`

风格对号入座：

- `professional` —— 现代职场清晰排版（黑/彩色 tab 风格 section 标题，左公司右日期）
- `classic` —— 传统衬线 / 学院风（细线下划线 section 标题，全大写）
- `modern*` —— 深色 sidebar 设计岗（modern 内置那种）
- `card-wrapped` —— **每个 section 用白色圆角卡片整体包裹**（参考图：每个 section 都有独立的白色卡片背景 + 圆角 + 阴影 → 选这个；典型代表：Abbey 风、Notion 风、设计岗高质感模板）

三个独立挑：abbey 全用 `professional`、modern 内置全用 `modern*` 系列、卡片型简历用 `card-wrapped` + `professional` 组合。

#### 3.3 `theme.primaryColor`（必填）—— 主色，⚠️ 会穿透到 section title

**这个字段不只是"配色名义值"，它会真实染色 section title 的彩色 tab 背景**（`professional` variant 时是 tab；`card-wrapped` 是 icon 颜色；其他 variant 也会用作底色/边框）。从参考图里 section title 已经在用的那个色挑出来，否则模板视觉跟参考图会冲突。

hex 格式，例如 `#3B8BCD`（abbey 蓝）、`#137880`（青绿）、`#1F2937`（炭黑）。

#### 3.4 `theme` 其他可选字段（按需填，**全都真实生效**）

下列字段不填用默认值，填了**会真实改变渲染**——不是装饰性占位。schema 里都是 `optional`，所以不确定就不填。

- `theme.accentColor` —— 强调色，会染 ResumeItemHeader 的 dateRange（公司/项目右侧的日期）。如果参考图里日期是用某个特定彩色字（不同于黑色），用这个。
- `theme.fontFamily` —— **限定为 `"sans" | "serif" | "mono"`** 三选一（对应 `FONT_MAP` 的 key）。填了就强制覆盖用户级字体偏好（template-over-user）。学术 / 传统简历选 `serif`；其他通常不填，让用户自己选。**写错（如 "Inter"）会被忽略**，安全降级。
- `theme.cardBg` / `theme.cardRadius` / `theme.cardShadow` —— **只在 `sectionTitleVariant: "card-wrapped"` 时生效**。
  - `cardBg`: 卡片背景色，默认 `white`。例如 `#fafafa` 浅灰、`#1f2937` 深色卡片
  - `cardRadius`: 圆角，CSS 长度。默认 `12px`。`16px` 更圆、`8px` 较锐利、`0` 直角
  - `cardShadow`: CSS box-shadow 完整字符串。默认柔和浅阴影。例 `"0 2px 8px rgba(0,0,0,0.08)"`
- `theme.cardBg/Radius/Shadow` 在非 card-wrapped 模板里写了也无害（被忽略），但建议不填——保持 schema 实例干净。

#### 3.5 `sectionIcons`（必填）—— 见下方 lucide 白名单

#### 3.6 `decoration.placement`（如果有装饰图）

根据装饰图实际尺寸 + 参考图里装饰位置定。A4 800px 宽页面常见配置：

```json
{
  "position": "absolute",
  "top": "0",
  "right": "0",
  "width": "300px",
  "height": "auto",
  "zIndex": 0,
  "opacity": 0.6
}
```

---

### Lucide 图标白名单（`sectionIcons` 字段必须从这里挑）

下列 43 个名字都是 lucide-react v0.x 实际存在的导出名（用 `scripts/verify-lucide-whitelist.ts` 验证过）。**绝对不要写白名单外的名字**——凭脑子写容易挑到不存在的（比如 "Soccer"、"Wechat"），前端会渲染空白。

```
个人总结 (summary):       User, Quote, Info, MessageSquare, FileText
工作经历 (experience):    Briefcase, Building2, Building
教育经历 (education):     GraduationCap, BookOpen, School
项目经历 (projects):      FolderKanban, Folder, Layers, Code2
专业技能 (skills):        Sparkles, Star, Wrench, Lightbulb, Zap, Target
荣誉奖项 (awards):        Award, Trophy, Medal, Crown, Star
社团/活动 (activities):   Users, UserCheck, Heart, Handshake
研究经历 (research):      FlaskConical, Microscope, BookOpen, FileText
作品集 (portfolio):       Image, Palette, LayoutGrid, Camera
联系/链接相关:            Mail, Phone, MapPin, Globe
其他通用 (other / fallback): Tag, Bookmark, Hash, ChevronRight
```

> ⚠️ Github / Linkedin 等品牌 logo 不在 lucide 主包，不要写。要表达 GitHub 用 `Code2`，LinkedIn 用 `Globe` 或 `Mail`。

**挑选规则**：
1. 看参考图里那个 section 的图标长什么样 → 从对应分组里挑最像的
2. 找不到完美匹配就挑通用的（"其他"分组的 Tag / Bookmark）—— **绝对不要写白名单外的名字**
3. 把名字字符串写进 `sectionIcons.<sectionId>: "<lucide name>"`，例如 `experience: "Briefcase"`

### Step 4：调 insert-template.ts 入库

**v1（enum-based）**——沿用：

```bash
pnpm exec tsx --env-file=.env.local \
  template-studio-skill/scripts/insert-template.ts \
  --id <模板id> \
  --name "<中文名>" \
  --description "<一句话描述>" \
  --decoration '<DecorationConfig JSON>' \
  --layout '<LayoutConfig JSON>'
```

**v2（HTML 自由排版，推荐用于骨架差异大的模板）**——加 `--custom-html` / `--custom-css`：

```bash
pnpm exec tsx --env-file=.env.local \
  template-studio-skill/scripts/insert-template.ts \
  --id <模板id> \
  --name "<中文名>" \
  --description "<一句话描述>" \
  --custom-html prototypes/<模板id>/template.html \
  --custom-css prototypes/<模板id>/template.css \
  --layout '<最小有效 LayoutConfig JSON 兜底>'
```

**单文件简写**：HTML 顶部的 `<style>...</style>` 块脚本会自动抽出来存进 customCss 字段（适合 PoC 单文件场景）。所以你也可以只传一个 .html、不传 `--custom-css`。

> ⚠️ **不要把 CSS 留在 HTML 里不抽出**——SlotRenderer 的 DOMPurify whitelist 不含 `<style>` 标签（安全考虑：避免恶意模板通过 style 注入 escape），如果脚本不抽走，浏览器拿到的 HTML 没 CSS，模板会裸文字渲染。脚本的自动抽取就是防这个 silent fail。

v2 模式下 `--layout` 仍要填——SlotRenderer 渲染失败时引擎降级到 layout enum 路径。最小有效值：

```json
{
  "frame": {"kind": "vertical"},
  "headerVariant": "professional",
  "sectionTitleVariant": "professional",
  "itemHeaderVariant": "professional",
  "theme": {"primaryColor": "#000000"},
  "sectionIcons": {}
}
```

**v2 写 HTML/CSS 四条铁律**（违反会出问题，前 1-3 条由 insert-template.ts 自动校验 fail-fast，第 4 条要你主动检查）：

1. **对偶约束（dual constraint）**——用户能调的 CSS 必须用 `var(--*)`：
   - `font-size: var(--font-size)` ✅
   - `font-size: 14px` ❌（用户改字号失效）
   - `line-height: var(--line-height)` ✅
   - **page-level padding 必须 `var(--page-padding)`** —— `<article>` 自身的 padding 必须读这个变量，否则 smart-layout 算法压缩 pagePadding 时对你的模板物理失效（用户内容多时压不下来 → status=cannot-fit → 溢出第二页）
   - **section / item 间距必须 `var(--section-gap)` / `var(--item-gap)`** —— section 之间的 margin、entry 之间的 margin 必须读这两个变量。同样的原因：算法的可调维度对硬编码间距物理失效
   - 装饰、颜色、圆角、阴影、component-level padding（banner 内边距 / 卡片内边距 / 图标 padding 等"和密度无关的内层留白"） → 可硬编码
   - 判断哪些是 page/section/item gap、哪些是 component-level：**密度调节会想压缩它吗？** 想压 → var；不想压 → 硬编码。banner 高度感、卡片视觉边缘是品牌属性不该压；section/entry 之间的呼吸空间是密度的物理体现，必须压。
2. **slot 协议**——内容插槽必须用 `<slot data-bind="..." ></slot>`（**显式闭合，不要 self-close**——HTML5 slot 不是 void 元素）：
   - 顶层 `<article>` 包外壳，所有 `<template id="...">` 在 `<article>` 之外
   - 合法 binding 名：见下表
   - 嵌套 ≤ 3 层（sectionOrder → section.items → 内层不再 loop）
   - 头像/图片：用 `<img data-bind="basics.photo" alt="头像" class="..." />`（**不要写 src**——引擎自动把 URL 注入 src；photo 为空时整个 `<img>` 不渲染，不会留裂图）。**形状/尺寸/裁剪全用 CSS 控制**（圆形头像 = `.avatar { border-radius:50%; object-fit:cover }`）。不要用 `<slot data-bind="basics.photo">`（会把 URL 当文字渲染），也不要写死 `<img src="" />`（React 19 报错）。
3. **安全**——禁止 `<script>` / `on*` 属性 / `<iframe>` / `position: fixed` / `*` 选择器 / 裸 element 选择器（`body { ... }`）/ `@media` / `@keyframes`
4. **A4 单页约束（hard rule）**——**自由排版的"自由"是视觉自由，不是尺寸自由**。渲染 demoResume 规模内容（5 项工作 + 3 项目 + 自我介绍 + 教育）必须严格塞进 A4 一页：
   - **gallery thumbnail 模式**（stage 595px 宽）：article 总高度 ≤ **841px** (A4 @72dpi)
   - **dev-preview / 编辑器预览 / PDF 模式**（容器 800px 宽）：article 总高度 ≤ **1123px** (A4 @96dpi)
   - 不遵守的后果：(a) gallery 缩略图宽度缩水产生左右白边、(b) PDF 第一页被截断、(c) 编辑器预览跟 PDF 不一致
   - 写完后跑 dev-preview 路由（`/dev-preview/template/<id>`）目测：800px 容器里内容**必须不超过一屏 viewport** (~1123px)。超出说明 padding / margin / banner 太奢侈，回头压缩。**常见可压缩位置**：banner padding（一开始就 60+ 太多）、section margin-top（22+ 太奢侈，14 通常够）、entry padding/margin、section-title padding。
   - **超出 1123px 时不要指望 smart-layout 兜底**：smart-layout 算法可以把 page padding / section gap / item gap / 字号 / 行高动态压缩，但仅压缩用 `var(--page-padding)` / `var(--section-gap)` / `var(--item-gap)` / `var(--font-size)` / `var(--line-height)` 写的部分。模板里硬编码的 `padding: 60px` 算法压不动。把可调的间距全用 var()，模板默认状态下塞下 demoResume，剩下的内容多出来的部分由 smart-layout 兜底压缩。

**合法 binding 名表**：

| 类别 | binding | 何时可用 |
|---|---|---|
| basics value | `basics.name` `basics.title` `basics.email` `basics.phone` `basics.location` `basics.website` `basics.status` `basics.summary` | 任何位置（用 `<slot>`） |
| 图片 | `basics.photo` | 任何位置，**必须用 `<img data-bind="basics.photo">`**（不是 `<slot>`） |
| sectionOrder loop | `sectionOrder` (loop slot, 配 `data-template`) | 任何位置 |
| section value | `section.id` `section.title` `section.icon` | 仅 sectionOrder loop 内 |
| section.items loop | `section.items` (loop slot, 配 `data-template`) | 仅 sectionOrder loop 内 |
| item value | `item.title` `item.subtitle` `item.dateRange` `item.location` `item.bullets` `item.tags` `item.link` | 仅 section.items loop 内 |

**item 字段从各 section 派生映射**（一份 item template 适用所有 section）：

| section | item.title | item.subtitle | item.bullets |
|---|---|---|---|
| experience | company | title (职位) | content (TipTap) |
| education | school | degree+major+gpa | highlights (TipTap) |
| projects | name | role | content (TipTap) + tags=stack |
| skills | category | items.join("、") | (空) |
| basics | (空) | (空) | summary (wrapped) |

**完整 v2 PoC 参考**：`prototypes/handcoded-crimson/index-with-slots.html`

---

### Step 5：验证

```bash
pnpm exec tsx --env-file=.env.local scripts/verify-templates.ts
```

新模板的 id 应出现在 `listAllTemplatesAsync` 输出的 `source=uploaded` 行里。

**v2 模板视觉验证**：开 `http://localhost:3000/dev-preview/template/<模板id>` 看实际渲染。如果你写的 HTML 引擎接不上，会显示 `[未知 slot: xxx]` / `[ctx 不可用]` / `[嵌套过深]` 等占位符——按提示修。

## 输出给用户

- 装饰图路径：`public/templates/decorations/<id>.png`
- 模板 id 和名字（已入 DB）
- 模式：v1-enum 还是 v2-html
- 提示用户：刷新 dashboard / 编辑器的"模板与排版"picker 能看到新模板

## 注意

- **API key**：脚本从环境变量 `OPENAI_API_KEY` 读。如果未设，从 `~/.claude/reference/keys.md` 找当前可用的 BMC 中转 key 并 `export`。
- **API 调用 30-60s**（gpt-image-2），耐心等待。HTTP 000 状态是网络抖动，重跑即可。
- **token 消耗**：单次 edits 调用约 1500-1700 tokens。装饰提取尽量一次成功，反复试会浪费配额。
- **prompt 反复改不出效果**：不是 prompt 问题，是 model 极限——比如它无法 1:1 复制装饰元素的精确数量/排列。接受"风格 + 位置"对齐即可，细节在产品层用 CSS placement 调。
- **v1 vs v2 选择**：参考图视觉接近现有 variant（professional / classic / modern / card-wrapped / full-width-bar）就走 v1（更快）；视觉骨架明显不同（timeline 鳃骨 / banner 顶部色块 / 杂志双栏等）走 v2。
