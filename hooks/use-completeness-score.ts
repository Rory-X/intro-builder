"use client";

import { useMemo } from "react";
import { useWatch } from "react-hook-form";
import type { ResumeContent } from "@/lib/resume-schema";
import type { TipTapJSON } from "@/lib/tiptap-types";

export type SectionScore = {
  key: string;
  label: string;
  score: number;
  max: number;
};

export type CompletenessResult = {
  /** 0–100 integer */
  overall: number;
  sections: SectionScore[];
};

/** Base weights for built-in sections (before custom section adjustment) */
const BASE_WEIGHTS = {
  basics: 0.25,
  experience: 0.25,
  education: 0.2,
  projects: 0.15,
  skills: 0.15,
} as const;

/** Weight allocated to each custom section (built-in weights shrink proportionally) */
const CUSTOM_SECTION_WEIGHT = 0.05;

const SECTION_MAX = 10;

/** Known custom module labels (from MODULE_PRESETS / section-meta) */
const CUSTOM_MODULE_LABELS: Record<string, string> = {
  summary: "个人总结",
  awards: "荣誉奖项",
  research: "研究经历",
  portfolio: "作品集",
};

// ─── Helpers ─────────────────────────────────────────────

/** Check if a string field is meaningfully filled (not empty/placeholder) */
function isFilled(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  // Exclude known placeholders from emptyResumeContent()
  if (trimmed === "你的姓名" || trimmed === "目标岗位" || trimmed === "you@example.com") {
    return false;
  }
  return true;
}

/** Check if a TipTap JSON doc has actual text content */
function hasContent(doc: TipTapJSON | undefined): boolean {
  if (!doc || !doc.content || doc.content.length === 0) return false;
  // A single empty paragraph counts as empty
  if (
    doc.content.length === 1 &&
    doc.content[0].type === "paragraph" &&
    (!doc.content[0].content || doc.content[0].content.length === 0)
  ) {
    return false;
  }
  return true;
}

// ─── Section scorers ─────────────────────────────────────

function scoreBasics(basics: ResumeContent["basics"]): number {
  const requiredFields = ["name", "title", "email", "phone"] as const;
  const optionalFields = ["location", "website", "summary", "photo"] as const;

  let score = 0;
  // Required fields: 2 points each (max 8)
  for (const field of requiredFields) {
    if (isFilled(basics[field])) score += 2;
  }
  // Optional fields: 0.5 points each (max 2)
  for (const field of optionalFields) {
    if (isFilled(basics[field])) score += 0.5;
  }

  return Math.min(score, SECTION_MAX);
}

function scoreExperience(items: ResumeContent["experience"]): number {
  if (items.length === 0) return 0;

  const scores = items.map((item) => {
    const required = [
      isFilled(item.company),
      isFilled(item.title),
      isFilled(item.start),
      hasContent(item.content),
    ];
    const filledCount = required.filter(Boolean).length;
    return filledCount / required.length;
  });

  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return Math.round(avg * SECTION_MAX);
}

function scoreEducation(items: ResumeContent["education"]): number {
  if (items.length === 0) return 0;

  const scores = items.map((item) => {
    const required = [
      isFilled(item.school),
      isFilled(item.degree),
      isFilled(item.major),
      isFilled(item.start),
    ];
    const filledCount = required.filter(Boolean).length;
    return filledCount / required.length;
  });

  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return Math.round(avg * SECTION_MAX);
}

function scoreProjects(items: ResumeContent["projects"]): number {
  if (items.length === 0) return 0;

  const scores = items.map((item) => {
    const required = [
      isFilled(item.name),
      isFilled(item.role),
      hasContent(item.content),
    ];
    const filledCount = required.filter(Boolean).length;
    return filledCount / required.length;
  });

  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return Math.round(avg * SECTION_MAX);
}

function scoreSkills(groups: ResumeContent["skills"]): number {
  if (groups.length === 0) return 0;

  const scores = groups.map((group): number => {
    const hasCat = isFilled(group.category);
    const hasItems = group.items.length > 0 && group.items.some((i) => i.trim() !== "");
    if (hasCat && hasItems) return 1;
    if (hasCat || hasItems) return 0.5;
    return 0;
  });

  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return Math.round(avg * SECTION_MAX);
}

/**
 * Score a custom section (e.g., 荣誉奖项, 个人总结, 研究经历).
 * A custom section needs: title filled + content filled = 10.
 * Title only = 5, content only = 5, neither = 0.
 */
function scoreCustomSection(section: ResumeContent["custom"][number]): number {
  const hasTitle = isFilled(section.title);
  const hasCont = hasContent(section.content);
  if (hasTitle && hasCont) return SECTION_MAX;
  if (hasTitle || hasCont) return Math.round(SECTION_MAX * 0.5);
  return 0;
}

/**
 * Get a display label for a custom section.
 * Uses the section's own title if available, falls back to known module names,
 * then to the section id.
 */
function getCustomSectionLabel(section: ResumeContent["custom"][number]): string {
  // If the section has a user-visible title, prefer it
  if (section.title && section.title.trim()) return section.title.trim();
  // Fall back to known module preset names
  return CUSTOM_MODULE_LABELS[section.id] ?? "自定义模块";
}

// ─── Public API ──────────────────────────────────────────

/**
 * Pure computation function (exported for testing).
 * Computes completeness score from resume content.
 *
 * When custom sections exist, they each get 5% weight and built-in
 * section weights shrink proportionally so the total stays at 100%.
 */
export function computeCompletenessScore(content: ResumeContent): CompletenessResult {
  // Score built-in sections
  const builtInSections: SectionScore[] = [
    { key: "basics", label: "基本信息", score: scoreBasics(content.basics), max: SECTION_MAX },
    { key: "experience", label: "工作经历", score: scoreExperience(content.experience), max: SECTION_MAX },
    { key: "education", label: "教育经历", score: scoreEducation(content.education), max: SECTION_MAX },
    { key: "projects", label: "项目经历", score: scoreProjects(content.projects), max: SECTION_MAX },
    { key: "skills", label: "专业技能", score: scoreSkills(content.skills), max: SECTION_MAX },
  ];

  // Score custom sections (only those that have been added by the user)
  const customSections: SectionScore[] = (content.custom ?? []).map((section) => ({
    key: section.id,
    label: getCustomSectionLabel(section),
    score: scoreCustomSection(section),
    max: SECTION_MAX,
  }));

  const allSections = [...builtInSections, ...customSections];

  // Calculate dynamic weights
  const customCount = customSections.length;
  const totalCustomWeight = customCount * CUSTOM_SECTION_WEIGHT;
  // Built-in weights shrink so that total = 1.0
  const builtInScale = customCount > 0 ? (1 - totalCustomWeight) : 1;

  const builtInKeys = Object.keys(BASE_WEIGHTS) as (keyof typeof BASE_WEIGHTS)[];
  let weightedSum = 0;

  for (let i = 0; i < builtInSections.length; i++) {
    const key = builtInKeys[i];
    weightedSum += builtInSections[i].score * BASE_WEIGHTS[key] * builtInScale;
  }
  for (const cs of customSections) {
    weightedSum += cs.score * CUSTOM_SECTION_WEIGHT;
  }

  const overall = Math.round((weightedSum / SECTION_MAX) * 100);

  return { overall, sections: allSections };
}

/**
 * React hook that subscribes to form data via useWatch()
 * and computes completeness score in real-time.
 */
export function useCompletenessScore(): CompletenessResult {
  const content = useWatch() as ResumeContent;

  return useMemo(() => computeCompletenessScore(content), [content]);
}
