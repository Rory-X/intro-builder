import { tool } from "ai";
import { z } from "zod";

import type { AgentToolCall, ResumeOperation } from "../agent-tools.js";
import { isAllowedOperationFieldPath } from "../agent-tools.js";
import {
  deleteFromDraft,
  draftSnapshot,
  reorderDraftSections,
  setGoal,
  upsertSection,
  type DraftState,
} from "./draft.js";

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

type ToolCallOptions = { toolCallId?: string };

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
  const overall = Math.round(
    (present.length / COMPLETENESS_TARGETS.length) * 100,
  );
  return {
    overall,
    present: present.map((target) => target.label),
    missing: missing.map((target) => target.label),
  };
}

export type PolishTextFn = (
  fieldPath: string,
  instruction?: string,
) => Promise<{
  plainText: string;
  tiptapJson: unknown;
  operationTemplate: Pick<
    ResumeOperation,
    "beforePlainText" | "afterPlainText"
  >;
}>;

export type SetTextFn = (
  fieldPath: string,
  plainText: string,
) => Promise<{
  tiptapJson: unknown;
}>;

export type LoopToolsFactoryOptions = {
  polishTextFn?: PolishTextFn;
  setTextFn?: SetTextFn;
  onAsk?: (question: string, field?: string) => void;
};

export function createLoopTools(
  draft: DraftState,
  options: LoopToolsFactoryOptions = {},
) {
  return {
    resume_read: tool({
      description:
        "读取当前草稿（draft）的全部内容或指定分区。必须先读再改。",
      inputSchema: z.object({
        sectionKey: z
          .enum(SECTION_VALUES)
          .optional()
          .describe("指定要读的分区 key；不传则返回全文"),
      }),
      execute: async (input) => {
        const snapshot = draftSnapshot(draft);
        if (input.sectionKey) {
          const matching = snapshot.sections.filter(
            (section) => section.key === input.sectionKey,
          );
          return { sectionKey: input.sectionKey, sections: matching };
        }
        return {
          title: snapshot.title,
          targetRole: snapshot.targetRole,
          profileSummary: snapshot.profileSummary,
          sections: snapshot.sections,
          missingFacts: snapshot.missingFacts,
        };
      },
    }),

    get_completeness: tool({
      description:
        "评估草稿完整度（0-100），返回缺失分区。用于自检下一步做什么。",
      inputSchema: z.object({}),
      execute: async () => computeCompleteness(draft),
    }),

    set_goal: tool({
      description:
        "设置/更新简历标题与目标岗位（不改简历内容，只记元信息）。",
      inputSchema: z.object({
        title: z.string().optional().describe("简历标题"),
        targetRole: z
          .string()
          .nullable()
          .optional()
          .describe("目标岗位，null 表示清除"),
      }),
      execute: async (input) => {
        setGoal(draft, input);
        return {
          ok: true,
          title: draft.title,
          targetRole: draft.targetRole,
        };
      },
    }),

    resume_update_section: tool({
      description: `替换草稿中指定 fieldPath 的内容。fieldPath 必须是允许的目标：
- "basics.summary"（个人简介，section=summary）
- "skills"（技能，section=skills）
- "experience.<n>.content"（第 n 段工作经历，n 从 0 开始）
- "projects.<n>.content"（项目经历）
- "education.<n>.highlights"（教育经历）
- "research.<n>.content"（研究经历）
- "custom.<n>.content"（自定义）

newContent 必须是 TipTap JSON（优先用 resume_set_text 或 resume_polish_text 生成）。
如果要改纯文本，先用 resume_set_text 转成 TipTap JSON。`,
      inputSchema: z.object({
        fieldPath: z.string().describe("目标字段路径"),
        newContent: z.any().describe("TipTap JSON 格式的新内容"),
        label: z.string().describe("操作标签"),
        changeSummary: z.string().optional(),
      }),
      execute: async (input, execOptions) => {
        const toolCallId =
          (execOptions as ToolCallOptions)?.toolCallId ??
          `tool_${Date.now()}`;
        const section = fieldPathToSection(input.fieldPath);
        const result = upsertSection(draft, {
          toolCallId,
          section,
          fieldPath: input.fieldPath,
          label: input.label,
          afterPlainText: extractPlainText(input.newContent),
          replacementTiptapJson: input.newContent,
          changeSummary: input.changeSummary,
        });
        if (!result.ok) return { ok: false as const, error: result.message };
        return {
          ok: true as const,
          operation: result.operation,
          fieldPath: result.operation.fieldPath,
          changeSummary: result.operation.changeSummary,
        };
      },
    }),

    resume_delete_section: tool({
      description:
        "从草稿中删除指定 fieldPath 的条目（不可逆，慎用）。",
      inputSchema: z.object({
        fieldPath: z.string().describe("要删除的 fieldPath"),
        label: z.string().optional(),
        changeSummary: z.string().optional(),
      }),
      execute: async (input, execOptions) => {
        const toolCallId =
          (execOptions as ToolCallOptions)?.toolCallId ??
          `tool_${Date.now()}`;
        const result = deleteFromDraft(draft, {
          toolCallId,
          section: fieldPathToSection(input.fieldPath),
          fieldPath: input.fieldPath,
          label: input.label,
          changeSummary: input.changeSummary,
        });
        if (!result.ok) return { ok: false as const, error: result.message };
        return { ok: true as const, operation: result.operation };
      },
    }),

    resume_reorder_sections: tool({
      description:
        "重排 resume sectionOrder 数组（改变预览中分区顺序）。",
      inputSchema: z.object({
        newOrder: z
          .array(z.string())
          .describe("新的分区 key 顺序"),
        changeSummary: z.string().optional(),
      }),
      execute: async (input, execOptions) => {
        const toolCallId =
          (execOptions as ToolCallOptions)?.toolCallId ??
          `tool_${Date.now()}`;
        const result = reorderDraftSections(draft, {
          toolCallId,
          newOrder: input.newOrder,
          changeSummary: input.changeSummary,
        });
        if (!result.ok) return { ok: false as const, error: result.message };
        return { ok: true as const, operation: result.operation };
      },
    }),

    resume_polish_text: tool({
      description: `润色指定 fieldPath 的文案（STAR 重写、量化改善、措辞优化）。
工具内部保证富文本结构不变（列表保持列表、加粗保持加粗），只改善文字表达。
可选 instruction 指定润色方向（如"更量化"/"更简洁"/"STAR法则"）。`,
      inputSchema: z.object({
        fieldPath: z.string().describe("目标字段路径"),
        instruction: z
          .string()
          .optional()
          .describe("润色方向，如：'更量化'/'更简洁'/'STAR法则'"),
        label: z.string().optional(),
      }),
      execute: async (input, execOptions) => {
        const toolCallId =
          (execOptions as ToolCallOptions)?.toolCallId ??
          `tool_${Date.now()}`;
        if (!options.polishTextFn) {
          return {
            ok: false as const,
            error: "polish text not available in this environment",
          };
        }
        const refined = await options.polishTextFn(
          input.fieldPath,
          input.instruction,
        );
        const label = input.label ?? "润色文案";
        const result = upsertSection(draft, {
          toolCallId,
          section: fieldPathToSection(input.fieldPath),
          fieldPath: input.fieldPath,
          label,
          afterPlainText: refined.plainText,
          replacementTiptapJson: refined.tiptapJson,
          changeSummary: `润色${label}`,
        });
        if (!result.ok) return { ok: false as const, error: result.message };
        return {
          ok: true as const,
          operation: result.operation,
          beforePlainText: refined.operationTemplate.beforePlainText,
          afterPlainText: refined.operationTemplate.afterPlainText,
        };
      },
    }),

    resume_set_text: tool({
      description: `将纯文本安全转换为 TipTap JSON 并写入 draft 指定 fieldPath。
用于模型想设置某字段的文案但不需要润色时。工具自动保持原字段的结构格式。`,
      inputSchema: z.object({
        fieldPath: z.string().describe("目标字段路径"),
        plainText: z.string().describe("纯文本内容"),
        label: z.string().optional(),
      }),
      execute: async (input, execOptions) => {
        const toolCallId =
          (execOptions as ToolCallOptions)?.toolCallId ??
          `tool_${Date.now()}`;
        if (!options.setTextFn) {
          return {
            ok: false as const,
            error: "set text not available in this environment",
          };
        }
        const converted = await options.setTextFn(
          input.fieldPath,
          input.plainText,
        );
        const label = input.label ?? "更新文案";
        const result = upsertSection(draft, {
          toolCallId,
          section: fieldPathToSection(input.fieldPath),
          fieldPath: input.fieldPath,
          label,
          afterPlainText: input.plainText,
          replacementTiptapJson: converted.tiptapJson,
          changeSummary: `更新${label}`,
        });
        if (!result.ok) return { ok: false as const, error: result.message };
        return { ok: true as const, operation: result.operation };
      },
    }),

    resume_ask: tool({
      description:
        "当没有足够信息继续工作时调用此工具向用户追问。触发后 loop 停止，前端弹出问题卡片。",
      inputSchema: z.object({
        question: z.string().describe("向用户提出的问题"),
        field: z
          .string()
          .optional()
          .describe("关联字段，如 experience.0.company"),
      }),
      execute: async (input) => {
        options.onAsk?.(input.question, input.field);
        return {
          asked: true,
          question: input.question,
          field: input.field ?? null,
        };
      },
    }),
  };
}

export type LoopTools = ReturnType<typeof createLoopTools>;

function fieldPathToSection(fieldPath: string): ResumeOperation["section"] {
  if (fieldPath === "basics.summary") return "summary";
  if (fieldPath === "skills") return "skills";
  if (fieldPath.startsWith("experience.")) return "experience";
  if (fieldPath.startsWith("projects.")) return "projects";
  if (fieldPath.startsWith("education.")) return "education";
  if (fieldPath.startsWith("research.")) return "research";
  if (fieldPath.startsWith("custom.")) return "custom";
  return "summary";
}

function extractPlainText(tiptapJson: unknown): string {
  if (!tiptapJson || typeof tiptapJson !== "object") return "";
  const doc = tiptapJson as Record<string, unknown>;
  if (!Array.isArray(doc.content)) return "";
  const texts: string[] = [];
  for (const node of doc.content) {
    if (!node || typeof node !== "object") continue;
    const n = node as Record<string, unknown>;
    readParagraphs(texts, n);
    readBulletList(texts, n);
    readOrderedList(texts, n);
  }
  return texts.join("\n");
}

function readParagraphs(
  texts: string[],
  node: Record<string, unknown>,
): void {
  if (node.type !== "paragraph" || !Array.isArray(node.content)) return;
  for (const child of node.content) {
    if (
      child &&
      typeof child === "object" &&
      (child as Record<string, unknown>).type === "text"
    ) {
      texts.push(String((child as Record<string, unknown>).text ?? ""));
    }
  }
}

function readBulletList(
  texts: string[],
  node: Record<string, unknown>,
): void {
  if (node.type !== "bulletList" || !Array.isArray(node.content)) return;
  for (const item of node.content) {
    if (!item || typeof item !== "object") continue;
    const li = item as Record<string, unknown>;
    if (li.type === "listItem" && Array.isArray(li.content)) {
      for (const para of li.content) {
        if (
          para &&
          typeof para === "object" &&
          (para as Record<string, unknown>).type === "paragraph"
        ) {
          const p = para as Record<string, unknown>;
          if (Array.isArray(p.content)) {
            for (const child of p.content) {
              if (
                child &&
                typeof child === "object" &&
                (child as Record<string, unknown>).type === "text"
              ) {
                texts.push(
                  `- ${String((child as Record<string, unknown>).text ?? "")}`,
                );
              }
            }
          }
        }
      }
    }
  }
}

function readOrderedList(
  texts: string[],
  node: Record<string, unknown>,
): void {
  if (node.type !== "orderedList" || !Array.isArray(node.content)) return;
  let idx = 1;
  for (const item of node.content) {
    if (!item || typeof item !== "object") continue;
    const li = item as Record<string, unknown>;
    if (li.type === "listItem" && Array.isArray(li.content)) {
      for (const para of li.content) {
        if (
          para &&
          typeof para === "object" &&
          (para as Record<string, unknown>).type === "paragraph"
        ) {
          const p = para as Record<string, unknown>;
          if (Array.isArray(p.content)) {
            for (const child of p.content) {
              if (
                child &&
                typeof child === "object" &&
                (child as Record<string, unknown>).type === "text"
              ) {
                texts.push(
                  `${idx}. ${String((child as Record<string, unknown>).text ?? "")}`,
                );
              }
            }
          }
        }
      }
    }
    idx += 1;
  }
}
