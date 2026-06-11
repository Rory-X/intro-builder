ALTER TABLE "templates" ALTER COLUMN "source" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ALTER COLUMN "layout" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "html" text;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "css" text;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "assets" jsonb;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "templateLayout" jsonb;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "defaultStyleSettings" jsonb;