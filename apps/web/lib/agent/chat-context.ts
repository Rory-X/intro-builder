import { getSectionMeta } from "@/lib/section-meta";
import {
  DEFAULT_STYLE_SETTINGS,
  type ResumeContent,
} from "@intro-builder/shared/schemas";
import { tiptapPlainText } from "@/lib/agent/resume-helper-context";
import type { AgentResumeContext } from "@intro-builder/shared/types";

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
    blockSection("basics", "基本信息", "basics", [
      ["姓名", content.basics.name],
      ["求职状态", content.basics.status],
      ["目标岗位", content.basics.title],
      ["邮箱", content.basics.email],
      ["电话", content.basics.phone],
      ["所在地", content.basics.location],
      ["个人链接", content.basics.website],
      ["个人简介", content.basics.summary],
      ["头像", content.basics.photo],
    ]),
    ...content.experience.map((item, index) =>
      blockSection(
        "experience",
        `${getSectionMeta("experience").label} ${index + 1}`,
        `experience.${index}`,
        [
          ["公司", item.company],
          ["职位", item.title],
          ["开始时间", item.start],
          ["结束时间", item.end],
          ["地点", item.location],
          ["内容", tiptapPlainText(item.content)],
        ],
      ),
    ),
    ...content.projects.map((item, index) =>
      blockSection(
        "projects",
        `${getSectionMeta("projects").label} ${index + 1}`,
        `projects.${index}`,
        [
          ["项目", item.name],
          ["角色", item.role],
          ["地点", item.location],
          ["开始时间", item.start],
          ["结束时间", item.end],
          ["技术栈", item.stack],
          ["链接", item.link],
          ["内容", tiptapPlainText(item.content)],
        ],
      ),
    ),
    ...content.education.map((item, index) =>
      blockSection(
        "education",
        `教育经历 ${index + 1}`,
        `education.${index}`,
        [
          ["学校", item.school],
          ["学历", item.degree],
          ["专业", item.major],
          ["地点", item.location],
          ["开始时间", item.start],
          ["结束时间", item.end],
          ["GPA", item.gpa],
          ["亮点", tiptapPlainText(item.highlights)],
        ],
      ),
    ),
    ...content.research.map((item, index) =>
      blockSection(
        "research",
        `${getSectionMeta("research").label} ${index + 1}`,
        `research.${index}`,
        [
          ["研究", item.name],
          ["角色", item.role],
          ["地点", item.location],
          ["开始时间", item.start],
          ["结束时间", item.end],
          ["论文", item.paperTitle],
          ["链接", item.link],
          ["内容", tiptapPlainText(item.content)],
        ],
      ),
    ),
    textSection(
      "summary",
      getSectionMeta("summary").label,
      "summary",
      formatFieldValue(tiptapPlainText(content.summary)),
    ),
    textSection(
      "skills",
      getSectionMeta("skills").label,
      "skills",
      formatFieldValue(tiptapPlainText(content.skills)),
    ),
    textSection(
      "awards",
      getSectionMeta("awards").label,
      "awards",
      formatFieldValue(tiptapPlainText(content.awards)),
    ),
    textSection(
      "portfolio",
      getSectionMeta("portfolio").label,
      "portfolio",
      formatFieldValue(tiptapPlainText(content.portfolio)),
    ),
    ...content.custom.map((item) =>
      blockSection(
        "custom",
        item.title || getSectionMeta(item.id).label,
        `custom.${item.id}`,
        [
          ["标题", item.title],
          ["内容", tiptapPlainText(item.content)],
        ],
      ),
    ),
    styleSection(content),
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
    sectionOrder: [...content.sectionOrder],
    completeness,
    sections,
  };
}

function blockSection(
  key: AgentResumeContext["sections"][number]["key"],
  label: string,
  fieldPath: string,
  fields: Array<[string, unknown]>,
): AgentResumeContext["sections"][number] {
  return textSection(
    key,
    label,
    fieldPath,
    fields.map(([fieldLabel, value]) => `${fieldLabel}：${formatFieldValue(value)}`).join("\n"),
  );
}

function styleSection(content: ResumeContent): AgentResumeContext["sections"][number] {
  const styleSettings = { ...DEFAULT_STYLE_SETTINGS, ...(content.styleSettings ?? {}) };
  return blockSection("style", "排版样式", "styleSettings", [
    ["字体", styleSettings.fontFamily],
    ["正文字号", styleSettings.fontSize],
    ["行高", styleSettings.lineHeight],
    ["正文行高", styleSettings.bodyLineHeight],
    ["标题间距", styleSettings.headingGap],
    ["页边距", styleSettings.pagePadding],
    ["模块间距", styleSettings.sectionGap],
    ["条目间距", styleSettings.itemGap],
    ["头像缩放", styleSettings.photoScale],
  ]);
}

function formatFieldValue(value: unknown) {
  if (Array.isArray(value)) {
    const text = value.map((item) => String(item).trim()).filter(Boolean).join("、");
    return text || "未填写";
  }
  const text = String(value ?? "").trim();
  return text || "未填写";
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
