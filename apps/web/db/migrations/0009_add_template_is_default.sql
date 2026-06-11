ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "isDefault" boolean DEFAULT false NOT NULL;
