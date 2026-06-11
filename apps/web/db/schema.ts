import {
  pgTable, text, timestamp, jsonb, primaryKey, integer, boolean,
  uniqueIndex, index,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";
import type { ResumeContent } from "@/lib/resume-schema";

export const users = pgTable("user", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").notNull(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
  passwordHash: text("passwordHash"),
}, (t) => ({
  emailIdx: uniqueIndex("user_email_idx").on(t.email),
}));

export const accounts = pgTable("account", {
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").$type<AdapterAccountType>().notNull(),
  provider: text("provider").notNull(),
  providerAccountId: text("providerAccountId").notNull(),
  refresh_token: text("refresh_token"),
  access_token: text("access_token"),
  expires_at: integer("expires_at"),
  token_type: text("token_type"),
  scope: text("scope"),
  id_token: text("id_token"),
  session_state: text("session_state"),
}, (a) => ({
  pk: primaryKey({ columns: [a.provider, a.providerAccountId] }),
}));

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable("verificationToken", {
  identifier: text("identifier").notNull(),
  token: text("token").notNull(),
  expires: timestamp("expires", { mode: "date" }).notNull(),
}, (v) => ({
  pk: primaryKey({ columns: [v.identifier, v.token] }),
}));

export const resumes = pgTable("resume", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("我的简历"),
  // 故意不设默认值:templateId 必须由创建方显式解析(getDefaultTemplateId() 查
  // isDefault 行)后传入。漏传直接撞 NOT NULL 报错,把 bug 暴露出来,而不是悄悄
  // 兜底成某套写死的模板。
  templateId: text("templateId").notNull(),
  content: jsonb("content").$type<ResumeContent>().notNull(),
  slug: text("slug"),
  isPublic: boolean("isPublic").notNull().default(false),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
}, (r) => ({
  userIdx: index("resume_user_idx").on(r.userId),
  slugIdx: uniqueIndex("resume_slug_idx").on(r.slug),
}));

// ─── Collaboration Sessions ──────────────────────────────────

export const collabSessions = pgTable("collab_session", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  resumeId: text("resumeId").notNull().references(() => resumes.id, { onDelete: "cascade" }),
  ownerId: text("ownerId").notNull().references(() => users.id, { onDelete: "cascade" }),
  inviteToken: text("inviteToken").notNull(),
  mode: text("mode").$type<"edit" | "comment">().notNull().default("edit"),
  mentorName: text("mentorName"),
  status: text("status").$type<"pending" | "active" | "expired">().notNull().default("pending"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  expiresAt: timestamp("expiresAt").notNull(),
}, (t) => ({
  tokenIdx: uniqueIndex("collab_session_token_idx").on(t.inviteToken),
  resumeIdx: index("collab_session_resume_idx").on(t.resumeId),
}));

// ─── Templates (template-studio middle platform) ─────────────

// templates 表 = 所有模板的唯一存储:classic/modern/professional 与用户上传的模板,
// 都是本表里的普通行,一视同仁(不再有"内置硬编码、不入表"那套特殊处理)。
// 本表是字段的唯一真源——每列含义写在下方注释里,改列时顺手改注释,
// 不要再另起一份文档去镜像它(会漂)。
export const templates = pgTable("templates", {
  /** 模板唯一标识。上传模板用 UUID / slug。 */
  id: text("id").primaryKey(),
  /** 模板显示名，模板库卡片与抽屉标题展示。 */
  name: text("name").notNull(),
  /** 一句话描述风格与适合人群。 */
  description: text("description"),
  /** 模板库静态缩略图 URL。预留：当前 grid 走 live 缩略图、抽屉永远 live，
   *  静态图暂未启用；模板量大后可用它替代部分 live 渲染提速。可空。 */
  thumbnailUrl: text("thumbnailUrl"),
  /** 用户视角分类，决定模板库 tab 归属（academic/tech/business/creative/general）。 */
  category: text("category"),
  /** 模板特点文案，通常 3 条，模板抽屉里展示。 */
  features: jsonb("features").$type<string[]>(),

  // ─── v2 统一渲染字段（SlotRenderer 消费） ───
  /** 模板 HTML，含 `<slot data-bind="...">` 占位；引擎解析 slot 填入简历内容。 */
  html: text("html"),
  /** 模板 CSS。必须走 CSS 变量合约（var(--font-size)/--section-gap/--body-line-height 等），
   *  写死数值则排版控件与智能排版对该模板无效；引擎自动加 scope 前缀防污染。 */
  css: text("css"),
  /** 每个 section 标题配的图标映射：`{ [sectionKey]: { icon: lucide白名单名, color? } }`，
   *  引擎注入到模板的 `section.icon` 槽。无声明则该 section 不显示图标。 */
  sectionIcons: jsonb("sectionIcons"),
  /** 模板推荐的初始排版，用户首次选用该模板时写入简历的 styleSettings；结构同 styleSettings。 */
  defaultStyleSettings: jsonb("defaultStyleSettings"),
  /** 预留：作者上传的 banner 图 URL（存 Vercel Blob），模板 HTML 里引用。暂未启用。 */
  bannerImageUrl: text("bannerImageUrl"),
  /** 默认模板标记。新建/导入/兜底模板解析只应有一行为 true。 */
  isDefault: boolean("isDefault").notNull().default(false),

  // ─── 公共字段 ───
  /** 模板状态。fetch 只取 published；draft 用于 template-studio 草稿审查流程。 */
  status: text("status").notNull().default("draft"),
  /** 创建时间；模板库列表按它排序。 */
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  /** 最后更新时间。 */
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type DbTemplate = typeof templates.$inferSelect;
export type NewDbTemplate = typeof templates.$inferInsert;

// ─── Template Favorites (user-level) ─────────────────────────

// 用户级模板收藏夹。templateId 指向 templates 表里任意一行(所有模板——含
// classic/modern/professional——现在都是表中的行)。故意**不加外键**:容忍孤儿
// ——模板被删后残留的收藏行无害,渲染时该模板不在列表里自然被过滤掉。
export const templateFavorites = pgTable("template_favorite", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  templateId: text("templateId").notNull(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
}, (t) => ({
  userTemplateIdx: uniqueIndex("template_favorite_user_template_idx").on(t.userId, t.templateId),
  userIdx: index("template_favorite_user_idx").on(t.userId),
}));

export type DbTemplateFavorite = typeof templateFavorites.$inferSelect;
export type NewDbTemplateFavorite = typeof templateFavorites.$inferInsert;
