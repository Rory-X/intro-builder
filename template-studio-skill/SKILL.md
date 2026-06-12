---
name: template-studio
description: 把一张参考简历（图/PDF 截图）做成 intro-builder 的可用模板。当用户说"把这张做成模板"、"用这个 PDF 生成模板"、"参考这张图做一个模板"、"复刻这个简历的样式"，或要新增模板时调用。前置：cwd 在 intro-builder 仓库根；脚本读 .env.local 拿 DATABASE_URL / TEMPLATE_IMAGE_API_* / BLOB_READ_WRITE_TOKEN（图像 API 三件套未配置时自动跳过装饰提取，不阻塞主流程）。
---

# template-studio — 把参考简历转成模板（schema-v2）

把一张参考图复刻成 intro-builder 系统能识别的模板：**装饰图（GPT 生成 + Vercel Blob 托管）→ HTML/CSS（slot 协议 + CSS 变量合约）→ 一行 templates 表**。

> 协议参考：`docs/schema-v2/`（templates-table / resume-content / style-settings / html-slot-protocol / example-template）。本 SKILL 是这套协议的产出工具。

## 你需要从用户拿到

1. **参考图路径**——项目里某个 PNG/JPG。PDF 先 `pdftoppm -r 150 input.pdf out -png` 转图。
2. **id**——kebab-case，如 `red-banner`、`blue-fresh`。DB 主键，唯一。只用于内部识别（用户看不到）。避免参考图原品牌代号，改用描述性英文（color + style）。
3. **name**——纯中文 2-6 字。用户在模板库看到的就是这个。用「视觉特征 + 风格」或「场景 + 调性」命名。
4. **description**——一句话面向普通求职者：写适合什么人 + 视觉特点。面向的是选模板的人，不是做模板的人。
5. **category**——`academic | tech | business | creative | general` 五选一。决定模板库 tab 归属。
6. **features**——3 条模板特点文案，每条 ≤ 60 字。描述模板的排版结构优势（信息密度、留白节奏、视觉层次、适合人群、内容承载量）。结构能力比颜色装饰更持久——颜色可以换，但「双栏高密度」「大留白舒适阅读」这些是模板的核心卖点。

## 流程 6 步

### Step 1：观察参考图，判断是否需要调生图

**首选**：用 `Read` 工具直接看参考图。

**如果 `Read` 返回 `[Unsupported Image]`**→ 调用 image-analyzer skill：

```bash
python3 .claude/skills/image-analyzer/scripts/analyze.py <参考图路径> -r 4 --summary-only
python3 .claude/skills/image-analyzer/scripts/analyze.py <参考图路径> -r 2 -o /tmp/template-ref-analysis.json
```

从分析结果中提取关键设计信息：配色、布局类型、装饰元素、字号层级、对齐方式、间距节奏。

**判断标准**：CSS 能画的（纯色块、实线边框、简单矩形、规则圆环、线性渐变）直接在 CSS 里写。CSS 画不出来的复杂装饰才走生图——比如不规则曲线、复杂纹理、手绘插画、多元素几何组合、渐变+形状的复合体。

多种装饰共存时每种单独跑一次生图。全部可 CSS 实现则跳过 Step 2。

### Step 2（条件步骤）：跑 extract-decoration.py 复刻装饰

每个装饰资产单独跑一次，role 区分用途：

```bash
python3 template-studio-skill/scripts/extract-decoration.py \
  --reference <参考图路径> \
  --prompt "<描述要复刻的装饰>" \
  --output /tmp/<id>-<role>.png \
  --upload-blob --id <id> --role <banner|decoration|icon>
```

prompt 写法要点：指明装饰位置 + 明确要移除的内容（文字、照片、图标）+ 限定只复刻参考图里已有的元素。生图模型容易"创造性发挥"——prompt 越收紧越稳定。

stdout 最后一行 JSON 返回 `blob_url`（记下来，Step 5 直接引用）。如果图像 API 未配置会返回 `{"skipped":true}`，主流程不阻塞，告知用户当前用 CSS 简化版替代即可。

`Read` 输出 PNG 确认效果，不满意就调 prompt 重跑。

### Step 3：决定 layout

观察参考图的信息流向：所有内容上下排 = 单栏；有窄 sidebar = 视觉双栏。

视觉双栏的实现方式是 CSS Grid/Flex——sidebar 只放 profile 信息（头像、姓名、职位、联系方式），所有正文 section 统一通过 `sectionOrder` 在主栏渲染。这是因为 SlotRenderer 用单一 `sectionOrder` 循环驱动所有正文，布局差异完全靠 CSS 解决。

### Step 4：决定 defaultStyleSettings

模板首次应用时写入简历的初始排版参数。参照 `docs/schema-v2/style-settings.json` 的 9 个字段。根据参考图的信息密度选择起点：

| 风格 | fontSize | bodyLineHeight | pagePadding | sectionGap | itemGap |
|---|---|---|---|---|---|
| 紧凑 | 12 | 1.5 | 32 | 12 | 8 |
| 标准 | 13 | 1.6 | 40 | 16 | 12 |
| 宽松 | 14 | 1.7 | 48 | 20 | 16 |

生效链路：`defaultStyleSettings` 存在 templates 表 → 用户切模板时写入 `resume.content.styleSettings` → 渲染器消费 styleSettings 注入 CSS 变量。

### Step 5：写 HTML + CSS

先 `Read docs/schema-v2/example-template.html` + `example-template.css`——从中学习 **slot 协议语法**（binding 写法、template id 命名、class 约定）。但视觉结构完全由参考图驱动，不要照搬 example 的排列方式。example 是语法参考，不是布局模板。

#### 必备 binding

模板的职责是把用户填写的内容渲染出来。漏掉任何 binding = 用户填了但永远看不到。完整清单：

- **顶部身份**：`basic.name`、`basic.title`、`basic.status`、`basic.photo`（必须用 `<img data-bind="basic.photo">`）
- **联系方式**：`profile.contacts` 循环 → `contact.icon` + `contact.label`
- **正文**：`sectionOrder` 循环，同时提供 `*-list` 模板（含 `section.items` → item 循环）和 `*-block` 模板（含 `section.body`，用于自我介绍/个人总结等纯文本 section）
- **item 模板内**：`item.title`、`item.dateRange`、`item.subtitle`、`item.location`、`item.meta`、`item.link`、`item.bullets`
- **section 模板内**：`section.title`、`section.icon`（可选）

#### CSS 变量合约

用户在编辑器里能实时调字号、间距、行高。这些维度必须用 CSS 变量，否则用户拖滑块时模板毫无反应。具体哪些属性用哪些变量名，参照 `docs/schema-v2/example-template.css`——它是 var() 用法的活文档。

核心原则：**用户可调的维度走 var()，模板品牌特征可硬编码**（颜色、圆角、阴影、装饰定位）。

#### CSS 编写注意

- **头像居中**：`<img>` 是 replaced element，`text-align: center` 对它无效。用 `display: block; margin: 0 auto` 或绝对定位居中。
- **contact 间距**：renderer 底座已注入 contact item 之间的 margin，模板只需设容器为 flex 布局，不要额外加列方向的 gap（会叠加）。
- **section title 内 padding**：用 em 单位（跟字号联动），px 在用户调字号时比例会失调。

#### 协议 class

renderer 底座 CSS 通过特定 class 名提供基础行为（空值隐藏、icon 尺寸约束、间距归一化）。模板需要使用这些 class 才能享受底座能力：

内容角色 class（`.contact-item`、`.item-header`、`.item-title`、`.item-date`、`.item-subtitle`、`.item-location`、`.item-meta-row`、`.item-meta`、`.item-link`、`.item-body`、`.section-body`）——这些是 renderer 识别的语义钩子。

布局容器 class 自由命名（`.tpl-header`、`.tpl-body`、`.sidebar` 等）——这些只有你的模板用。

原则：**视觉差异写到协议 class 上**（`.item-title { font-weight: 700 }`），而不是发明私有 class 绕开协议。renderer 的 icon 注入、空值隐藏等底座能力依赖这些 class 名，绕开就失去底座保障。

#### renderer 底座已处理的事

以下由 renderer 自动注入，模板 CSS 里写了会重复或冲突：
- contact icon 尺寸（自动注入 `contact-icon-lucide` class + `1em` 约束）
- 空值字段隐藏（`:empty { display: none }`）
- contact item 间距
- profile 区域基础 typography
- section-body 基础字号行高

#### 安全边界

`<script>` / `on*` 事件 / `<iframe>` / `position: fixed` / `*` 全局选择器 / 裸元素选择器（`body{}`）/ `@media` / `@keyframes` 都不允许进模板——insert-template 脚本会校验拦截。原因：模板运行在用户简历页面内，这些构造会影响页面其他部分或引入安全风险。

#### A4 约束

800px 容器内总高度 ≤ 1123px（A4 @96dpi）。超出时 smart-layout 算法会压缩 var() 维度来自适应——但只有走 var() 的维度能被压缩，硬编码的 padding 算法动不了。所以 var() 覆盖越全，自适应能力越强。

### Step 6：draft 入库 → 预览 → 用户确认 → publish

模板入库分三步，中间必须有人工审查。

#### 6a. draft 入库

```bash
NODE_PATH="$PWD/apps/web/node_modules" pnpm exec tsx \
  --tsconfig apps/web/tsconfig.json \
  --env-file=.env.local \
  template-studio-skill/scripts/insert-template.ts \
  --id <id> \
  --name "<中文名>" \
  --description "<一句话>" \
  --category <enum> \
  --features '["特点1","特点2","特点3"]' \
  --html path/to/template.html \
  --css path/to/template.css \
  --default-style-settings '<JSON>'
```

不传 `--publish` = draft 状态，仅 dev-preview 路由可见。脚本 stdout 打印预览 URL。

HTML 顶部内嵌 `<style>` 会被脚本自动提取，可以只传 `--html`。装饰 blob URL 直接写进 HTML/CSS，不单独入库。

#### 6b. 预览 + 迭代

把预览 URL 发给用户，让他对照参考图检查。用户提修改意见 → 改 HTML/CSS → 重跑 6a（ON CONFLICT UPDATE 刷新 draft）→ 用户再看。循环直到用户确认通过。

收集修改意见时先把所有问题澄清完再动手——避免改一轮暴露新问题再改一轮。

#### 6c. publish

用户确认后，6a 命令末尾加 `--publish` 重跑。stdout 输出 `PUBLISHED` 即上线。

注意：对已 published 的模板不带 `--publish` 重跑会打回 draft（用户立刻看不到）——这是修改功能，不是 bug。

## 自查清单

publish 前过一遍核心项：

- [ ] 经过 draft → 用户预览确认 → publish 三步，没有跳过人工审查
- [ ] 所有必备 binding 都在（basic.*/profile.contacts/sectionOrder 含 list+block/item 全字段）
- [ ] CSS 可调维度走 var()（参照 example-template.css）
- [ ] 使用协议 class，视觉差异写在协议 class 上
- [ ] 装饰图来自 blob URL 或 CSS 实现，无空 src 占位
- [ ] 800px 容器内不超 1123px
- [ ] name 2-6 汉字，features 3 条 ≤60 字

## 故障排查

- **图像 API**：`.env.local` 需配 `TEMPLATE_IMAGE_API_BASE_URL` + `_API_KEY` + `_MODEL`。缺任一则 Step 2 跳过，不影响主流程
- **生图慢（30-60s）**：HTTP 000 是网络抖动，重跑即可
- **prompt 调不对**：可能是模型极限。接受"风格+位置"对齐，细节用 CSS 调
- **slot 校验失败**：按错误信息补齐对应 binding。字段名以 `docs/schema-v2/` 为准
- **neon 包找不到**：脚本用 `createRequire` 从 `apps/web/package.json` 解析依赖，确保从仓库根执行
