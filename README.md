# intro-builder

[![CI](https://github.com/Rory-X/intro-builder/actions/workflows/ci.yml/badge.svg)](https://github.com/Rory-X/intro-builder/actions/workflows/ci.yml)

面向互联网求职者的在线简历排版工具。Next.js 16 App Router + Neon Postgres + Auth.js v5 Magic Link + @react-pdf/renderer。

## 功能

- 邮箱 Magic Link 登录（Resend），无密码
- 结构化编辑：基础信息 / 教育 / 工作经历 / 项目 / 技能
- 双模板（经典 / 现代），实时预览
- 2 秒防抖自动保存
- 一键导出 A4 PDF（支持中文，内置 Noto Sans SC）
- 一键开启公开只读分享链接 `/r/[slug]`

## 本地开发

```bash
pnpm install
cp .env.example .env.local
# 填入 DATABASE_URL / AUTH_SECRET / AUTH_RESEND_KEY / AUTH_EMAIL_FROM
pnpm drizzle-kit migrate
pnpm dev
```

要生成 AUTH_SECRET：

```bash
openssl rand -base64 32
```

## 跑测试

```bash
pnpm test             # 单测 (vitest)
pnpm tsc --noEmit     # 类型检查
pnpm build            # 生产构建
```

## Vercel 部署

1. 推到 GitHub，在 Vercel Dashboard → Import Project。
2. Vercel Dashboard → Storage → Create / Connect **Neon Postgres**（免费档）。`DATABASE_URL` 会自动注入。
3. 在 [Resend](https://resend.com) 注册 → 验证域名 → 拿到 API Key。
4. Vercel 项目 → Settings → Environment Variables，添加：
   - `AUTH_SECRET` — `openssl rand -base64 32`
   - `AUTH_URL` — 例如 `https://your-app.vercel.app`
   - `AUTH_RESEND_KEY` — 来自 Resend
   - `AUTH_EMAIL_FROM` — 例如 `login@your-domain.com`
5. 本地用生产 `DATABASE_URL` 跑一次 `pnpm drizzle-kit migrate` 初始化表。
6. Vercel 触发部署。

## 目录

- `app/` — 路由与页面（App Router）
- `components/editor/` — 编辑器分区组件
- `components/ui/` — shadcn/ui 原语
- `lib/templates/<id>/Layout.tsx` — 屏上预览
- `lib/templates/<id>/Pdf.tsx` — PDF 导出
- `db/` — Drizzle schema + migrations
- `docs/superpowers/` — 设计 spec 与实施 plan

## 容量（Vercel Hobby 免费档，100 人/月）

| 资源 | 免费额度 | 估算用量 |
|---|---|---|
| Vercel 带宽 | 100 GB | ~2 GB |
| Neon 存储 | 0.5 GB | ~10 MB |
| Resend 邮件 | 3000/月 | ~500 |

## License

MIT
