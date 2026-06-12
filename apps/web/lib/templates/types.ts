import type { ResumeContent, StyleSettings } from "@intro-builder/shared/schemas";

export type TemplateId = string;

export type TemplateLayoutProps = {
  content: ResumeContent;
  sectionOrder?: string[];
  styleSettings?: StyleSettings;
  /** Editor preview: show section shells when modules have no entries yet */
  showEmptyPlaceholders?: boolean;
  /**
   * 交互模式。默认 true（链接可点）。缩略图场景传 false：渲染出的 `<a>` 降级成
   * `<span>`，避免内部链接嵌套进外层可点卡片（见 SlotRenderer.interactive）。
   */
  interactive?: boolean;
};
