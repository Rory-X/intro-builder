// 字体 family 同时含西文 + 中文 fallback —— 切换字体在中文环境下也能看到
// 视觉变化（zoo 反馈：字体对中文不生效）。
//
// 顺序原则：
// 1. 先 web font (var(--font-geist-*)) 给西文用 —— layout.tsx 用 next/font
//    加载的 Geist 系列只覆盖 latin subset，中文 glyph 不在里面
// 2. 然后系统中文字体 —— 三种字体走不同中文字形让用户能看出差异：
//    - sans → 苹方 / 思源黑体（无衬线，现代）
//    - serif → 宋体 / Noto Serif SC（衬线，正式）
//    - mono → 仿宋 STFangsong（字形收紧接近等宽视觉，明显不同于苹方/宋体）
//    macOS 没有原生中文等宽字体，所以 mono 中文用仿宋是次优解 —— 严格等
//    宽中文要引入 web font (Sarasa Mono SC ≈ 200KB)，本期不做。如果 mono
//    也 fallback 到苹方，sans/mono 切换在中文上肉眼无差异（zoo 实测）。
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
    css: 'var(--font-geist-mono), "Cascadia Mono", "SF Mono", Consolas, "Courier New", "STFangsong", FangSong, "STKaiti", KaiTi, monospace',
  },
} as const;

export type FontKey = keyof typeof FONT_MAP;

