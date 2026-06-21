ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "bannerImageUrl" text;--> statement-breakpoint
ALTER TABLE "templates" DROP COLUMN IF EXISTS "assets";--> statement-breakpoint
ALTER TABLE "templates" DROP COLUMN IF EXISTS "createdBy";
