import {
  pgTable, text, timestamp, jsonb, primaryKey, integer, boolean,
  uniqueIndex, index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { AdapterAccountType } from "next-auth/adapters";
import type { ResumeContent } from "@intro-builder/shared/schemas";
import type {
  AgentResumeSessionMode,
  AgentSessionSnapshot,
  AgentSessionStatus,
  ProposalStatus,
} from "@intro-builder/shared/types";

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
  /**
   * 文档修订号。每次通过提交模块成功写入 +1；旧行从 0 起。
   *
   * 它是**并发保护的 CAS 条件**：提交语句带 `WHERE revision = expectedRevision`。
   * 浏览器不得决定新值 —— 服务端在一条 SQL 里 `revision = expectedRevision + 1`。
   */
  revision: integer("revision").notNull().default(0),
  slug: text("slug"),
  isPublic: boolean("isPublic").notNull().default(false),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
}, (r) => ({
  userIdx: index("resume_user_idx").on(r.userId),
  slugIdx: uniqueIndex("resume_slug_idx").on(r.slug),
}));

export const resumeVersions = pgTable("resume_version", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  resumeId: text("resumeId").notNull().references(() => resumes.id, { onDelete: "cascade" }),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  templateId: text("templateId").notNull(),
  content: jsonb("content").$type<ResumeContent>().notNull(),
  /*
   * 来源集合必须与 `CommitPrincipal.source` 一致（9 种）。
   *
   * 此前这里只声明了 3 种，而提交层会写入 `polish` / `template` / `style` /
   * `collab` / `undo` —— TS 类型与真实数据不符，且读取层据此把未知来源
   * 一律显示成「手动保存」，等于**谎报来源**。
   */
  source: text("source")
    .$type<
      | "manual"
      | "agent"
      | "polish"
      | "restore"
      | "template"
      | "style"
      | "system"
      | "collab"
      | "undo"
    >()
    .notNull(),
  actorName: text("actorName").notNull(),
  operationCount: integer("operationCount").notNull().default(1),
  summary: text("summary"),
  parentVersionId: text("parentVersionId"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  /*
   * 以下 6 列由迁移 0014 添加，但**长期没被写进 schema**。
   *
   * 后果是真实的：数据库里一直有这些列、提交层也一直在写它们
   * （见 `resume-mutations/store.ts` 的 `version_inserted` CTE），
   * 但 Drizzle 的查询无法引用未声明的列 —— 因此 `listResumeVersions`
   * 取不出 `runId`，UI 也就无法「按任务聚合」或「跳回任务」（P06 任务 5），
   * 撤销也拿不到 `mutationId`。
   *
   * 补上它们之后，读取层才能取到聚合与撤销所需的全部信息。
   */
  revision: integer("revision"),
  fromRevision: integer("fromRevision"),
  changeSetId: text("changeSetId"),
  runId: text("runId"),
  sourceDetail: text("sourceDetail"),
  mutationId: text("mutationId"),
}, (t) => ({
  resumeCreatedIdx: index("resume_version_resume_created_idx").on(t.resumeId, t.createdAt),
  userIdx: index("resume_version_user_idx").on(t.userId),
}));

// ─── Agent Sessions ─────────────────────────────────────────

export const agentSessions = pgTable("agent_session", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  resumeId: text("resumeId").references(() => resumes.id, { onDelete: "cascade" }),
  mode: text("mode").$type<AgentResumeSessionMode>().notNull().default("optimize_existing"),
  status: text("status").$type<AgentSessionStatus>().notNull().default("active"),
  title: text("title").notNull(),
  stateJson: jsonb("stateJson").$type<AgentSessionSnapshot>().notNull(),
  lastResumeContentHash: text("lastResumeContentHash"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
}, (t) => ({
  userIdx: index("agent_session_user_idx").on(t.userId),
  resumeIdx: index("agent_session_resume_idx").on(t.resumeId),
  statusIdx: index("agent_session_status_idx").on(t.status),
}));

export const agentSessionEvents = pgTable("agent_session_event", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text("sessionId").notNull().references(() => agentSessions.id, { onDelete: "cascade" }),
  runId: text("runId").notNull(),
  sequence: integer("sequence").notNull(),
  type: text("type").notNull(),
  payloadJson: jsonb("payloadJson").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
}, (t) => ({
  sessionIdx: index("agent_session_event_session_idx").on(t.sessionId),
  runIdx: index("agent_session_event_run_idx").on(t.runId),
  uniqueRunSequenceIdx: uniqueIndex("agent_session_event_run_sequence_idx").on(
    t.sessionId,
    t.runId,
    t.sequence,
  ),
}));

export const agentFloatingChatSessions = pgTable("agent_floating_chat_session", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  /** 聊天记录的格式版本。迁移 0015 新增；读侧 adapter 据此兼容旧 parts。 */
  formatVersion: integer("formatVersion").notNull().default(1),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  resumeId: text("resumeId").notNull().references(() => resumes.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("新对话"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
}, (t) => ({
  userResumeIdx: index("agent_floating_chat_session_user_resume_idx").on(t.userId, t.resumeId),
  updatedAtIdx: index("agent_floating_chat_session_updated_at_idx").on(t.updatedAt),
}));

export const agentFloatingChatMessages = pgTable("agent_floating_chat_message", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  formatVersion: integer("formatVersion").notNull().default(1),
  /** 该消息所属的 Run（可空：旧消息与手动消息没有 Run）。 */
  runId: text("runId"),
  sessionId: text("sessionId").notNull().references(() => agentFloatingChatSessions.id, { onDelete: "cascade" }),
  role: text("role").$type<"user" | "assistant">().notNull(),
  content: text("content").notNull(),
  parts: jsonb("parts").$type<Array<Record<string, unknown>>>(),
  toolCalls: jsonb("toolCalls").$type<Array<Record<string, unknown>>>(),
  operations: jsonb("operations").$type<Array<Record<string, unknown>>>(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
}, (t) => ({
  sessionCreatedAtIdx: index("agent_floating_chat_message_session_created_at_idx").on(t.sessionId, t.createdAt),
}));

// ─── Collaboration Sessions ──────────────────────────────────

export const collabSessions = pgTable("collab_session", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  resumeId: text("resumeId").notNull().references(() => resumes.id, { onDelete: "cascade" }),
  ownerId: text("ownerId").notNull().references(() => users.id, { onDelete: "cascade" }),
  inviteToken: text("inviteToken").notNull(),
  mode: text("mode").$type<"edit" | "comment">().notNull().default("edit"),
  mentorName: text("mentorName"),
  status: text("status").$type<"pending" | "active" | "ended" | "expired">().notNull().default("pending"),
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

// ─── AI Runs (P04) ───────────────────────────────────────────

/**
 * 一次用户任务的执行记录。
 *
 * 与「一次 HTTP 连接」不是一回事：一个 Run 可以有多个 attempt（续做/重试），
 * 连接断开不等于任务结束。`sequence` 在同 Run 内跨 attempts 单调递增。
 */
export const aiRuns = pgTable("ai_run", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  resumeId: text("resumeId").notNull().references(() => resumes.id, { onDelete: "cascade" }),
  sessionId: text("sessionId"),
  /** 客户端幂等键：重复 start 复用同一个 Run，不二次调用模型。 */
  requestId: text("requestId").notNull(),
  status: text("status")
    .$type<"running" | "waiting_user" | "completed" | "failed" | "cancelled" | "interrupted">()
    .notNull()
    .default("running"),
  mode: text("mode").notNull().default("optimize_existing"),
  writeMode: text("writeMode").$type<"direct" | "approval">().notNull().default("direct"),
  /**
   * 同一简历同一时刻只允许一个写 Run。
   * `leaseOwner` + `leaseExpiresAt` 提供租约，`fenceToken` 递增以作废旧持有者 ——
   * 平台硬杀后旧持有者可能晚到，fencing 才能拦住它的写入。
   */
  leaseOwner: text("leaseOwner"),
  leaseExpiresAt: timestamp("leaseExpiresAt", { mode: "date" }),
  fenceToken: integer("fenceToken").notNull().default(0),
  cancelRequestedAt: timestamp("cancelRequestedAt", { mode: "date" }),
  deadlineAt: timestamp("deadlineAt", { mode: "date" }),
  startedAt: timestamp("startedAt").notNull().defaultNow(),
  finishedAt: timestamp("finishedAt", { mode: "date" }),
  checkpointVersion: integer("checkpointVersion").notNull().default(0),
  checkpoint: jsonb("checkpoint").$type<Record<string, unknown>>(),
  promptVersion: text("promptVersion"),
  modelId: text("modelId"),
  usage: jsonb("usage").$type<Record<string, unknown>>(),
  parentRunId: text("parentRunId"),
  lastError: text("lastError"),
  /**
   * 事件序号分配器。
   *
   * 用 `UPDATE ... SET x = x + 1 RETURNING x` 原子取号：行级锁 + 重新读取能真正
   * 串行化。CTE 里 `MAX("sequence") + 1` 不行 —— 语句快照在加锁前就已确定，
   * 并发语句会算出同一个序号并撞唯一键（实测）。
   */
  eventSequence: integer("eventSequence").notNull().default(0),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
}, (t) => ({
  userRequestIdx: uniqueIndex("ai_run_user_request_id_idx").on(t.userId, t.requestId),
  resumeStatusIdx: index("ai_run_resume_status_idx").on(t.resumeId, t.status),
  sessionIdx: index("ai_run_session_created_idx").on(t.sessionId, t.createdAt),
  /**
   * 找「当前持有 lease 的活跃 Run」是热路径。部分索引（只覆盖 leaseOwner 非空的行）
   * 与迁移 0015 一致 —— schema 与迁移必须同步，否则 drizzle-kit 的后续 diff
   * 会产生噪声，且新环境的建表结果与迁移结果不同。
   */
  leaseIdx: index("ai_run_lease_idx")
    .on(t.resumeId, t.leaseExpiresAt)
    .where(sql`"leaseOwner" IS NOT NULL`),
}));

export const aiToolExecutions = pgTable("ai_tool_execution", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  runId: text("runId").notNull().references(() => aiRuns.id, { onDelete: "cascade" }),
  attemptId: text("attemptId").notNull(),
  toolCallId: text("toolCallId").notNull(),
  toolName: text("toolName").notNull(),
  inputHash: text("inputHash").notNull(),
  status: text("status").$type<"running" | "succeeded" | "failed" | "interrupted">().notNull(),
  result: jsonb("result").$type<Record<string, unknown>>(),
  proposalId: text("proposalId"),
  mutationId: text("mutationId"),
  changeSetId: text("changeSetId"),
  errorCode: text("errorCode"),
  startedAt: timestamp("startedAt").notNull().defaultNow(),
  finishedAt: timestamp("finishedAt", { mode: "date" }),
}, (t) => ({
  attemptCallIdx: uniqueIndex("ai_tool_execution_attempt_call_idx").on(
    t.runId,
    t.attemptId,
    t.toolCallId,
  ),
}));

export const aiRunEvents = pgTable("ai_run_event", {
  eventId: text("eventId").primaryKey(),
  runId: text("runId").notNull().references(() => aiRuns.id, { onDelete: "cascade" }),
  attemptId: text("attemptId").notNull(),
  sequence: integer("sequence").notNull(),
  type: text("type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  sourceEventId: text("sourceEventId"),
  occurredAt: timestamp("occurredAt").notNull().defaultNow(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
}, (t) => ({
  runSequenceIdx: uniqueIndex("ai_run_event_run_sequence_idx").on(t.runId, t.sequence),
  /**
   * outbox 投影去重：同一源事件只投影一次。
   *
   * 这是**部分唯一索引**：`ON CONFLICT` 必须复述同一谓词，否则 Postgres 找不到
   * 匹配的 arbiter 索引并抛 42P10（实测踩过）。
   */
  sourceEventIdx: uniqueIndex("ai_run_event_source_event_idx")
    .on(t.sourceEventId)
    .where(sql`"sourceEventId" IS NOT NULL`),
}));

export type DbAiRun = typeof aiRuns.$inferSelect;
export type DbAiToolExecution = typeof aiToolExecutions.$inferSelect;
export type DbAiRunEvent = typeof aiRunEvents.$inferSelect;

// ─── Change Sets & Decisions (P04) ───────────────────────────

/**
 * 一次用户任务聚合的提案。
 *
 * 提案内容一旦被批准就**不能原地修改** —— 任何重新生成都产生新的
 * `proposalVersion`，旧的批准不会自动延伸。
 */
export const resumeChangeSets = pgTable("resume_change_set", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  resumeId: text("resumeId").notNull().references(() => resumes.id, { onDelete: "cascade" }),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  /** 提案基于的修订号；提交时用它做 CAS 前置条件之一。 */
  baseRevision: integer("baseRevision").notNull(),
  proposalVersion: integer("proposalVersion").notNull().default(1),
  operations: jsonb("operations").$type<unknown[]>().notNull(),
  status: text("status").$type<ProposalStatus>().notNull().default("draft"),
  runId: text("runId"),
  summary: text("summary"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
}, (t) => ({
  resumeCreatedIdx: index("resume_change_set_resume_created_idx").on(t.resumeId, t.createdAt),
  runIdx: index("resume_change_set_run_idx").on(t.runId),
}));

/**
 * 用户对**精确提案版本**的接受/拒绝。
 *
 * 决策表达「用户选择」，回执表达「实际应用」—— 两者必须分开记录：
 * 用户批准了但 revision 冲突时，决策已成立而修改并未保存，UI 应显示
 * 「已确认，尚未保存：内容冲突」而不是「已批准并应用」。
 */
export const resumeDecisions = pgTable("resume_decision", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  changeSetId: text("changeSetId")
    .notNull()
    .references(() => resumeChangeSets.id, { onDelete: "cascade" }),
  proposalVersion: integer("proposalVersion").notNull(),
  acceptedOperationIds: jsonb("acceptedOperationIds").$type<string[]>().notNull(),
  rejectedOperationIds: jsonb("rejectedOperationIds").$type<string[]>().notNull(),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
}, (t) => ({
  changesetVersionIdx: uniqueIndex("resume_decision_changeset_version_idx").on(
    t.changeSetId,
    t.proposalVersion,
  ),
}));

export type DbChangeSet = typeof resumeChangeSets.$inferSelect;
export type DbDecision = typeof resumeDecisions.$inferSelect;
