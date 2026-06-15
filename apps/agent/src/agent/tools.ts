import { tool } from "ai";
import { z } from "zod";

import type { ResumeOperation } from "../agent-tools.js";
import { applyWrite, setPreviewGoal, type PreviewState } from "./preview.js";

/**
 * AI SDK tool set for the agent chat loop.
 *
 * - `read_resume` reads the user's REAL resume (read-only, via an injected port
 *   scoped to the authenticated user) so the model reasons from real data.
 * - `set_goal` / `upsert_section` mutate only the in-memory {@link PreviewState}.
 * - `ask_user` has NO `execute`: it is a human-in-the-loop tool resolved by the
 *   user on the web side (the "ask panel"), then fed back via addToolResult.
 */

export type ResumeReader = () => Promise<{
  title: string;
  content: unknown;
} | null>;

const SECTION_VALUES = [
  "summary",
  "experience",
  "projects",
  "education",
  "skills",
  "research",
  "custom",
] as const satisfies readonly ResumeOperation["section"][];

export type CreateAgentToolsDeps = {
  preview: PreviewState;
  readResume: ResumeReader;
};

export function createAgentTools({ preview, readResume }: CreateAgentToolsDeps) {
  return {
    read_resume: tool({
      description:
        "读取用户当前的真实简历（只读）。返回标题与内容，用来理解已有信息；不要凭空编造未提供的经历。",
      inputSchema: z.object({}),
      execute: async () => {
        const resume = await readResume();
        if (!resume) return { exists: false as const };
        return {
          exists: true as const,
          title: resume.title,
          content: resume.content,
        };
      },
    }),

    set_goal: tool({
      description: "设置简历标题与目标岗位（只记录意图，不改简历）。",
      inputSchema: z.object({
        title: z.string().optional(),
        targetRole: z.string().nullable().optional(),
      }),
      execute: async (input) => {
        setPreviewGoal(preview, input);
        return { ok: true, title: preview.title, targetRole: preview.targetRole };
      },
    }),

    upsert_section: tool({
      description: `写入或更新一个简历分区——只改预览（preview），不动真实简历。fieldPath 必须是允许目标之一：
- "basics.summary"（个人简介，section=summary）
- "skills"（技能，section=skills）
- "experience.<n>.content" / "projects.<n>.content" / "education.<n>.highlights" / "research.<n>.content" / "custom.<n>.content"（n 从 0 起）
无凭据不要编造；缺关键信息时用 ask_user 询问，或把 status 设为 needs_user_fact。`,
      inputSchema: z.object({
        section: z.enum(SECTION_VALUES),
        fieldPath: z.string(),
        label: z.string(),
        afterPlainText: z.string(),
        changeSummary: z.string().optional(),
        status: z.enum(["drafted", "needs_user_fact"]).optional(),
      }),
      execute: async (input, options) => {
        const toolCallId =
          (options as { toolCallId?: string } | undefined)?.toolCallId ?? "";
        const result = applyWrite(preview, { toolCallId, ...input });
        if (!result.ok) return { ok: false as const, error: result.message };
        return {
          ok: true as const,
          operation: result.operation.operation,
          fieldPath: result.operation.fieldPath,
          changeSummary: result.operation.changeSummary,
        };
      },
    }),

    ask_user: tool({
      description:
        "当信息不足、需要用户补充关键事实时调用（例如缺少公司名、时间、量化结果）。用于具体且必要的问题，不要用来闲聊。调用后前端会弹出 ask 面板让用户回答。",
      inputSchema: z.object({
        question: z.string(),
        field: z.string().optional(),
        options: z.array(z.string()).optional(),
      }),
      // No execute on purpose: resolved by the user (human-in-the-loop).
    }),
  };
}

export type AgentTools = ReturnType<typeof createAgentTools>;
