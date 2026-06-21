ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "sectionIcons" jsonb;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'templates' AND column_name = 'layout'
  ) THEN
    EXECUTE 'UPDATE "templates" SET "sectionIcons" = COALESCE("layout" -> ''sectionIcons'', ''{}''::jsonb) WHERE "sectionIcons" IS NULL';
  ELSE
    UPDATE "templates" SET "sectionIcons" = '{}'::jsonb WHERE "sectionIcons" IS NULL;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "templates" DROP COLUMN IF EXISTS "layout";
