import { tool } from "ai";
import { z } from "zod";

import type { AgentMessageRequest } from "../agent-messages.js";
import type { AgentToolCall, ResumeOperation } from "../agent-tools.js";
import { isAllowedOperationFieldPath } from "../agent-tools.js";
import {
  deleteFromDraft,
  draftSnapshot,
  plainTextToTipTapDoc,
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

export class ResumeAskInterrupt extends Error {
  readonly question: string;
  readonly field?: string;

  constructor(question: string, field?: string) {
    super("resume_ask interrupt");
    this.name = "ResumeAskInterrupt";
    this.question = question;
    this.field = field;
  }
}

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
  stopOnAsk?: boolean;
  resumeContext?: AgentMessageRequest["context"];
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
      execute: async (input, execOptions) => {
        const snapshot = draftSnapshot(draft);
        const result = input.sectionKey
          ? {
              sectionKey: input.sectionKey,
              sections: snapshot.sections.filter(
                (section) => section.key === input.sectionKey,
              ),
            }
          : {
              title: snapshot.title,
              targetRole: snapshot.targetRole,
              profileSummary: snapshot.profileSummary,
              sections: snapshot.sections,
              missingFacts: snapshot.missingFacts,
            };
        recordReadToolCall(draft, {
          toolCallId: toolCallIdFrom(execOptions, "read"),
          name: "resume_read",
          title: "读取简历",
          summary: input.sectionKey
            ? `读取 ${input.sectionKey} 分区。`
            : "读取当前草稿全文。",
          input,
          result,
        });
        return result;
      },
    }),

    get_completeness: tool({
      description:
        "评估草稿完整度（0-100），返回缺失分区。用于自检下一步做什么。",
      inputSchema: z.object({}),
      execute: async (input, execOptions) => {
        const result = computeCompleteness(draft);
        recordReadToolCall(draft, {
          toolCallId: toolCallIdFrom(execOptions, "completeness"),
          name: "get_completeness",
          title: "检查完整度",
          summary: `当前完整度 ${result.overall}%。`,
          input,
          result,
        });
        return result;
      },
    }),

    role_match_read: tool({
      description:
        "读取目标岗位与当前简历/草稿的关键词匹配缺口。只读，不写 draft。",
      inputSchema: z.object({
        targetRole: z.string().optional(),
        keywords: z.array(z.string()).optional(),
      }),
      execute: async (input, execOptions) => {
        const targetRole =
          input.targetRole?.trim() || draft.targetRole || null;
        const text = corpusText(draft, options.resumeContext);
        const keywords = normalizeKeywords(input.keywords ?? inferRoleKeywords(targetRole));
        const matchedKeywords = keywords.filter((keyword) =>
          textIncludesKeyword(text, keyword),
        );
        const missingKeywords = keywords.filter(
          (keyword) => !matchedKeywords.includes(keyword),
        );
        const result = {
          targetRole,
          matchedKeywords,
          missingKeywords,
          gaps: missingKeywords.map((keyword) => ({
            keyword,
            message: `简历中暂未看到「${keyword}」的明确证据。`,
          })),
        };
        recordReadToolCall(draft, {
          toolCallId: toolCallIdFrom(execOptions, "role_match"),
          name: "role_match_read",
          title: "岗位匹配",
          summary:
            missingKeywords.length > 0
              ? `缺少 ${missingKeywords.length} 个目标关键词。`
              : "目标关键词匹配良好。",
          input,
          result,
        });
        return result;
      },
    }),

    ats_check: tool({
      description:
        "检查 ATS 关键词覆盖、段落结构和可解析性。只读，不写 draft。",
      inputSchema: z.object({
        keywords: z.array(z.string()).optional(),
      }),
      execute: async (input, execOptions) => {
        const text = corpusText(draft, options.resumeContext);
        const keywords = normalizeKeywords(input.keywords ?? []);
        const missingKeywords = keywords.filter(
          (keyword) => !textIncludesKeyword(text, keyword),
        );
        const risks = [
          ...missingKeywords.map((keyword) => ({
            code: "missing_keyword",
            message: `缺少目标关键词「${keyword}」。`,
          })),
          ...(text.length < 80
            ? [
                {
                  code: "weak_structure",
                  message: "当前可读文本偏短，ATS 难以识别完整经历结构。",
                },
              ]
            : []),
        ];
        const result = {
          score: clampScore(100 - missingKeywords.length * 18 - (text.length < 80 ? 20 : 0)),
          missingKeywords,
          risks,
        };
        recordReadToolCall(draft, {
          toolCallId: toolCallIdFrom(execOptions, "ats"),
          name: "ats_check",
          title: "ATS 检查",
          summary:
            risks.length > 0
              ? `发现 ${risks.length} 个 ATS 风险。`
              : "ATS 关键词和结构风险较低。",
          input,
          result,
        });
        return result;
      },
    }),

    content_claim_audit: tool({
      description:
        "检查疑似编造、无证据数字、过强表述。只读，不写 draft。",
      inputSchema: z.object({}),
      execute: async (input, execOptions) => {
        const claims = draft.operations
          .map((operation) => operation.afterPlainText)
          .filter(Boolean);
        const text = claims.join("\n") || corpusText(draft, options.resumeContext);
        const metricMatches = text.match(/(?:\d+(?:\.\d+)?%|\d+\s*(?:倍|万|千|人|次|ms|秒|分钟|小时))/g) ?? [];
        const risks = metricMatches.map((metric) => ({
          code: "possible_fabrication",
          message: `发现结果指标「${metric}」，需要用户确认真实来源。`,
        }));
        const result = {
          checkedClaimCount: metricMatches.length,
          risks,
          summary:
            risks.length > 0
              ? "发现需要事实确认的量化表述。"
              : "未发现明显无证据量化表述。",
        };
        recordReadToolCall(draft, {
          toolCallId: toolCallIdFrom(execOptions, "claim_audit"),
          name: "content_claim_audit",
          title: "事实自检",
          summary: result.summary,
          input,
          result,
        });
        return result;
      },
    }),

    layout_fit_check: tool({
      description:
        "根据当前 draft 文本密度估算版式溢出风险。只读，不写 draft。",
      inputSchema: z.object({
        maxCharacters: z.number().int().positive().optional(),
      }),
      execute: async (input, execOptions) => {
        const text = corpusText(draft, options.resumeContext);
        const maxCharacters = input.maxCharacters ?? 1800;
        const ratio = maxCharacters > 0 ? text.length / maxCharacters : 0;
        const riskLevel =
          ratio >= 1 ? "high" : ratio >= 0.8 ? "medium" : "low";
        const risks =
          riskLevel === "low"
            ? []
            : [
                {
                  code: "content_overflow",
                  message: `当前内容约 ${text.length} 字，接近或超过本轮阈值 ${maxCharacters} 字。`,
                },
              ];
        const result = {
          characterCount: text.length,
          maxCharacters,
          riskLevel,
          risks,
        };
        recordReadToolCall(draft, {
          toolCallId: toolCallIdFrom(execOptions, "layout"),
          name: "layout_fit_check",
          title: "版式检查",
          summary:
            riskLevel === "low"
              ? "当前内容密度风险较低。"
              : `当前内容密度为 ${riskLevel} 风险。`,
          input,
          result,
        });
        return result;
      },
    }),

    section_quality_score: tool({
      description:
        "对指定 section 的结构、可信度、具体性打分。只读，不写 draft。",
      inputSchema: z.object({
        sectionKey: z.enum(SECTION_VALUES).optional(),
      }),
      execute: async (input, execOptions) => {
        const sectionKey = input.sectionKey;
        const sectionText = sectionCorpusText(
          draft,
          options.resumeContext,
          sectionKey,
        );
        const specificity = scoreSpecificity(sectionText);
        const credibility = scoreCredibility(sectionText);
        const structure = scoreStructure(sectionText);
        const overall = Math.round((specificity + credibility + structure) / 3);
        const result = {
          sectionKey: sectionKey ?? "all",
          overall,
          dimensions: {
            specificity,
            credibility,
            structure,
          },
          suggestions: qualitySuggestions({ specificity, credibility, structure }),
        };
        recordReadToolCall(draft, {
          toolCallId: toolCallIdFrom(execOptions, "quality"),
          name: "section_quality_score",
          title: "分区评分",
          summary: `当前分区质量评分 ${overall}。`,
          input,
          result,
        });
        return result;
      },
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
      execute: async (input, execOptions) => {
        setGoal(draft, input);
        const result = {
          ok: true,
          title: draft.title,
          targetRole: draft.targetRole,
        };
        recordReadToolCall(draft, {
          toolCallId: toolCallIdFrom(execOptions, "goal"),
          name: "set_goal",
          title: "设置目标",
          summary: draft.targetRole
            ? `目标岗位：${draft.targetRole}`
            : "已更新简历目标。",
          input,
          result,
        });
        return result;
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
        const converted = options.setTextFn
          ? await options.setTextFn(input.fieldPath, input.plainText)
          : { tiptapJson: plainTextToTipTapDoc(input.plainText) };
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
        if (options.stopOnAsk) {
          throw new ResumeAskInterrupt(input.question, input.field);
        }
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

function toolCallIdFrom(execOptions: unknown, fallback: string): string {
  return (
    (execOptions as ToolCallOptions | undefined)?.toolCallId?.trim() ||
    `tool_${fallback}_${Date.now()}`
  );
}

function recordReadToolCall(
  draft: DraftState,
  input: {
    toolCallId: string;
    name: AgentToolCall["name"];
    title: string;
    summary: string;
    input: Record<string, unknown>;
    result: Record<string, unknown>;
  },
): void {
  draft.toolCalls.push({
    id: input.toolCallId,
    name: input.name,
    status: "completed",
    title: input.title,
    summary: input.summary,
    input: input.input,
    result: input.result,
  });
}

function corpusText(
  draft: DraftState,
  context: AgentMessageRequest["context"] | undefined,
): string {
  return [
    draft.profileSummary,
    ...draft.sections.map((section) => section.summary),
    ...draft.operations.map((operation) => operation.afterPlainText),
    ...(context?.sections.map((section) => section.plainText) ?? []),
  ]
    .filter(Boolean)
    .join("\n");
}

function sectionCorpusText(
  draft: DraftState,
  context: AgentMessageRequest["context"] | undefined,
  sectionKey: ResumeOperation["section"] | undefined,
): string {
  if (!sectionKey) return corpusText(draft, context);
  return [
    ...draft.sections
      .filter((section) => section.key === sectionKey)
      .map((section) => section.summary),
    ...draft.operations
      .filter((operation) => operation.section === sectionKey)
      .map((operation) => operation.afterPlainText),
    ...(context?.sections
      .filter((section) => section.key === sectionKey)
      .map((section) => section.plainText) ?? []),
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeKeywords(keywords: string[]): string[] {
  return [...new Set(keywords.map((keyword) => keyword.trim()).filter(Boolean))];
}

function inferRoleKeywords(targetRole: string | null): string[] {
  if (!targetRole) return [];
  if (/前端|frontend/i.test(targetRole)) return ["React", "TypeScript", "性能"];
  if (/后端|backend/i.test(targetRole)) return ["服务端", "数据库", "稳定性"];
  if (/产品/.test(targetRole)) return ["用户", "需求", "数据"];
  return [];
}

function textIncludesKeyword(text: string, keyword: string): boolean {
  return text.toLocaleLowerCase().includes(keyword.toLocaleLowerCase());
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreSpecificity(text: string): number {
  if (!text.trim()) return 0;
  if (/(?:\d+(?:\.\d+)?%|\d+\s*(?:倍|万|千|人|次|ms|秒|分钟|小时))/.test(text)) {
    return 85;
  }
  return text.length >= 40 ? 65 : 40;
}

function scoreCredibility(text: string): number {
  if (!text.trim()) return 0;
  return /(提升|增长|降低|节省|转化|留存).*(?:\d|%)/.test(text) ? 60 : 75;
}

function scoreStructure(text: string): number {
  if (!text.trim()) return 0;
  if (/[-*]\s+|^\d+\./m.test(text)) return 80;
  return /[，。；]/.test(text) && text.length >= 30 ? 70 : 45;
}

function qualitySuggestions(scores: {
  specificity: number;
  credibility: number;
  structure: number;
}): string[] {
  const suggestions: string[] = [];
  if (scores.specificity < 60) suggestions.push("补充更具体的任务、行动和结果证据。");
  if (scores.credibility < 70) suggestions.push("确认量化指标来源，避免无证据结果。");
  if (scores.structure < 60) suggestions.push("按 STAR 或项目背景-行动-结果重排表达。");
  return suggestions;
}
