import { tool } from "ai";
import { z } from "zod";

import type { ResumeOperation } from "../agent-tools.js";
import {
  draftSnapshot,
  setGoal,
  upsertSection,
  type DraftState,
} from "./draft.js";

/**
 * create-from-zero 的真 loop 工具集（AI SDK v6 `tool()`）。
 *
 * 读类工具自动执行、只读 draft；写类工具的 `execute` 只改 draft（绝不碰真简历），
 * 并把简明的观察结果回灌给模型。所有写入经由 {@link upsertSection}，因此天然产出
 * 与既有管线兼容的 `ResumeOperation` / `AgentToolCall`。
 */

const SECTION_VALUES = [
  "summary",
  "experience",
  "projects",
  "education",
  "skills",
  "research",
  "custom",
] as const satisfies readonly ResumeOperation["section"][];

const COMPLETENESS_TARGETS: Array<{
  key: ResumeOperation["section"];
  label: string;
}> = [
  { key: "summary", label: "个人简介" },
  { key: "experience", label: "工作经历" },
  { key: "education", label: "教育经历" },
  { key: "skills", label: "技能" },
];

export function computeCompleteness(draft: DraftState): {
  overall: number;
  present: string[];
  missing: string[];
} {
  const presentKeys = new Set(draft.sections.map((section) => section.key));
  const present = COMPLETENESS_TARGETS.filter((target) =>
    presentKeys.has(target.key),
  );
  const missing = COMPLETENESS_TARGETS.filter(
    (target) => !presentKeys.has(target.key),
  );
  const overall = Math.round((present.length / COMPLETENESS_TARGETS.length) * 100);
  return {
    overall,
    present: present.map((target) => target.label),
    missing: missing.map((target) => target.label),
  };
}

export function createLoopTools(draft: DraftState) {
  return {
    resume_read: tool({
      description:
        "读取当前草稿（draft）的标题、目标岗位、个人简介与各分区。从零创建时初始为空。",
      inputSchema: z.object({}),
      execute: async () => {
        const snapshot = draftSnapshot(draft);
        return {
          title: snapshot.title,
          targetRole: snapshot.targetRole,
          profileSummary: snapshot.profileSummary,
          sections: snapshot.sections,
        };
      },
    }),

    get_completeness: tool({
      description:
        "评估当前草稿的完整度，返回 0-100 的总分以及还缺哪些关键分区。据此决定下一步写什么或是否需要向用户要事实。",
      inputSchema: z.object({}),
      execute: async () => computeCompleteness(draft),
    }),

    set_goal: tool({
      description: "设置简历标题与目标岗位（不产生简历改动，只记录意图）。",
      inputSchema: z.object({
        title: z.string().optional(),
        targetRole: z.string().nullable().optional(),
      }),
      execute: async (input) => {
        setGoal(draft, input);
        return { ok: true, title: draft.title, targetRole: draft.targetRole };
      },
    }),

    upsert_section: tool({
      description: `写入或更新一个简历分区——只改草稿，不动真简历。fieldPath 必须是允许的目标之一：
- "basics.summary"（个人简介，section=summary）
- "skills"（技能，section=skills）
- "experience.<n>.content"（第 n 段工作经历，section=experience，n 从 0 开始）
- "projects.<n>.content"（section=projects）
- "education.<n>.highlights"（section=education）
- "research.<n>.content"（section=research）
- "custom.<n>.content"（section=custom）
afterPlainText 是该分区的正文，可用简单 Markdown。无凭据时不要编造经历——把缺失项交给完整度检查或在文末提示用户补充。`,
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
        const result = upsertSection(draft, { toolCallId, ...input });
        if (!result.ok) {
          return { ok: false as const, error: result.message };
        }
        return {
          ok: true as const,
          operation: result.operation.operation,
          section: result.operation.section,
          fieldPath: result.operation.fieldPath,
          changeSummary: result.operation.changeSummary,
        };
      },
    }),
  };
}

export type LoopTools = ReturnType<typeof createLoopTools>;
