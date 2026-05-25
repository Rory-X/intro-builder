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
2. **模板 id** —— 短 kebab-case，如 `abbey`、`elegant-blue`。会成为 DB 主键，必须唯一。
3. **模板名** —— 中文展示名，如「陈媛媛同款」。

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

再次看参考图，决定 `LayoutConfig`（参考 `lib/templates/uploaded/types.ts`）：

- `headerVariant` / `sectionTitleVariant` / `itemHeaderVariant`：当前只有 `professional` / `classic` / `modern` 三种 variant 可选。看参考图风格最接近哪种，就用哪种。
- `theme.primaryColor`：参考图里 section title / 强调色的主色，hex 格式如 `#2B72CC`。
- `sectionIcons`：每个 section 用什么 lucide 图标。**必须从下面的白名单里挑**——凭脑子写图标名容易挑到 lucide 里不存在的（比如 "Soccer"、"Wechat"），前端会渲染空白。

### Lucide 图标白名单（按 section 类型分组）

下列名字都是 lucide-react v0.x 实际存在的导出名（项目已验证，部分已在代码里使用）。给一个 section 选 icon 时，**只能从这里挑**：

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

**装饰图 placement**：根据装饰图实际尺寸和参考图的视觉位置定。常见配置（A4 800px 宽页面）：

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

### Step 4：调 insert-template.ts 入库

```bash
pnpm exec tsx --env-file=.env.local \
  template-studio-skill/scripts/insert-template.ts \
  --id <模板id> \
  --name "<中文名>" \
  --description "<一句话描述>" \
  --decoration '<DecorationConfig JSON>' \
  --layout '<LayoutConfig JSON>'
```

`--env-file=.env.local` 必传——脚本要读 `DATABASE_URL`。

### Step 5：验证

```bash
pnpm exec tsx --env-file=.env.local scripts/verify-templates.ts
```

新模板的 id 应出现在 `listAllTemplatesAsync` 输出的 `source=uploaded` 行里。

## 输出给用户

- 装饰图路径：`public/templates/decorations/<id>.png`
- 模板 id 和名字（已入 DB）
- 提示用户：刷新 dashboard / 编辑器的"模板与排版"picker 能看到新模板

## 注意

- **API key**：脚本从环境变量 `OPENAI_API_KEY` 读。如果未设，从 `~/.claude/reference/keys.md` 找当前可用的 BMC 中转 key 并 `export`。
- **API 调用 30-60s**（gpt-image-2），耐心等待。HTTP 000 状态是网络抖动，重跑即可。
- **token 消耗**：单次 edits 调用约 1500-1700 tokens。装饰提取尽量一次成功，反复试会浪费配额。
- **prompt 反复改不出效果**：不是 prompt 问题，是 model 极限——比如它无法 1:1 复制装饰元素的精确数量/排列。接受"风格 + 位置"对齐即可，细节在产品层用 CSS placement 调。
