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
  status: text("status").notNull().default("draft"),
  createdBy: text("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type DbTemplate = typeof templates.$inferSelect;
export type NewDbTemplate = typeof templates.$inferInsert;
