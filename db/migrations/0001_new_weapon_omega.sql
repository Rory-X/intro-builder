CREATE TABLE "collab_session" (
	"id" text PRIMARY KEY NOT NULL,
	"resumeId" text NOT NULL,
	"ownerId" text NOT NULL,
	"inviteToken" text NOT NULL,
	"mode" text DEFAULT 'edit' NOT NULL,
	"mentorName" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"expiresAt" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resume" ALTER COLUMN "templateId" SET DEFAULT 'professional';--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "passwordHash" text;--> statement-breakpoint
ALTER TABLE "collab_session" ADD CONSTRAINT "collab_session_resumeId_resume_id_fk" FOREIGN KEY ("resumeId") REFERENCES "public"."resume"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab_session" ADD CONSTRAINT "collab_session_ownerId_user_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "collab_session_token_idx" ON "collab_session" USING btree ("inviteToken");--> statement-breakpoint
CREATE INDEX "collab_session_resume_idx" ON "collab_session" USING btree ("resumeId");