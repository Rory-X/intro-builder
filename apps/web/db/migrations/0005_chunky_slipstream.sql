DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'templates' AND column_name = 'source'
  ) THEN
    ALTER TABLE "templates" ALTER COLUMN "source" DROP NOT NULL;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'templates' AND column_name = 'layout'
  ) THEN
    ALTER TABLE "templates" ALTER COLUMN "layout" DROP NOT NULL;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "html" text;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "css" text;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "assets" jsonb;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "templateLayout" jsonb;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "defaultStyleSettings" jsonb;
