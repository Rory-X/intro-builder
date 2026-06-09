import { getSectionMeta } from "@/lib/section-meta";
import type { ResumeContent } from "@/lib/resume-schema";
import type { TipTapJSON } from "@/lib/tiptap-types";

const MAX_TOTAL_CONTEXT_CHARS = 12_000;
const MAX_SECTION_CHARS = 4_000;

export type ResumeHelperContextSnapshot = {
  resumeTitle: string;
  completeness: {
    overall: number;
    sections: Array<{ key: string; label: string; score: number; max: number }>;
  };
  sections: Array<{ key: string; label: string; plainText: string }>;
};

export function buildResumeHelperContext(
  content: ResumeContent,
  completeness: ResumeHelperContextSnapshot["completeness"],
): ResumeHelperContextSnapshot {
  const sections = [
    section("summary", getSectionMeta("summary").label, content.basics.summary ?? ""),
    ...content.experience.map((item, index) =>
      section("experience", `${getSectionMeta("experience").label} ${index + 1}`, tiptapPlainText(item.content)),
    ),
    ...content.education.map((item, index) =>
      section("education", `${getSectionMeta("education").label} ${index + 1}`, tiptapPlainText(item.highlights)),
    ),
    ...content.projects.map((item, index) =>
      section("projects", `${getSectionMeta("projects").label} ${index + 1}`, tiptapPlainText(item.content)),
    ),
    ...content.research.map((item, index) =>
      section("research", `${getSectionMeta("research").label} ${index + 1}`, tiptapPlainText(item.content)),
    ),
    section("skills", getSectionMeta("skills").label, tiptapPlainText(content.skills)),
    ...content.custom.map((item) =>
      section(item.id || "custom", item.title || getSectionMeta(item.id).label, tiptapPlainText(item.content)),
    ),
  ].filter((item) => item.plainText !== "");

  let remaining = MAX_TOTAL_CONTEXT_CHARS;
  const capped: ResumeHelperContextSnapshot["sections"] = [];
  for (const item of sections) {
    if (remaining <= 0) break;
    const text = item.plainText.slice(0, Math.min(MAX_SECTION_CHARS, remaining));
    remaining -= text.length;
    capped.push({ ...item, plainText: text });
  }

  return {
    resumeTitle: content.basics.title?.trim() || "未填写目标岗位",
    completeness,
    sections: capped,
  };
}

export function tiptapPlainText(doc: TipTapJSON | undefined): string {
  if (!doc) return "";
  return nodeText(doc).replace(/\s+/g, " ").trim();
}

function section(key: string, label: string, plainText: string) {
  return { key, label, plainText: plainText.trim() };
}

function nodeText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const record = node as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  if (!Array.isArray(record.content)) return "";
  return record.content.map(nodeText).filter(Boolean).join(" ");
}
