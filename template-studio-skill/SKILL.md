---
name: template-studio
description: 把一张参考简历（图/PDF 截图）做成 intro-builder 的可用模板。当用户说"把这张做成模板"、"用这个 PDF 生成模板"、"参考这张图做一个模板"、"复刻这个简历的样式"，或要新增模板时调用。前置：cwd 在 intro-builder 仓库根；脚本读 .env.local 拿 DATABASE_URL / TEMPLATE_IMAGE_API_* / BLOB_READ_WRITE_TOKEN（图像 API 三件套未配置时自动跳过装饰提取，不阻塞主流程）。
---

# template-studio — 把参考简历转成模板（schema-v2）

把一张参考图复刻成 intro-builder 系统能识别的模板：**装饰图（GPT 生成 + Vercel Blob 托管）→ HTML/CSS（slot 协议 + CSS 变量合约）→ 一行 templates 表**。

> 协议参考：`docs/schema-v2/`（templates-table / resume-content / style-settings / html-slot-protocol / example-template）。本 SKILL 是这套协议的产出工具。

## 你需要从用户拿到

1. **参考图路径**——项目里某个 PNG/JPG。PDF 先 `pdftoppm -r 150 input.pdf out -png` 转图。
2. **id**——kebab-case，如 `red-banner`、`blue-fresh`。DB 主键，唯一。**只用于内部识别**（用户看不到）。避免参考图原品牌代号（`abbey` 这种），改用描述性英文（color + style）。
3. **name**——**纯中文 2-6 字**。用户在模板库看到的就是这个。
   - ❌ `Abbey`、`Crimson Banner`、`陈媛媛 Abbey`、`v2 PoC`
   - ✅ 视觉型：`红调封面`、`蓝调清新`；场景型：`互联网职场`、`商务严选`
4. **description**——一句话面向**普通求职者**：写**适合什么人 + 视觉特点**。不要技术名词。
   - ❌ 「Skill v2 PoC：红色 banner + 粉底 section title」
   - ✅ 「红色封面横幅 + 粉底分区标题，适合设计 / 创意 / 营销岗」
5. **category**——`academic | tech | business | creative | general` 五选一。决定模板库 tab 归属。
6. **features**——**3 条**模板特点文案，每条 ≤60 字，写"适合谁 + 视觉特点 + 实用提示"。

## 流程 6 步

### Step 1：观察参考图，判断是否需要调生图

**首选**：用 `Read` 工具直接看参考图。

**如果 `Read` 返回 `[Unsupported Image]`（当前模型无 vision 能力）**→ 立即调用 image-analyzer skill 做程序化分析：

```bash
# 快速概览（一行总结）
python3 .claude/skills/image-analyzer/scripts/analyze.py <参考图路径> -r 4 --summary-only

# 完整结构化数据（写入文件供后续步骤引用）
python3 .claude/skills/image-analyzer/scripts/analyze.py <参考图路径> -r 2 -o /tmp/template-ref-analysis.json
```

从分析结果中提取模板设计所需的关键信息：
- `colors.palette[0]` → header 背景色
- `colors.mode == "grayscale"` → 无彩色，纯黑白灰设计
- `layout.header_region` → header 高度和位置
- `layout.layout_type` → 单栏还是双栏
- `decorations.solid_bars` → 是否有装饰横条/分割线
- `text.text_clusters[].estimated_font_size_px` → 标题 vs 正文字号
- `text.text_clusters[].alignment` → 文字对齐方式
- `spacing.typical_section_gap_px` → section 间距参考值

**只有 CSS 画不出来的复杂装饰**才走生图复刻；CSS 能搞定的（纯色横条、实色边框、简单矩形色块、规则圆环）**直接在 Step 5 的 CSS 里写**，不调脚本。

**典型需调生图的情况**（命中即跑，不互斥）：

| # | 装饰类型 | 例子 |
|---|---|---|
| 1 | 不规则波浪线 / 曲线带 | 顶部蓝色海浪 banner、底部装饰曲线 |
| 2 | 复杂条纹 / 斜纹 / 网格 / 点阵纹理 | 半透明斜纹背景、彩色条纹封面 |
| 3 | 参考图独有的手绘 / 插画装饰 | 手绘叶子、抽象笔刷、几何拼贴 |
| 4 | 多元素几何组合 | 圆环+三角+菱形混排的角落水印 |
| 5 | 渐变 + 形状的复合装饰 | 带渐变的不规则色块、半透明形状叠加 |

以上是最常见的 5 类，**不穷举**——参考图里出现"CSS 写不出来"的视觉元素就走生图。多种装饰共存（顶部波浪 + 角落几何 = 两种）→ **多次跑生图，每次一个 role**，Step 2 给了示例。

不命中任何一类 → **跳过 Step 2**，Step 6 的 `--assets` 传 `[]`，模板背景靠 CSS 实现。

### Step 2（条件步骤）：跑 extract-decoration.py 复刻装饰

只在 Step 1 判断"需要调生图"时跑。每个装饰资产**单独跑一次**，role 区分用途：

```bash
# 第 1 个装饰：顶部波浪 banner
python3 template-studio-skill/scripts/extract-decoration.py \
  --reference <参考图路径> \
  --prompt "<针对 banner 的 prompt>" \
  --output /tmp/<id>-banner.png \
  --upload-blob --id <id> --role banner

# 第 2 个装饰：右上角几何水印（如有）
python3 template-studio-skill/scripts/extract-decoration.py \
  --reference <参考图路径> \
  --prompt "<针对 corner 装饰的 prompt>" \
  --output /tmp/<id>-corner.png \
  --upload-blob --id <id> --role decoration
```

每个装饰的 prompt **收紧三件事**才能稳定输出：

1. **指明位置**：`place the decoration in the TOP-RIGHT corner only, exactly mirroring the input`
2. **禁止编造**：`Do NOT add any decorative elements that do not exist in the input — no extra triangles, dot patterns, halftone, etc.`
3. **明确移除**：`Completely remove ALL text, photos, icons, bullet points, section titles, colored bars`

stdout 最后一行 JSON：

- 配置完整：`{"local_path":"...","blob_url":"https://..."}` —— **记下 blob_url**，每个装饰各一条，Step 5 的 HTML 和 Step 6 的 `--assets` 都要用
- 图像 API 未配置（`.env.local` 缺 `TEMPLATE_IMAGE_API_BASE_URL` / `_API_KEY` / `_MODEL`）：`{"skipped":true,"reason":"..."}` + stderr WARNING + 退出码 0。**主流程不阻塞**，但你**必须告诉用户**「这个模板设计上需要 XX 装饰，本次环境未配置生图，已用 CSS 简化版替代，配置好后可重跑此 skill 升级」

`role` 三选一：`banner`（顶部/底部横幅）/ `decoration`（角落、侧边、背景水印）/ `icon`（小尺寸装饰图标）。

`Read` 每张输出 PNG 确认效果。位置/数量不对就调 prompt 再跑——丑装饰会污染整套模板。

### Step 3：决定 layout

参考图所有内容上下排 → `{"type":"vertical"}`。一侧有窄条 sidebar（放头像/技能/教育这种次要内容）→ `{"type":"horizontal","sidebar":{"side":"left|right","width":"240px","sections":["education","skills"]}}`。不确定就 vertical。

> ⚠️ **引擎当前 SlotRenderer 暂未实现 `sidebarSections` / `mainSections` loop binding**。如果你写双栏模板想立刻渲染，把分栏放在 `<article>` 里用 CSS Grid 自己实现，不要依赖 sidebar/main 这两个 binding。等下一轮引擎升级后双栏 binding 才生效。

### Step 4：决定 defaultStyleSettings

模板首次应用时写入简历的初始排版。9 字段，类型见 `docs/schema-v2/style-settings.json`。三档起点按需微调：

| 档 | fontSize | bodyLineHeight | headingGap | pagePadding | sectionGap | itemGap |
|---|---|---|---|---|---|---|
| compact | 12 | 1.5 | 6 | 32 | 12 | 8 |
| standard | 13 | 1.6 | 8 | 40 | 16 | 12 |
| spacious | 14 | 1.7 | 12 | 48 | 20 | 16 |

`fontFamily` 默认 `sans`；`lineHeight` 设成同 `bodyLineHeight`（向后兼容）；`photoScale` 默认 1。

### Step 5：写 HTML + CSS

参考 `docs/schema-v2/example-template.html` + `example-template.css`。两条骨架：

**A. HTML 必须包含 basic headline、profile contacts 和完整正文 slot**——缺字段 = 用户填的内容在模板里永远不渲染。顶部身份信息使用 `basic.*`；联系方式使用 `profile.contacts` 循环；自我介绍和个人总结都属于正文 section，不放进顶部 profile。装饰图按 Step 1 判断结果插入：有 banner asset 就放 `<img src="<blob_url>">`，没有就用 CSS 画背景（如 `.tpl-header { background: linear-gradient(...) }`），不要保留无用的 `<img src="">`。

```html
<header class="tpl-header">
  <!-- 有装饰资产时插入 banner img；无则删掉这行，用 CSS 画背景 -->
  <img src="<Step 2 拿到的 banner blob_url>" class="banner-img" alt="" />

  <img data-bind="basic.photo" class="avatar" alt="头像" />
  <h1 class="name"><slot data-bind="basic.name"></slot></h1>
</header>
<div class="tpl-body">
  <div class="meta">
    <slot data-bind="basic.title"></slot> · <slot data-bind="basic.status"></slot>
  </div>
  <div class="contact">
    <slot data-bind="profile.contacts" data-template="contact-item"></slot>
  </div>

  <slot data-bind="sectionOrder" data-template="section-tpl"></slot>

  <template id="contact-item">
    <a class="contact-item" href="#">
      <slot data-bind="contact.icon"></slot>
      <slot data-bind="contact.label"></slot>
    </a>
  </template>

  <template id="section-tpl-list">
    <section class="resume-section">
      <h2 class="section-title"><slot data-bind="section.title"></slot></h2>
      <slot data-bind="section.items" data-template="item-tpl"></slot>
    </section>
  </template>

  <template id="section-tpl-block">
    <section class="resume-section">
      <h2 class="section-title"><slot data-bind="section.title"></slot></h2>
      <div class="section-body"><slot data-bind="section.body"></slot></div>
    </section>
  </template>

  <template id="item-tpl">
    <div class="resume-item">
      <div class="item-header">
        <span class="item-title"><slot data-bind="item.title"></slot></span>
        <span class="item-date"><slot data-bind="item.dateRange"></slot></span>
      </div>
      <div class="item-subtitle">
        <span class="item-role"><slot data-bind="item.subtitle"></slot></span>
        <span class="item-location"><slot data-bind="item.location"></slot></span>
      </div>
      <div class="item-meta-row">
        <span class="item-meta"><slot data-bind="item.meta"></slot></span>
        <a class="item-link" href="#"><slot data-bind="item.link"></slot></a>
      </div>
      <div class="item-body"><slot data-bind="item.bullets"></slot></div>
    </div>
  </template>
</div>
```

**B. CSS 变量合约**——用户可调维度必须用 `var(--*)`，否则用户在编辑器调字号/边距时模板物理失效：

| 必须 var() | 可硬编码 |
|---|---|
| `font-size: var(--font-size)` | 颜色、背景、阴影 |
| `font-family: var(--font-family)` | 圆角 |
| `line-height: var(--line-height)` | banner / 卡片 / 图标的内层 padding |
| `padding: 0 var(--page-padding)`（page 级） | 装饰图绝对定位坐标 |
| `margin-top: var(--section-gap)`（section 间距） | |
| `margin-bottom: var(--item-gap)`（item 间距） | |
| `margin-bottom: var(--heading-gap)`（标题与正文） | |
| `transform: scale(var(--photo-scale))`（头像） | |

section title 内部 padding 用 **em**（跟字号联动），禁 px。

### Slot binding 速查

- basic：顶部身份信息使用 `basic.name/title/status/photo`；`basic.photo` **必须**用 `<img data-bind="basic.photo">`。`basic.title` 和 `basic.status` 必须同一行、同样式、无 icon。
- profile：联系方式使用 `profile.contacts` 循环 + `contact.icon/contact.label`。不要直绑 email/phone/location/website，也不要把 status 放进联系方式行。
- loop：`sectionOrder`（正文分区）、`section.items`（条目循环）。`sectionOrder data-template="X"` 必须同时定义 `X-list` 和 `X-block`。
- section 内：`section.{id,title,icon,kind,body}`；自我介绍和个人总结都通过 `section.body` 渲染，二者语义不同。
- item 内：`item.{title,subtitle,dateRange,location,bullets,tags,link}`

item 字段从 section 派生：experience.company/title→item.title/subtitle；education.school/(degree+major+gpa)→item.title/subtitle；projects.name/role + tags=stack；skills→bullets 整块。

### 安全规则

禁 `<script>` / `on*` 属性 / `<iframe>` / `position: fixed` / `*` 选择器 / 裸 element 选择器（`body{...}`）/ `@media` / `@keyframes`。

### A4 单页约束

800px 容器内 `<article>` 总高度 ≤ 1123px（A4 @96dpi）。section margin-top ≤ 22px、entry padding 别太奢侈。超出时 smart-layout 会压可调维度（var 那些），但**硬编码 padding 算法压不动**——所以可调维度全用 var()，模板默认状态塞下 demoResume，溢出部分让算法兜底。

### Step 6：draft 入库 → 预览 → 用户确认 → publish

**绝不可以一步到位直接 publish**。模板入库分三阶段，中间预留人工审查与迭代循环——直到用户口头确认「这个模板和参考图一致、可以发布」，才升级到 publish。

#### 6a 默认 draft 入库

```bash
pnpm exec tsx --env-file=.env.local \
  template-studio-skill/scripts/insert-template.ts \
  --id <id> \
  --name "<中文 2-6 字>" \
  --description "<一句话>" \
  --category <enum> \
  --features '["特点1","特点2","特点3"]' \
  --html path/to/template.html \
  --css  path/to/template.css \
  --assets '[{"url":"<banner blob_url>","role":"banner"},{"url":"<corner blob_url>","role":"decoration"}]' \
  --default-style-settings '{"fontFamily":"sans","fontSize":13,"lineHeight":1.6,"bodyLineHeight":1.6,"headingGap":8,"pagePadding":40,"sectionGap":16,"itemGap":12,"photoScale":1}' \
  --layout '{"type":"vertical"}'
```

不传 `--publish` 时默认写 `status='draft'`——**仅 dev-preview 路由可见**，dashboard / 编辑器模板库都看不到。脚本 stdout 会直接打印预览 URL：

```
upserted as DRAFT: <id> (<name>)
  preview: http://localhost:3000/dev-preview/template/<id>
  确认无误后用 --publish 重跑同一命令切换到 published
```

**单文件简写**：HTML 顶部内嵌 `<style>...</style>` 会被脚本自动抽出来作为 css，可以只传 `--html` 不传 `--css`。

**`--assets` 按 Step 1 判断结果填**：跳过了 Step 2（CSS 能搞定的装饰）→ `--assets '[]'`；跑了 N 次 Step 2 → 数组里写 N 条，role 对应。`--assets '[]'` 时 HTML 里**不要**留 banner img / 装饰图 placeholder，CSS 直接画背景。

#### 6b 预览 + 用户确认 + 迭代循环

确保本地 `pnpm dev` 已起。把 6a stdout 的预览 URL **完整发给用户**，并明确告诉他：

> 模板已以 draft 入库，请打开预览链接对照参考图检查：<br>
> http://localhost:3000/dev-preview/template/&lt;id&gt;<br>
> 顶部会有 ⚠️ DRAFT 标识。**确认后回复"通过"或"OK"**；如有问题请描述需要调整的地方（例如「banner 太厚」「字号需要小一点」「头像应该圆形不是方形」），我会迭代修改后重新入库 draft，再请你预览。

**循环规则**：
- 用户提反馈 → 改 HTML/CSS/assets/styleSettings → **重跑 6a 命令**（不传 `--publish`）—— ON CONFLICT UPDATE 会原地刷新这条 draft —— 让用户重新预览
- **不要在用户没明确确认时擅自 publish**。即便你觉得"已经很像了"
- 用户的修改诉求**先全部澄清完整**再动手改，避免改一轮触发新一轮反馈

#### 6c 用户确认后切到 published

```bash
# 把 6a 的命令原样重跑，仅在末尾加 --publish
pnpm exec tsx --env-file=.env.local \
  template-studio-skill/scripts/insert-template.ts \
  --id <id> \
  ... 其它参数原样 ... \
  --publish
```

stdout 应输出 `PUBLISHED: <id> (<name>)`。这时 dashboard / 编辑器模板库才能看到这个模板。

> ⚠️ 反向也成立：对一个已 published 的模板**不带 `--publish`** 重跑会把它打回 draft（用户立刻看不到）。需要继续修改时这是 feature；不是要打回时记得带 `--publish`。

**最终确认**：`pnpm exec tsx --env-file=.env.local scripts/verify-templates.ts` 看新 id 出现在 `listAllTemplatesAsync` 输出里（draft 不会出现，published 会）。

## 自查清单（publish 前过一遍）

- [ ] **draft 入库 + 用户口头确认**：6a 跑过，6b 把预览链接发给用户，等到用户明确说"通过/OK"才进入 6c。**绝不可以一步到位 publish**
- [ ] **装饰判断**：参考图里 CSS 画不出来的装饰（波浪/复杂条纹/手绘/几何组合/渐变形状）都已通过 Step 2 复刻；CSS 能搞定的没多余调生图
- [ ] HTML 顶部使用 `basic.name/title/status/photo`，其中 `basic.photo` 用 `<img data-bind="basic.photo">`
- [ ] `basic.title` 和 `basic.status` 同行、同样式、无 icon，且不放入联系方式行
- [ ] 联系方式使用 `profile.contacts` 循环 + `contact.icon/contact.label`
- [ ] 不使用 `basics.*`、`basics.icon.*`、`profile.name/title/status/summary`
- [ ] `sectionOrder` 同时定义 `*-list` 和 `*-block`，block 模板包含 `section.body`
- [ ] item 模板包含 `item.location`、`item.meta`、`item.link`、`item.bullets`
- [ ] CSS 里 `font-size` / `font-family` / `line-height` 全部走 `var(--*)`
- [ ] section margin-top 用 `var(--section-gap)`、item margin-bottom 用 `var(--item-gap)`、page padding 用 `var(--page-padding)`
- [ ] 装饰图 URL 全部来自 `--upload-blob` 拿到的 https，不引用本地 `public/` 路径；`--assets` 数组与 HTML 中实际引用的 role 一一对应
- [ ] features 是 3 条，每条 ≤60 字，无英文产品代号
- [ ] name 是 2-6 个汉字
- [ ] dev-preview 路由渲染无占位符告警
- [ ] 800px 容器内 article 不超 1123px

## 故障排查

- **图像 API 配置**：`.env.local` 必须配三件套——`TEMPLATE_IMAGE_API_BASE_URL`（例如 `https://bmc-llm-relay.bluemediagroup.cn/v1`）、`TEMPLATE_IMAGE_API_KEY`、`TEMPLATE_IMAGE_MODEL`（如 `gpt-image-2` / `doubao-seedream-3-0` / `wanx-v1` 等任一兼容 OpenAI `/images/edits` 协议的模型）。可选 `TEMPLATE_IMAGE_SIZE`（默认 `1024x1536`）。三件套缺任一 → Step 2 自动跳过，模板不带装饰背景但其它流程正常
- **API 兼容性**：脚本走 OpenAI `/images/edits` multipart 协议（`image` + `prompt` + `size` + `n`），响应支持 `b64_json` 或 `url` 两种 payload。换模型只改 `TEMPLATE_IMAGE_MODEL` + 必要时换 `TEMPLATE_IMAGE_API_BASE_URL`，脚本无需修改
- **生图 30-60s**：HTTP 000 是网络抖动，重跑即可。装饰提取尽量一次成功，反复试浪费配额
- **prompt 怎么改都不对**：可能是 model 极限（精确数量/排列复刻不出来）。接受"风格 + 位置"对齐即可，细节用 CSS 调
- **slot 校验失败**：按错误信息补齐 `basic.*`、`profile.contacts/contact.*`、`section.*` 或 `item.*`。不要用 `basics.*` 或 `profile.name/title/status/summary` 规避校验。
