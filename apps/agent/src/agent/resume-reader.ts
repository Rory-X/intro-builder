import { and, eq } from "drizzle-orm";

import { db as defaultDb, type AgentDb } from "../db/index.js";
import { resumes } from "../db/schema.js";
import type { ResumeReader } from "./tools.js";

/**
 * Read-only resume reader for the `read_resume` tool. Scopes every read to the
 * authenticated user + resume from the agent JWT (SELECT only). The agent never
 * writes the `resume` table.
 */
export function createDrizzleResumeReader(
  args: { userId: string; resumeId: string | null },
  database: AgentDb = defaultDb,
): ResumeReader {
  return async () => {
    if (!args.resumeId) return null;
    const rows = await database
      .select({ title: resumes.title, content: resumes.content })
      .from(resumes)
      .where(and(eq(resumes.id, args.resumeId), eq(resumes.userId, args.userId)))
      .limit(1);
    const row = rows[0];
    return row ? { title: row.title, content: row.content } : null;
  };
}
