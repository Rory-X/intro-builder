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
  templateId: text("templateId").notNull().default("professional"),
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

export const templates = pgTable("templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  thumbnailUrl: text("thumbnailUrl"),
  source: text("source").notNull(),
  decoration: jsonb("decoration"),
  layout: jsonb("layout").notNull(),
  // Skill v2 自由排版：customHtml / customCss 存在时引擎走 SlotRenderer，否则
  // 走老的 layout JSON enum 路径。两条路径共存以保护存量模板（abbey 等）。
  customHtml: text("customHtml"),
  customCss: text("customCss"),
  // 用户视角分类，决定模板库 tab 归属。值同 TemplateCategory enum：
  // academic / tech / business / creative / general。
  // text 而非 pgEnum：方便后续加新分类不需要 ALTER TYPE。
  category: text("category"),
  // 抽屉里"这个模板的特点"显示的 3 条 per-template 文案（string[]，长度 3）。
  // jsonb 而非 array：drizzle 对 array 的 zod codegen 不稳，jsonb 走 z.array 校验更直接。
  features: jsonb("features").$type<string[]>(),
  status: text("status").notNull().default("draft"),
  createdBy: text("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type DbTemplate = typeof templates.$inferSelect;
export type NewDbTemplate = typeof templates.$inferInsert;

// ─── Template Favorites (user-level) ─────────────────────────

// 用户级模板收藏夹。templateId 故意**不加外键指向 templates 表**：三个内置
// 模板（professional / classic / modern）硬编码在 lib/templates/registry.ts，
// 根本不存在于 DB templates 表（该表只装 uploaded 模板）。加 FK 会让"收藏内置
// 模板"违反外键约束。故 templateId 用纯 text，收藏 builtin / uploaded 都通吃。
// uploaded 模板被删后留下的孤儿行无害：渲染时模板不在列表里自然被过滤掉。
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
