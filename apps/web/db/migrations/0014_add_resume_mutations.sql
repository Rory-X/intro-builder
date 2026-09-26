-- P02：原子提交、修订与幂等回执
--
-- 全部为 additive 变更：不删除旧列、不改变旧行语义。回滚方式是「关闭新写入口 +
-- 保留这些表」，不是执行反向 migration（见 plan 的「命令与退出条件」）。
--
-- 关键约束：
--   resume.revision               —— 每次有效提交 +1；CAS 条件，浏览器不得决定新值
--   resume_mutation               —— 幂等回执；UNIQUE(resumeId, mutationId)
--   resume_mutation_event         —— 文档提交 outbox，与正文同一条 SQL 写入
--   resume_change_set             —— 一次用户任务聚合的提案
--   resume_decision               —— 用户对精确提案版本的接受/拒绝

-- ─── 1. 文档修订号 ───────────────────────────────────────────

-- 旧行从 0 起：0 表示「尚未经过新版提交路径」，因此第一次提交是 0 → 1。
ALTER TABLE "resume" ADD COLUMN IF NOT EXISTS "revision" integer NOT NULL DEFAULT 0;

-- ─── 2. 提交回执（幂等） ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS "resume_mutation" (
  "id" text PRIMARY KEY NOT NULL,
  -- 一次逻辑提交固定一个 ID：超时重试必须复用同一个，服务端才能识别为重放。
  "mutationId" text NOT NULL,
  "resumeId" text NOT NULL REFERENCES "resume"("id") ON DELETE cascade,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  -- 规范化请求哈希：同 mutationId 不同 payload 必须被拒绝（409）。
  "requestHash" text NOT NULL,
  "operationIds" jsonb NOT NULL,
  -- 按 operationIds 位置对齐的真实修改前后值。只有这里保存真实 before/after；
  -- prompt、tool 结果、前端都不能补写一个自称已应用的版本来替代回执。
  "beforeJson" jsonb NOT NULL,
  "afterJson" jsonb NOT NULL,
  -- 本提交产生的修订号（即提交后的 resume.revision）。
  "revision" integer NOT NULL,
  "versionId" text NOT NULL,
  -- 来源由服务端从可信调用上下文确定，不接受模型伪造。
  "source" text NOT NULL,
  "actorName" text NOT NULL,
  "summary" text,
  -- 条件撤销：指向被撤销的那条 mutation。
  "undoOf" text,
  "changeSetId" text,
  "changeSetVersion" integer,
  "decisionId" text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "resume_mutation_source_check" CHECK (
    "source" IN ('manual', 'agent', 'polish', 'restore', 'template', 'style', 'system', 'collab', 'undo')
  )
);

-- 幂等键：同一简历内 mutationId 唯一。
CREATE UNIQUE INDEX IF NOT EXISTS "resume_mutation_resume_mutation_id_idx"
  ON "resume_mutation" ("resumeId", "mutationId");

-- 每条提交对应唯一修订号，防止两条提交写入同一个 revision。
CREATE UNIQUE INDEX IF NOT EXISTS "resume_mutation_resume_revision_idx"
  ON "resume_mutation" ("resumeId", "revision");

CREATE INDEX IF NOT EXISTS "resume_mutation_resume_created_idx"
  ON "resume_mutation" ("resumeId", "createdAt");

CREATE INDEX IF NOT EXISTS "resume_mutation_changeset_idx"
  ON "resume_mutation" ("changeSetId");

-- ─── 3. 文档提交 outbox ──────────────────────────────────────

-- 可靠事件源：与正文、修订、回执在**同一条 SQL** 里写入。
-- ai_run_event 是它的按 Run 排序投影（P04），投影失败不能反过来报告提交失败。
CREATE TABLE IF NOT EXISTS "resume_mutation_event" (
  "eventId" text PRIMARY KEY NOT NULL,
  "mutationId" text NOT NULL,
  "resumeId" text NOT NULL REFERENCES "resume"("id") ON DELETE cascade,
  -- nullable：手动编辑没有 Run。
  "runId" text,
  "type" text NOT NULL DEFAULT 'mutation.committed',
  "payload" jsonb NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

-- 一条 mutation 只投影一次事件。
-- 必须带上 resumeId：mutationId 只在**单份简历内**唯一（与 resume_mutation 的
-- 幂等键 (resumeId, mutationId) 对齐）。只按 mutationId 建唯一索引会让两个用户
-- 各自使用的 "m-1" 互相撞键。
CREATE UNIQUE INDEX IF NOT EXISTS "resume_mutation_event_resume_mutation_id_idx"
  ON "resume_mutation_event" ("resumeId", "mutationId");

CREATE INDEX IF NOT EXISTS "resume_mutation_event_run_idx"
  ON "resume_mutation_event" ("runId");

CREATE INDEX IF NOT EXISTS "resume_mutation_event_resume_created_idx"
  ON "resume_mutation_event" ("resumeId", "createdAt");

-- ─── 4. 任务（change set）与决策 ─────────────────────────────

-- 一次用户任务对应一个 changeSet；每个提交有自身 revision，历史 UI 聚合为一个任务。
CREATE TABLE IF NOT EXISTS "resume_change_set" (
  "id" text PRIMARY KEY NOT NULL,
  "resumeId" text NOT NULL REFERENCES "resume"("id") ON DELETE cascade,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "title" text NOT NULL,
  -- 提案基于的修订号；批准后不能原地改内容，任何重新生成都产生新 proposalVersion。
  "baseRevision" integer NOT NULL,
  "proposalVersion" integer NOT NULL DEFAULT 1,
  "operations" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "runId" text,
  "summary" text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "resume_change_set_status_check" CHECK (
    "status" IN ('draft', 'pending', 'partially_committed', 'committed', 'rejected', 'superseded')
  )
);

CREATE INDEX IF NOT EXISTS "resume_change_set_resume_created_idx"
  ON "resume_change_set" ("resumeId", "createdAt");

CREATE INDEX IF NOT EXISTS "resume_change_set_run_idx"
  ON "resume_change_set" ("runId");

-- 决策表达「用户选择」，回执表达「实际应用」——两者必须分开记录，否则会把
-- 「用户批准了但 revision 冲突」写成「已批准并应用」。
CREATE TABLE IF NOT EXISTS "resume_decision" (
  "id" text PRIMARY KEY NOT NULL,
  "changeSetId" text NOT NULL REFERENCES "resume_change_set"("id") ON DELETE cascade,
  -- 绑定精确提案版本：批准不会自动延伸到重新生成后的版本。
  "proposalVersion" integer NOT NULL,
  "acceptedOperationIds" jsonb NOT NULL,
  "rejectedOperationIds" jsonb NOT NULL,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "resume_decision_changeset_version_idx"
  ON "resume_decision" ("changeSetId", "proposalVersion");

-- ─── 5. resume_version 新版元数据 ────────────────────────────

-- 旧记录保持原语义（提交前快照），不篡改；新字段可空，只有新版提交路径写入。
-- 新记录固定保存**提交后**的快照。
ALTER TABLE "resume_version" ADD COLUMN IF NOT EXISTS "revision" integer;
ALTER TABLE "resume_version" ADD COLUMN IF NOT EXISTS "fromRevision" integer;
ALTER TABLE "resume_version" ADD COLUMN IF NOT EXISTS "changeSetId" text;
ALTER TABLE "resume_version" ADD COLUMN IF NOT EXISTS "runId" text;
ALTER TABLE "resume_version" ADD COLUMN IF NOT EXISTS "sourceDetail" text;
ALTER TABLE "resume_version" ADD COLUMN IF NOT EXISTS "mutationId" text;

-- 每条修订号最多一个快照。部分唯一索引：旧记录 revision 为 NULL，不受影响
-- （Postgres 唯一索引不约束 NULL）。
CREATE UNIQUE INDEX IF NOT EXISTS "resume_version_resume_revision_idx"
  ON "resume_version" ("resumeId", "revision")
  WHERE "revision" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "resume_version_changeset_idx"
  ON "resume_version" ("changeSetId");
