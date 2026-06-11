# intro-builder

<p align="center">
  <img src="./public/logo.png" alt="intro-builder logo" width="96" />
</p>

<p align="center">
  面向中文互联网求职者的在线简历工作台。
  <br />
  结构化编辑、实时 A4 预览、智能导入、AI 润色、协同批注、PDF 导出与公开分享，一站完成从撰写到投递。
</p>

<p align="center">
  <a href="https://github.com/Rory-X/intro-builder/actions/workflows/ci.yml">
    <img src="https://github.com/Rory-X/intro-builder/actions/workflows/ci.yml/badge.svg" alt="CI status" />
  </a>
</p>

## 产品定位

intro-builder 不是“填表后下载”的简历模板站，而是一个围绕中文互联网求职流程设计的在线工作台。用户可以把经历拆成结构化模块，在右侧实时看到 A4 纸张效果，并在同一份内容上切换模板、调整排版、邀请导师批注，最后导出与预览一致的 PDF，或生成公开只读链接发给 HR。

它关注三个问题：

- **内容怎么写清楚**：用基础信息、教育经历、工作经历、项目经历、技能、自定义模块组织简历，减少空白页焦虑。
- **版式怎么保持专业**：实时 A4 预览、模板库、密度/行高/边距预设、智能排版，让内容变化不会把格式带崩。
- **投递前怎么反复打磨**：AI 润色、完成度评分、导师协同批注、公开分享链接，支持从初稿到可投递版本的多轮迭代。

## 适合谁

- 正在准备暑期实习、秋招、社招跳槽的中文互联网求职者。
- 需要把旧 PDF / Word / 图片简历迁移成可持续编辑版本的人。
- 希望导师、学长学姐或同伴直接在简历上提修改建议的人。
- 想保留完整控制权，不希望 PDF 导出时出现字体丢失、排版偏移或模板水印的人。

## 核心流程

```text
导入或新建简历
  -> 结构化编辑内容
  -> 实时查看 A4 预览
  -> 切换模板与排版
  -> AI 润色 / 完成度检查 / 导师批注
  -> 导出 PDF 或生成公开链接
```

## 产品能力

### 写作与编辑

- 结构化分区编辑：基础信息、教育、工作经历、项目、技能、自定义模块。
- 富文本内容编辑：支持链接、对齐、颜色、下划线、字号等常见格式。
- AI 润色：在经历、项目、教育、自定义模块中生成更适合简历语境的表达建议，确认后再应用。
- 完成度评分：在编辑器和 Dashboard 中提示简历内容完整度。
- 拖拽排序：分区和条目都可以按投递重点重新排列。
- 自动保存：2 秒防抖保存，串行队列避免在途保存覆盖新内容。

### 预览与排版

- 实时 A4 预览：编辑时同步看到最终纸张效果。
- 模板库：支持按互联网、商务、创意、学术、通用等类别浏览模板。
- 一键试穿：把自己的简历内容直接套进模板预览，再决定是否应用。
- 收藏模板：常用模板可以收藏，编辑器内快速切换。
- 智能排版：在内容溢出时自动尝试压缩字号、行高和间距，让简历更接近一页可投递状态。
- 头像上传：支持带照片的简历模板与公开分享展示。

### 导入、导出与分享

- 智能解析导入：支持 PDF、Word、图片文件，通过 OCR 与 AI 解析为结构化字段。
- 像素级 PDF 导出：服务端复用预览页面生成 A4 PDF，尽量保证导出与屏幕预览一致。
- 公开只读链接：可生成 `/r/[slug]` 分享页，随时开启或关闭。
- 预览图导出：用于 Dashboard 卡片和分享场景中的简历视觉预览。

### 协同打磨

- 邀请导师协作：生成 24 小时有效的邀请链接。
- 两种协作模式：导师可直接帮改，或只在简历上批注评论。
- 实时在线状态：作者和导师可以看到彼此在线与修改记录。
- 语音沟通：协作场景内支持 WebRTC 语音通话。

## 设计原则

- **中文优先**：产品文案、模板排版和简历结构都围绕中文互联网求职场景设计。
- **预览即交付物**：编辑器预览、公开分享和 PDF 导出尽量复用同一套渲染路径。
- **内容与样式分离**：用户专注写经历，模板和排版设置负责呈现。
- **每一步都可回退**：AI 润色先给候选结果，模板应用前可预览，分享链接可随时关闭。

## 当前状态

项目处于 v0.3 之后的持续迭代阶段，已上线三套内置模板，并在推进模板库、富文本润色、导入解析、协同批注、智能排版与 Agent 能力等产品切片。更多过程文档在 [docs/superpowers](./docs/superpowers) 与 [docs/agent](./docs/agent) 中。

## 项目结构

本项目采用 pnpm workspace monorepo 结构：

- **apps/web/** - Next.js 主站（简历编辑器、预览、PDF 导出）
- **apps/agent/** - Agent 微服务（AI 能力：富文本润色、简历诊断、Agent Mode）
- **apps/partykit/** - WebSocket 协同服务（实时协作编辑）
- **packages/shared/** - 共享代码（types、schemas、utils）
- **packages/config/** - 共享配置（eslint、typescript）

## 开发

```bash
pnpm install          # 安装依赖
pnpm dev              # 启动所有应用
pnpm dev:web          # 只启动 Web
pnpm dev:agent        # 只启动 Agent
pnpm dev:partykit     # 只启动 PartyKit
pnpm verify           # 运行所有检查（lint + typecheck + test + build）
```

常用单项命令：

```bash
pnpm test             # 运行测试
pnpm lint             # 运行 lint
pnpm typecheck        # 类型检查
pnpm build            # 构建所有应用
```

关键开发约定见 [AGENTS.md](./AGENTS.md)。环境变量示例见 [apps/web/.env.example](./apps/web/.env.example)。Agent 微服务说明见 [docs/agent/README.md](./docs/agent/README.md)。

## License

MIT
