# intro-builder

[![CI](https://github.com/Rory-X/intro-builder/actions/workflows/ci.yml/badge.svg)](https://github.com/Rory-X/intro-builder/actions/workflows/ci.yml)

面向中文互联网求职者的在线简历排版工具。结构化编辑 → 实时预览 → 一键导出 A4 PDF → 可选公开只读分享链接。

## 技术栈

Next.js 16 App Router · React 19 · Drizzle ORM + Neon Postgres / 本地 Postgres · Auth.js v5 · TipTap 富文本 · Puppeteer PDF · PartyKit 协同编辑 · Vercel Blob · Tailwind v4

## 功能

### 编辑与排版

- 结构化分区编辑：基础信息 / 教育 / 工作经历 / 项目 / 技能 / 自定义模块
- TipTap 富文本编辑器，支持格式化、链接、对齐、字号调节
- 模板库（`/templates`）：三套内置（专业 / 经典 / 现代）+ DB 上传模板，预览抽屉直接套用到当前简历
- 分区与条目拖拽排序（Pragmatic Drag & Drop）
- 头像上传（Vercel Blob）
- 2 秒防抖自动保存，串行队列防丢失
- 可调密度 / 行高 / 页边距样式预设
- 可缩放 editor / preview 分屏面板

### 导入与导出

- **简历导入**：支持 PDF / Word / 图片文件，OCR 识别 + DeepSeek AI 结构化解析，SSE 流式反馈进度
- **PDF 导出**：Puppeteer 逐页截图 + pdf-lib 合成，确保与屏幕预览像素级一致
- **公开分享**：一键生成只读链接 `/r/[slug]`

### 协同编辑

- PartyKit + Y.js 实时协同，导师可通过邀请链接加入
- WebRTC P2P 语音通话（PartyKit 信令）
- 批注系统：导师可高亮标注 + 评论，求职者即时查看

### 账号与安全

- 邮箱 Magic Link 登录（Resend）
- 密码登录 + 邮箱验证码修改密码
- 简历完成度评分，Dashboard 卡片总览
- 移动端检测提示（编辑器仅支持 PC）

## 本地开发

```bash
pnpm install
cp .env.example .env.local
# 填入必需的环境变量（见下方说明）
pnpm drizzle-kit migrate
pnpm dev
```

### 环境变量

| 变量 | 必需 | 说明 |
|---|---|---|
| `DATABASE_URL` | ✅ | Postgres 连接串。`*.neon.tech` 走 Neon HTTP driver，`localhost` 走 `postgres.js` TCP |
| `DATABASE_URL_UNPOOLED` | | 直连地址，`drizzle-kit migrate` 优先使用 |
| `AUTH_SECRET` | ✅ | `openssl rand -base64 32` |
| `AUTH_URL` | ✅ | 应用 URL，本地为 `http://localhost:3000` |
| `AUTH_RESEND_KEY` | ✅ | [Resend](https://resend.com) API Key |
| `AUTH_EMAIL_FROM` | ✅ | 发件地址，如 `login@your-domain.com` |
| `BLOB_READ_WRITE_TOKEN` | | Vercel Blob token，头像上传需要 |
| `DEEPSEEK_API_KEY` | | DeepSeek API Key，简历导入功能需要 |
| `OCR_SPACE_API_KEY` | | OCR.space API Key，图片/扫描件导入需要 |
| `NEXT_PUBLIC_PARTYKIT_HOST` | | PartyKit 服务地址，协同编辑需要 |

### 协同编辑服务（可选）

```bash
cd partykit
pnpm install
pnpm dev    # 启动本地 PartyKit 服务
```

## 测试与验证

```bash
pnpm test             # Vitest 单测
pnpm tsc --noEmit     # 类型检查
pnpm lint             # ESLint
pnpm build            # 生产构建
pnpm verify           # 一键运行以上全部
```

## 部署

### Vercel（主应用）

1. 推到 GitHub → Vercel Dashboard → Import Project
2. Vercel Storage → 添加 **Neon Postgres**（`DATABASE_URL` 自动注入）
3. Settings → Environment Variables 添加上述必需变量
4. 本地用生产 `DATABASE_URL_UNPOOLED` 跑 `pnpm drizzle-kit migrate` 初始化表
5. 触发部署

### PartyKit（协同编辑服务）

```bash
cd partykit
pnpm deploy
```

## 项目结构

```
app/
  (marketing)/          公开落地页
  (auth)/               登录、验证
  (app)/                Dashboard、编辑器、server actions
  api/pdf/[id]/         Puppeteer PDF 导出
  api/import-resume/    AI 简历导入
  api/upload-photo/     头像上传
  collab/[token]/       协同编辑页
  r/[slug]/             公开只读简历
components/
  editor/               各分区编辑器
  preview/              实时预览面板
  collab/               协同编辑 UI（批注、语音）
  ui/                   shadcn/ui 原语
lib/
  templates/            professional / classic / modern + 共享原语
  resume-schema.ts      Zod schema（简历数据契约）
  auth.ts               Auth.js 配置
  pdf-route-helpers.ts  Puppeteer 启动与字体等待
db/                     Drizzle schema + migrations
hooks/                  autosave、collab provider 等
partykit/               PartyKit 协同服务（独立部署）
proxy.ts                鉴权拦截（Next.js 16 的 middleware）
tests/unit/             Vitest 单测
docs/superpowers/       设计 spec 与实施 plan
```

## 容量估算（Vercel Hobby 免费档）

| 资源 | 免费额度 | 百人规模估算 |
|---|---|---|
| Vercel 带宽 | 100 GB | ~2 GB |
| Neon 存储 | 0.5 GB | ~10 MB |
| Resend 邮件 | 3000/月 | ~500 |
| Vercel Blob | 1 GB | 头像约数十 MB |
| PartyKit | 免费档 | 低并发场景足够 |
| DeepSeek API | 按量计费 | ~¥0.01/次导入 |

## License

MIT
