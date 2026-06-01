// 字体 family 同时含西文 + 中文 fallback —— 切换字体在中文环境下也能看到
// 视觉变化（zoo 反馈：字体对中文不生效）。
//
// 顺序原则：
// 1. 先 web font (var(--font-*)) —— layout.tsx 用 next/font 加载
//    - Geist Sans/Mono 只覆盖 latin，CJK 不在里面 → 走系统中文 fallback
//    - Sarasa Fixed SC（mono 中文严格等宽，subset 后 ~1.5MB woff2，自托管
//      在 public/fonts/）—— 让"等宽体"在中文环境真正等宽，macOS/Windows
//      都没有原生中文等宽字体，只能 web font 走这条路
// 2. 然后系统中文字体 —— 三种字体走不同中文字形让用户能看出差异：
//    - sans → 苹方 / 思源黑体（无衬线，现代）
//    - serif → 宋体 / Noto Serif SC（衬线，正式）
//    - mono → Sarasa Fixed SC web font（中西文严格等宽）
// 3. 最后 generic family fallback (sans-serif / serif / monospace)
export const FONT_MAP = {
  sans: {
    label: "无衬线",
    css: 'var(--font-geist-sans), "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Source Han Sans SC", "Noto Sans SC", system-ui, sans-serif',
  },
  serif: {
    label: "衬线体",
    css: 'Georgia, "Times New Roman", "Noto Serif SC", "Source Han Serif SC", "Songti SC", "STSong", SimSun, serif',
  },
  mono: {
    label: "等宽体",
    css: 'var(--font-sarasa-mono), var(--font-geist-mono), "Cascadia Mono", "SF Mono", Consolas, "Courier New", monospace',
  },
} as const;

export type FontKey = keyof typeof FONT_MAP;

