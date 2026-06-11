ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "sectionIcons" jsonb;--> statement-breakpoint
UPDATE templates SET "sectionIcons" = COALESCE(layout->'sectionIcons', '{}'::jsonb) WHERE "sectionIcons" IS NULL;
