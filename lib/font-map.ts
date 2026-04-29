export const FONT_MAP = {
  sans: {
    label: "无衬线",
    css: "var(--font-geist-sans), system-ui, sans-serif",
  },
  serif: {
    label: "衬线体",
    css: "'Noto Serif SC', 'Source Han Serif SC', Georgia, serif",
  },
  mono: {
    label: "等宽体",
    css: "var(--font-geist-mono), 'Courier New', monospace",
  },
} as const;

export type FontKey = keyof typeof FONT_MAP;
