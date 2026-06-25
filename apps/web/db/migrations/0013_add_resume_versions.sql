CREATE TABLE IF NOT EXISTS "resume_version" (
  "id" text PRIMARY KEY NOT NULL,
  "resumeId" text NOT NULL REFERENCES "resume"("id") ON DELETE cascade,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "title" text NOT NULL,
  "templateId" text NOT NULL,
  "content" jsonb NOT NULL,
  "source" text NOT NULL,
  "actorName" text NOT NULL,
  "operationCount" integer NOT NULL DEFAULT 1,
  "summary" text,
  "parentVersionId" text,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "resume_version_resume_created_idx"
  ON "resume_version" ("resumeId", "createdAt");

CREATE INDEX IF NOT EXISTS "resume_version_user_idx"
  ON "resume_version" ("userId");
