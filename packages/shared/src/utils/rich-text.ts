export const RICH_TEXT_BASE_PX = 13;

export const DEFAULT_RICH_TEXT_FONT_SIZE = "1em";

export const RICH_TEXT_FONT_SIZES = [
  "0.92em",
  "1em",
  "1.08em",
  "1.23em",
  "1.38em",
] as const;

export const RICH_TEXT_FONT_SIZE_LABELS: Record<string, string> = {
  "0.92em": "12",
  "1em": "13",
  "1.08em": "14",
  "1.23em": "16",
  "1.38em": "18",
};

function pxToEm(pxValue: string): string | undefined {
  const match = pxValue.match(/^(\d+(?:\.\d+)?)px$/);
  if (!match) return undefined;
  const px = parseFloat(match[1]);
  const em = Math.round((px / RICH_TEXT_BASE_PX) * 100) / 100;
  if (em === 1) return undefined;
  return `${em}em`;
}

function migrateFontSizeMarks(node: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(node.marks)) {
    node.marks = (node.marks as Record<string, unknown>[])
      .map((mark) => {
        if (mark.type !== "textStyle") return mark;
        const attrs = mark.attrs as Record<string, unknown> | undefined;
        if (!attrs || typeof attrs.fontSize !== "string") return mark;
        const fontSize = attrs.fontSize as string;
        if (fontSize.endsWith("em")) return mark;
        const emValue = pxToEm(fontSize);
        if (!emValue) {
          const restAttrs = Object.fromEntries(
            Object.entries(attrs).filter(([k]) => k !== "fontSize"),
          );
          if (Object.keys(restAttrs).length === 0) return null;
          return { ...mark, attrs: restAttrs };
        }
        return { ...mark, attrs: { ...attrs, fontSize: emValue } };
      })
      .filter(Boolean);
    if ((node.marks as unknown[]).length === 0) delete node.marks;
  }

  if (Array.isArray(node.content)) {
    node.content = (node.content as Record<string, unknown>[]).map(migrateFontSizeMarks);
  }

  return node;
}

export function migrateAllFontSizes(obj: Record<string, unknown>): void {
  const experience = obj.experience as Record<string, unknown>[] | undefined;
  if (Array.isArray(experience)) {
    for (const e of experience) {
      if (e.content && typeof e.content === "object") {
        migrateFontSizeMarks(e.content as Record<string, unknown>);
      }
    }
  }
  const projects = obj.projects as Record<string, unknown>[] | undefined;
  if (Array.isArray(projects)) {
    for (const p of projects) {
      if (p.content && typeof p.content === "object") {
        migrateFontSizeMarks(p.content as Record<string, unknown>);
      }
    }
  }
  const education = obj.education as Record<string, unknown>[] | undefined;
  if (Array.isArray(education)) {
    for (const e of education) {
      if (e.highlights && typeof e.highlights === "object") {
        migrateFontSizeMarks(e.highlights as Record<string, unknown>);
      }
    }
  }
  const custom = obj.custom as Record<string, unknown>[] | undefined;
  if (Array.isArray(custom)) {
    for (const c of custom) {
      if (c.content && typeof c.content === "object") {
        migrateFontSizeMarks(c.content as Record<string, unknown>);
      }
    }
  }
}
