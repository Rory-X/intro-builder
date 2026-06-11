CREATE TABLE "template_favorite" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"templateId" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "template_favorite" ADD CONSTRAINT "template_favorite_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "template_favorite_user_template_idx" ON "template_favorite" USING btree ("userId","templateId");--> statement-breakpoint
CREATE INDEX "template_favorite_user_idx" ON "template_favorite" USING btree ("userId");