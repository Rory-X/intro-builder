import { randomUUID } from "node:crypto";
import {
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { AgentSessionSnapshot } from "../agent-messages.js";

/**
 * Agent-local Drizzle schema. Only the tables the agent service actually
 * touches are declared here. Physical table names/columns mirror the web app's
 * schema (migrations 0000 + 0011) so both apps point at the same Postgres tables.
 *
 * `resume` is declared read-only here: agent tools SELECT resume content but
 * never write it — the real resume only changes on apply (web side).
 */

export const resumes = pgTable("resume", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull(),
  title: text("title").notNull(),
  content: jsonb("content").$type<unknown>().notNull(),
});

export const agentSessions = pgTable(
  "agent_session",
  {
    id: text("id").primaryKey(),
    userId: text("userId").notNull(),
    resumeId: text("resumeId"),
    mode: text("mode")
      .$type<AgentSessionSnapshot["mode"]>()
      .notNull()
      .default("optimize_existing"),
    status: text("status")
      .$type<AgentSessionSnapshot["status"]>()
      .notNull()
      .default("active"),
    title: text("title").notNull(),
    stateJson: jsonb("stateJson").$type<AgentSessionSnapshot>().notNull(),
    lastResumeContentHash: text("lastResumeContentHash"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("agent_session_user_idx").on(t.userId),
    resumeIdx: index("agent_session_resume_idx").on(t.resumeId),
    statusIdx: index("agent_session_status_idx").on(t.status),
  }),
);

export const agentSessionEvents = pgTable(
  "agent_session_event",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    sessionId: text("sessionId")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    runId: text("runId").notNull(),
    sequence: integer("sequence").notNull(),
    type: text("type").notNull(),
    payloadJson: jsonb("payloadJson").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => ({
    sessionIdx: index("agent_session_event_session_idx").on(t.sessionId),
    runIdx: index("agent_session_event_run_idx").on(t.runId),
    uniqueRunSequenceIdx: uniqueIndex("agent_session_event_run_sequence_idx").on(
      t.sessionId,
      t.runId,
      t.sequence,
    ),
  }),
);
