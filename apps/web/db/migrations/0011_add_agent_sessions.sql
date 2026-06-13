CREATE TABLE IF NOT EXISTS "agent_session" (
  "id" text PRIMARY KEY NOT NULL,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "resumeId" text REFERENCES "resume"("id") ON DELETE cascade,
  "mode" text DEFAULT 'optimize_existing' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "title" text NOT NULL,
  "stateJson" jsonb NOT NULL,
  "lastResumeContentHash" text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "agent_session_user_idx" ON "agent_session" ("userId");
CREATE INDEX IF NOT EXISTS "agent_session_resume_idx" ON "agent_session" ("resumeId");
CREATE INDEX IF NOT EXISTS "agent_session_status_idx" ON "agent_session" ("status");

CREATE TABLE IF NOT EXISTS "agent_session_event" (
  "id" text PRIMARY KEY NOT NULL,
  "sessionId" text NOT NULL REFERENCES "agent_session"("id") ON DELETE cascade,
  "runId" text NOT NULL,
  "sequence" integer NOT NULL,
  "type" text NOT NULL,
  "payloadJson" jsonb NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "agent_session_event_session_idx" ON "agent_session_event" ("sessionId");
CREATE INDEX IF NOT EXISTS "agent_session_event_run_idx" ON "agent_session_event" ("runId");
CREATE UNIQUE INDEX IF NOT EXISTS "agent_session_event_run_sequence_idx"
  ON "agent_session_event" ("sessionId", "runId", "sequence");
