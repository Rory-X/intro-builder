CREATE TABLE IF NOT EXISTS "agent_floating_chat_session" (
  "id" text PRIMARY KEY NOT NULL,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "resumeId" text NOT NULL REFERENCES "resume"("id") ON DELETE cascade,
  "title" text DEFAULT '新对话' NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "agent_floating_chat_session_user_resume_idx"
  ON "agent_floating_chat_session" ("userId", "resumeId");

CREATE INDEX IF NOT EXISTS "agent_floating_chat_session_updated_at_idx"
  ON "agent_floating_chat_session" ("updatedAt");

CREATE TABLE IF NOT EXISTS "agent_floating_chat_message" (
  "id" text PRIMARY KEY NOT NULL,
  "sessionId" text NOT NULL REFERENCES "agent_floating_chat_session"("id") ON DELETE cascade,
  "role" text NOT NULL,
  "content" text NOT NULL,
  "parts" jsonb,
  "toolCalls" jsonb,
  "operations" jsonb,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "agent_floating_chat_message"
  ADD COLUMN IF NOT EXISTS "parts" jsonb;

CREATE INDEX IF NOT EXISTS "agent_floating_chat_message_session_created_at_idx"
  ON "agent_floating_chat_message" ("sessionId", "createdAt");
