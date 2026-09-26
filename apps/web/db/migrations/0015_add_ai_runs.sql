-- P04：Next.js 统一 Run、工具与恢复
--
-- 全部为 additive 变更。旧 agent_session / agent_session_event 表保持只读不动
-- （首期不做破坏性删除，也不伪造缺失历史）。
--
-- 关键约束：
--   ai_run              —— 一个用户任务；绑定 user/resume/session；lease + fencing
--   ai_tool_execution   —— 工具账本；完成结果必须在下一步模型调用前持久化
--   ai_run_event        —— 按 Run 排序的展示日志；sequence 由数据库分配
--   resume_mutation_event 是文档提交的可靠源；ai_run_event 是它的去重投影

-- ─── 1. Run ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "ai_run" (
  "id" text PRIMARY KEY NOT NULL,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "resumeId" text NOT NULL REFERENCES "resume"("id") ON DELETE cascade,
  -- 复用现有 floating 会话表作为聊天历史，这里只保留关联。
  "sessionId" text,
  -- 客户端幂等键：重复的 start 请求复用同一个 Run，不二次调用模型。
  "requestId" text NOT NULL,
  "status" text NOT NULL DEFAULT 'running',
  "mode" text NOT NULL DEFAULT 'optimize_existing',
  -- 写入授权模式（direct / approval）。模型不能修改它。
  "writeMode" text NOT NULL DEFAULT 'direct',
  -- 同一简历同一时刻只允许一个写 Run：lease + 递增 fencing token。
  "leaseOwner" text,
  "leaseExpiresAt" timestamp,
  "fenceToken" integer NOT NULL DEFAULT 0,
  -- 取消：写共享状态；模型 AbortSignal 只是省资源，数据库 fence 才是拦阻晚到提交的保障。
  "cancelRequestedAt" timestamp,
  -- 有界执行预算与进度。
  "deadlineAt" timestamp,
  "startedAt" timestamp DEFAULT now() NOT NULL,
  "finishedAt" timestamp,
  -- 检查点：结构化模型消息与步骤进度（不含凭据）。
  "checkpointVersion" integer NOT NULL DEFAULT 0,
  "checkpoint" jsonb,
  "promptVersion" text,
  "modelId" text,
  "usage" jsonb,
  -- 失败后重试/重新生成创建新 Run，关联 parentRunId。
  "parentRunId" text,
  "lastError" text,
  -- 事件序号分配器。用 UPDATE ... SET x = x + 1 RETURNING x 原子取号：
  -- 行级锁 + 重新读取能真正串行化，而 CTE 里的 MAX() 取的是语句快照，并发下会撞号。
  "eventSequence" integer NOT NULL DEFAULT 0,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "ai_run_status_check" CHECK (
    "status" IN ('running', 'waiting_user', 'completed', 'failed', 'cancelled', 'interrupted')
  ),
  CONSTRAINT "ai_run_write_mode_check" CHECK ("writeMode" IN ('direct', 'approval'))
);

-- 客户端幂等：同一用户同一 requestId 只能有一个 Run。
CREATE UNIQUE INDEX IF NOT EXISTS "ai_run_user_request_id_idx"
  ON "ai_run" ("userId", "requestId");

CREATE INDEX IF NOT EXISTS "ai_run_resume_status_idx"
  ON "ai_run" ("resumeId", "status");

CREATE INDEX IF NOT EXISTS "ai_run_session_created_idx"
  ON "ai_run" ("sessionId", "createdAt");

-- 找「当前持有 lease 的活跃 Run」是热路径。
CREATE INDEX IF NOT EXISTS "ai_run_lease_idx"
  ON "ai_run" ("resumeId", "leaseExpiresAt")
  WHERE "leaseOwner" IS NOT NULL;

-- ─── 2. 工具账本 ─────────────────────────────────────────────

-- 首选独立表而不是把整份运行 JSON 覆盖当并发安全记录：
-- 恢复时按 (runId, attemptId, toolCallId) 精确查「这个工具到底执行过没有」。
CREATE TABLE IF NOT EXISTS "ai_tool_execution" (
  "id" text PRIMARY KEY NOT NULL,
  "runId" text NOT NULL REFERENCES "ai_run"("id") ON DELETE cascade,
  "attemptId" text NOT NULL,
  -- provider 给出的 toolCallId；重试不得重新生成。
  "toolCallId" text NOT NULL,
  "toolName" text NOT NULL,
  -- 参数哈希固定：同一次调用重试必须命中同一条记录。
  "inputHash" text NOT NULL,
  "status" text NOT NULL,
  "result" jsonb,
  -- 与文档提交的关联：提案与回执都可追溯。
  "proposalId" text,
  "mutationId" text,
  "changeSetId" text,
  "errorCode" text,
  "startedAt" timestamp DEFAULT now() NOT NULL,
  "finishedAt" timestamp,
  CONSTRAINT "ai_tool_execution_status_check" CHECK (
    "status" IN ('running', 'succeeded', 'failed', 'interrupted')
  )
);

-- 同一次尝试里的同一个 toolCallId 只能有一条账目。
CREATE UNIQUE INDEX IF NOT EXISTS "ai_tool_execution_attempt_call_idx"
  ON "ai_tool_execution" ("runId", "attemptId", "toolCallId");

CREATE INDEX IF NOT EXISTS "ai_tool_execution_run_idx"
  ON "ai_tool_execution" ("runId", "startedAt" DESC);

-- ─── 3. 运行事件日志 ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "ai_run_event" (
  "eventId" text PRIMARY KEY NOT NULL,
  "runId" text NOT NULL REFERENCES "ai_run"("id") ON DELETE cascade,
  "attemptId" text NOT NULL,
  -- sequence 在同 Run 内跨 attempts 单调递增，由数据库分配，
  -- 不用客户端数组长度或内存自增代替跨实例顺序。
  "sequence" integer NOT NULL,
  "type" text NOT NULL,
  "payload" jsonb NOT NULL,
  -- 若本条是 resume_mutation_event 的投影，记录源事件 id 以去重。
  "sourceEventId" text,
  "occurredAt" timestamp DEFAULT now() NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

-- 有序读取（UI 按 (runId, sequence) 去重）。
CREATE UNIQUE INDEX IF NOT EXISTS "ai_run_event_run_sequence_idx"
  ON "ai_run_event" ("runId", "sequence");

-- outbox 投影去重：同一个源事件只投影一次。
CREATE UNIQUE INDEX IF NOT EXISTS "ai_run_event_source_event_idx"
  ON "ai_run_event" ("sourceEventId")
  WHERE "sourceEventId" IS NOT NULL;

-- ─── 4. 聊天历史格式版本 ─────────────────────────────────────

-- 复用现有 floating 表；新增格式版本与 Run 关联，兼容旧 parts。
ALTER TABLE "agent_floating_chat_session"
  ADD COLUMN IF NOT EXISTS "formatVersion" integer NOT NULL DEFAULT 1;

ALTER TABLE "agent_floating_chat_message"
  ADD COLUMN IF NOT EXISTS "formatVersion" integer NOT NULL DEFAULT 1;
ALTER TABLE "agent_floating_chat_message"
  ADD COLUMN IF NOT EXISTS "runId" text;
