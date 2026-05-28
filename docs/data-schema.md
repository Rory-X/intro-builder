# 数据 schema 与数据库

intro-builder 的数据存储分两层：**Postgres**（用户、简历、协作 session、模板）+ **Vercel Blob**（用户上传的头像图片，公开可读）。本文是当前 schema 的快照——改完任何一张表请同步本文，否则会跟 `db/schema.ts` 漂移。

## 全局约定

- **驱动选择**：`db/connection.ts` 按主机名挑驱动——`*.neon.tech` 走 Neon HTTP，其他走 `postgres.js` TCP。**永远从 `db/index.ts` 拿 `db`**，不要直接 import Neon client
- **Migration 流程**：`pnpm drizzle-kit migrate`。CN 环境到 ap-southeast-1 经常 hang，备用方案是 `pnpm exec tsx --env-file=.env.local scripts/apply-templates-migration.ts`（走 Neon HTTP）
- **列命名**：项目走 camelCase（`thumbnailUrl` 不是 `thumbnail_url`）。Auth.js v5 的 user/account/session/verificationToken 表沿用 NextAuth 默认列名（也是 camelCase，吻合）
- **构建期占位 DATABASE_URL**：`db/index.ts` 在 `next build` 时回退到占位串避免崩，运行时仍会失败——这是有意为之，不要"修掉"那条警告

## 表结构

### `user` / `account` / `session` / `verificationToken`

Auth.js v5 标准四表，用户登录态 + 魔法链接。`session` 默认 14 天 TTL（`lib/auth.ts`）。`account` 表理论上支持 OAuth 但本项目只用魔法链接 + 邮箱密码，几乎不写。

### `resume`（核心业务表）

主键 `id` (uuid)。关键列：

- `userId` → `user.id`，`onDelete: cascade`
- `title` text，简历名
- `content` jsonb NOT NULL，**Zod schema** `ResumeContent`（见 `lib/resume-schema.ts`）—— basics / education[] / experience[] / projects[] / skills[] / custom[] / sectionOrder / styleSettings / smartLayout
- `templateId` text，指向 `templates.id` 或 builtin id（`professional` / `classic` / `modern`）；运行时 `getTemplateMetaAsync` 解析，未知 id 收敛到 default builtin（不抛错）
- `isPublic` bool + `slug` text unique nullable —— 公开分享 `/r/[slug]`
- `createdAt` / `updatedAt` timestamp

**信任边界**：写入路径（`saveResume` server action）走 `ResumeContent.safeParse` 拒坏数据；读出路径（preview / PDF / 模板渲染）信任 jsonb 已解析过，不二次校验。

### `collab_session`（协作会话）

主键 `id` (uuid)，`resumeId` → `resume.id`（cascade），`ownerToken` / `inviteCode`，`expiresAt` timestamp。PartyKit room 的元数据。

### `templates`（DB 模板，spec v0.5 + Skill v2）

主键 `id` text。两阶段长出来：v0.5 加表（migration `0001_odd_vindicator`），Skill v2 加 `customHtml`/`customCss` 列（migration `0002_flimsy_absorbing_man`）。

| 列 | 类型 | 用途 |
|---|---|---|
| `id` | text PK | 模板 id（`abbey` / `abbey-stub` / `crimson-banner` 等） |
| `name` | text NOT NULL | 显示名 |
| `description` | text NULL | 描述（registry 边界 coerce 成 `""`，渲染层不见 null） |
| `thumbnailUrl` | text NULL | 静态缩略图 URL；null 时前端走 `<TemplateThumbnail>` live render |
| `source` | text NOT NULL | `"uploaded"` / `"builtin"`（builtin 实际不入库，列保留通用性以便统一排序 / 过滤） |
| `decoration` | jsonb NULL | 背景装饰图配置，Zod `DecorationConfig`（bgImageUrl + placement + 可选 pageBgColor） |
| `layout` | jsonb NOT NULL | v1 enum 排版配置，Zod `LayoutConfig` —— frame（discriminated union）+ headerVariant / sectionTitleVariant / itemHeaderVariant + theme + sectionIcons |
| `customHtml` | text NULL | **v2** 自由 HTML，存在则引擎走 `SlotRenderer`，否则走 v1 enum 路径 |
| `customCss` | text NULL | **v2** 自由 CSS（与 `customHtml` 配对，独立可空但通常成对出现） |
| `status` | text NOT NULL default `'draft'` | `'draft'` / `'published'`，前端只列 published |
| `createdBy` | text NULL | 创建人 user id（Skill 产出的不挂用户） |
| `createdAt` / `updatedAt` | timestamp NOT NULL default `now()` | |

**双路径共存**：v1 enum 路径（abbey / abbey-stub）和 v2 自由排版（crimson-banner）由 `customHtml` 是否为 null 决定，`UploadedLayout.tsx` 在 dispatch 处分流。这是有意为之的兼容设计——v2 落地时不强制重写存量模板。

#### Zod schema 链（`lib/templates/uploaded/types.ts`）

zod-first 重写后的层次（commit `461699a`）：

```
UploadedTemplate
├── id, name, description, thumbnailUrl
├── decoration: DecorationConfig | null
│   └── bgImageUrl + placement{position/top/right/width/height/zIndex/opacity} + 可选 pageBgColor
├── layout: LayoutConfig
│   ├── frame: FrameConfig                    ← discriminatedUnion("kind", ...)
│   │   ├── { kind: "vertical" }              ← 单栏
│   │   └── { kind: "horizontal", sidebar:    ← 侧栏 + 主区
│   │       { side, width, sections, bgColor?, textColor? } }
│   ├── headerVariant: "classic"|"professional"|"modern"
│   ├── sectionTitleVariant: 同上 + "card-wrapped"  ← 圆角白卡片包裹整段
│   ├── itemHeaderVariant: 上面三个（不含 card-wrapped，narrowing helper 收敛）
│   ├── theme: { primaryColor, accentColor?, cardBg?, cardRadius?, cardShadow?, fontFamily? }
│   └── sectionIcons: Record<sectionKey, lucideName>  ← 白名单 35 个
├── customHtml: string | null   ← v2
└── customCss:  string | null   ← v2
```

**关键约束**：`SectionTitleVariantSchema = z.enum([...]) satisfies z.ZodType<ResumeSectionVariant>` —— 用 `satisfies` 在编译期阻断 Zod enum 与外部类型 alias 漂移；`FrameConfig` 用 discriminated union，TypeScript narrowing 让 horizontal 分支的 sidebar 字段可访问。

#### 信任边界

- **写**：Skill 产出 → `template-studio-skill/scripts/insert-template.ts` 走 Zod 校验后 INSERT
- **读**：`lib/templates/uploaded/fetch.ts` 的 `parseTemplateRow` 用 `UploadedTemplate.safeParse`，**坏行 `console.warn(\`[templates] parseTemplateRow rejected id=${id}:\` + flatten()) + return null`**，列表过滤 null —— 单行坏不击穿整页 gallery

### Registry 元数据扩展（不在 DB，在代码里）

`lib/templates/registry.ts` 的 `TemplateMeta` 类型（commit `deaf637`）加了 3 个字段：

- `defaultStyleSettings: StyleSettings` —— 必填。`setTemplate(resetStyleSettings:true)` 把这份写进 resume 的 styleSettings
  - **professional / classic** → `DENSITY_PRESETS.standard.settings`（classic fontFamily 改 serif）
  - **modern** → 紧凑 `{fontSize:12, lineHeight:1.5, pagePadding:32}`，双栏 layout 不被默认字号撑爆
  - **uploaded** → `DENSITY_PRESETS.standard.settings` fallback（jsonb 暂未存）
- `category?: TemplateCategory` —— `"simple" | "timeline" | "twocol" | "creative" | "academic"`
- `tags?: string[]`

`AllTemplatesItem`（SC→CC 边界 picker UI 序列化形状）镜像同字段。

## Vercel Blob

- **路径**：`photos/<userId>/<timestamp>-<filename>`
- **Access**：`public`（公开只读简历 `/r/[slug]` 直链展示需要）
- **大小限制**：4MB，类型限 `image/*`
- **写入路径**：`PUT /api/upload-photo`，走 `currentUserId()` 鉴权（dev bypass 兼容）

## Migration 历史

| 文件 | 作用 |
|---|---|
| `0000_wooden_mandarin.sql` | 初始：user / account / session / verificationToken / resume / collab_session |
| `0001_odd_vindicator.sql` | 加 `templates` 表（v0.5 模板库） |
| `0002_flimsy_absorbing_man.sql` | `ALTER TABLE templates ADD COLUMN customHtml/customCss`（Skill v2） |

下一次 migration 文件名走 drizzle-kit 自动生成的 `00XX_<random>.sql`，编辑前先 `pnpm drizzle-kit generate`。

## 改 schema 的 checklist

1. 改 `db/schema.ts`
2. `pnpm drizzle-kit generate` 生出 `db/migrations/00XX_*.sql`
3. **review 生成的 SQL**——drizzle 偶尔会推断成"建新表 + 复制数据 + 删旧表"，存量数据多时务必盯好
4. 跑 migration（`pnpm drizzle-kit migrate` 或 `scripts/apply-templates-migration.ts`）
5. 同步改 Zod schema（`lib/resume-schema.ts` / `lib/templates/uploaded/types.ts`），保持向后兼容（新字段 `.default()` / `.optional()`）
6. **更新本文**
7. 跑 `pnpm test && pnpm tsc --noEmit && pnpm lint && pnpm build` 全绿再 commit
