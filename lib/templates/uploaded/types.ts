import type { ResumeHeaderVariant } from "@/lib/templates/shared/resume-header";
import type { ResumeSectionVariant } from "@/lib/templates/shared/resume-section";

/**
 * 装饰底图 + 摆放方式。从参考图 AI 抠出来的 PNG 由 `bgImageUrl` 指向，
 * placement 是绝对定位参数（top/right/width/height/zIndex/opacity）。
 * pageBgColor 用于浅底色页面（避免 decoration 跟纯白冲突）。
 */
export type DecorationConfig = {
  bgImageUrl: string;
  placement: {
    position: "absolute";
    top: string;
    right: string;
    width: string;
    height: string;
    zIndex: number;
    opacity: number;
  };
  pageBgColor?: string;
};

/**
 * 简历分区 id。对应 `ResumeContent.sectionOrder` 里的字符串：
 * built-in: "experience" | "education" | "projects" | "skills"
 * preset:   "summary" | "awards" | "research" | "portfolio"
 * custom:   用户自定义的 id（任意字符串）
 *
 * 不写死 enum 是因为 custom section 的 id 是用户输入的。
 */
export type SectionId = string;

/**
 * 骨架（frame）—— 整页面的分区方式。Skill 看截图判断属于哪种 kind 并填充
 * 对应字段；引擎按 kind 选 CSS Grid/Flex 容器渲染。
 *
 * 当前只支持两种 kind（覆盖绝大多数中文简历样式）：
 *
 * - **vertical**：纵向单栏。header 在顶，所有 section 按 sectionOrder 上下排。
 *   现有 `professional` / `classic` 内置模板都是这种骨架；多数简洁、传统简历也是。
 *
 * - **horizontal**：横向双栏。一侧是 sidebar（放头像、技能、教育等次要 section），
 *   另一侧是 main（放工作/项目经历等主要内容）。现有 `modern` 内置模板是这种；
 *   带深色 sidebar 的设计岗简历、海外 CV 多是这种。
 *
 * 后续如要加新骨架（timeline / 三栏 / 卡片网格），在这个 union 里加 kind 即可。
 */
export type FrameConfig =
  | { kind: "vertical" }
  | {
      kind: "horizontal";
      sidebar: {
        /** sidebar 出现在哪一侧（参考图里看深色块/头像那一栏在哪边） */
        side: "left" | "right";
        /** sidebar 宽度，CSS 长度值。常见 "220px" / "240px" 或 "30%" */
        width: string;
        /** 哪些 section 放进 sidebar；其余 section 进 main */
        sections: SectionId[];
        /** sidebar 背景色。null/undefined = 跟主页一致（透明 sidebar） */
        bgColor?: string;
        /** sidebar 文字色（深底浅字时必填） */
        textColor?: string;
      };
    };

/**
 * 模板的渲染配置。Skill 看参考图产出，引擎读这个 + ResumeContent 渲染最终页面。
 *
 * 三个维度独立：
 * 1. **frame** —— 骨架（纵/横），决定页面整体分区
 * 2. ***Variant** —— 风格细节（标题样式、item 卡片样式），跟 frame 正交
 * 3. **theme + sectionIcons** —— 颜色和图标，跟前两者都正交
 */
export type LayoutConfig = {
  /** 骨架（必填）。Skill 必须明确表达这是纵向还是横向。 */
  frame: FrameConfig;
  headerVariant: ResumeHeaderVariant;
  sectionTitleVariant: ResumeSectionVariant;
  itemHeaderVariant: "professional" | "classic" | "modern";
  theme: {
    primaryColor: string;
    accentColor?: string;
    cardBg?: string;
    cardRadius?: string;
    cardShadow?: string;
    fontFamily?: string;
  };
  sectionIcons: Record<string, string>;
};

export type UploadedTemplate = {
  id: string;
  name: string;
  description: string | null;
  thumbnailUrl: string | null;
  decoration: DecorationConfig | null;
  layout: LayoutConfig;
};
