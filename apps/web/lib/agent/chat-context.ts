import { getSectionMeta } from "@/lib/section-meta";
import type { ResumeContent } from "@/lib/resume-schema";
import { tiptapPlainText } from "@/lib/agent/resume-helper-context";
import type { AgentResumeContext } from "@/lib/agent/agent-message-contract";

const MAX_TOTAL_CONTEXT_CHARS = 12_000;
const MAX_SECTION_CHARS = 4_000;

export type BuildAgentResumeContextInput = {
  content: ResumeContent;
  templateId: string;
  activeSection: string | null;
  completeness: AgentResumeContext["completeness"];
};

export function buildAgentResumeContext({
  content,
  templateId,
  activeSection,
  completeness,
}: BuildAgentResumeContextInput): AgentResumeContext {
  const rawSections = [
    textSection(
      "summary",
      getSectionMeta("summary").label,
      "basics.summary",
      content.basics.summary ?? "",
    ),
    ...content.experience.map((item, index) =>
      textSection(
        "experience",
        `${getSectionMeta("experience").label} ${index + 1}`,
        `experience.${index}.content`,
        tiptapPlainText(item.content),
      ),
    ),
    ...content.projects.map((item, index) =>
      textSection(
        "projects",
        `${getSectionMeta("projects").label} ${index + 1}`,
        `projects.${index}.content`,
        tiptapPlainText(item.content),
      ),
    ),
    ...content.education.map((item, index) =>
      textSection(
        "education",
        `${getSectionMeta("education").label} ${index + 1}`,
        `education.${index}.highlights`,
        tiptapPlainText(item.highlights),
      ),
    ),
    ...content.research.map((item, index) =>
      textSection(
        "research",
        `${getSectionMeta("research").label} ${index + 1}`,
        `research.${index}.content`,
        tiptapPlainText(item.content),
      ),
    ),
    textSection(
      "skills",
      getSectionMeta("skills").label,
      "skills",
      tiptapPlainText(content.skills),
    ),
    ...content.custom.map((item, index) =>
      textSection(
        "custom",
        item.title || getSectionMeta(item.id).label,
        `custom.${index}.content`,
        tiptapPlainText(item.content),
      ),
    ),
  ].filter((item) => item.plainText !== "");

  let remaining = MAX_TOTAL_CONTEXT_CHARS;
  const sections: AgentResumeContext["sections"] = [];
  for (const item of rawSections) {
    if (remaining <= 0) break;
    const plainText = item.plainText.slice(
      0,
      Math.min(MAX_SECTION_CHARS, remaining),
    );
    remaining -= plainText.length;
    sections.push({ ...item, plainText });
  }

  return {
    resumeTitle: content.basics.title?.trim() || "未填写目标岗位",
    templateId,
    activeSection,
    completeness,
    sections,
  };
}

function textSection(
  key: AgentResumeContext["sections"][number]["key"],
  label: string,
  fieldPath: string,
  plainText: string,
): AgentResumeContext["sections"][number] {
  return {
    key,
    label,
    fieldPath,
    plainText: plainText.trim(),
  };
}
