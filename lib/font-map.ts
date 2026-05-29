// 字体 family 同时含西文 + 中文 fallback —— 切换字体在中文环境下也能看到
// 视觉变化（zoo 反馈：字体对中文不生效）。
//
// 顺序原则：
// 1. 先 web font (var(--font-geist-*)) 给西文用 —— layout.tsx 用 next/font
//    加载的 Geist 系列只覆盖 latin subset，中文 glyph 不在里面
// 2. 然后系统中文字体（macOS 苹方 / Windows 微软雅黑 / Linux 思源黑体）
//    —— 切换 sans/serif/mono 时中文 glyph 走不同字体，肉眼可见
// 3. 最后 generic family fallback (sans-serif / serif / monospace)
//
// mono 找不到原生等宽中文字体时回退到普通中文字体，这是已知 trade-off：
// 严格的等宽中文字体（Sarasa Mono SC 等）需要 web font，本期不引入。
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
    css: 'var(--font-geist-mono), "Cascadia Mono", "SF Mono", Consolas, "Courier New", "PingFang SC", "Microsoft YaHei", monospace',
  },
} as const;

export type FontKey = keyof typeof FONT_MAP;
