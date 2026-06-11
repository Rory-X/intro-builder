CREATE TABLE "templates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"thumbnailUrl" text,
	"source" text NOT NULL,
	"decoration" jsonb,
	"layout" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"createdBy" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
