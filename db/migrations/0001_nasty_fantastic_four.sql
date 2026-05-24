CREATE TABLE "templates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"thumbnail_url" text,
	"source" text NOT NULL,
	"decoration" jsonb,
	"layout" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
