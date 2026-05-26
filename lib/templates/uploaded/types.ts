import { z } from "zod";
import type { ResumeHeaderVariant } from "@/lib/templates/shared/resume-header";
import type { ResumeSectionVariant } from "@/lib/templates/shared/resume-section";

/**
 * Zod-first：所有 type 由 schema `z.infer` 推导，杜绝 schema drift（手写 type
 * 和 schema 各写一份后慢慢不同步的反模式）。下游 import 仍用 `import type {...}`
 * 无须改动——z.infer 出来的形状和原手写 interface 完全一致。
 *
 * `satisfies z.ZodType<ExternalAlias>` 用于 variant 字段：当 resume-header /
 * resume-section 加了新 variant 但本文件 z.enum 没跟上时，TypeScript 会编译
 * 失败提醒，是显式的漂移检测。
 */

// === Variant enums ===
const HeaderVariantSchema = z.enum([
  "classic",
  "professional",
  "modern-sidebar",
]) satisfies z.ZodType<ResumeHeaderVariant>;

const SectionTitleVariantSchema = z.enum([
  "classic",
  "professional",
  "modern",
  "card-wrapped",
]) satisfies z.ZodType<ResumeSectionVariant>;

const ItemHeaderVariantSchema = z.enum(["professional", "classic", "modern"]);

// === DecorationConfig ===
/**
 * 装饰底图 + 摆放方式。从参考图 AI 抠出来的 PNG 由 `bgImageUrl` 指向，
 * placement 是绝对定位参数（top/right/width/height/zIndex/opacity）。
 * pageBgColor 用于浅底色页面（避免 decoration 跟纯白冲突）。
 */
export const DecorationConfig = z.object({
  bgImageUrl: z.string(),
  placement: z.object({
    position: z.literal("absolute"),
    top: z.string(),
    right: z.string(),
    width: z.string(),
    height: z.string(),
    zIndex: z.number(),
    opacity: z.number(),
  }),
  pageBgColor: z.string().optional(),
});
export type DecorationConfig = z.infer<typeof DecorationConfig>;

/**
 * 简历分区 id。对应 `ResumeContent.sectionOrder` 里的字符串：
 * built-in: "experience" | "education" | "projects" | "skills"
 * preset:   "summary" | "awards" | "research" | "portfolio"
 * custom:   用户自定义的 id（任意字符串）
 *
 * 不写死 enum 是因为 custom section 的 id 是用户输入的。
 */
export type SectionId = string;

// === FrameConfig ===
/**
 * 骨架（frame）—— 整页面的分区方式。Skill 看截图判断属于哪种 kind 并填充
 * 对应字段；引擎按 kind 选 CSS Grid/Flex 容器渲染。
 *
 * - **vertical**：纵向单栏。header 在顶，所有 section 按 sectionOrder 上下排。
 * - **horizontal**：横向双栏。一侧是 sidebar（放头像、技能、教育等次要 section），
 *   另一侧是 main（放工作/项目经历等主要内容）。
 *
 * 用 `z.discriminatedUnion` 而非 `z.union` 让 TypeScript narrowing 生效——
 * `if (frame.kind === "horizontal") frame.sidebar` 这种取字段不需要 cast。
 */
export const FrameConfig = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("vertical") }),
  z.object({
    kind: z.literal("horizontal"),
    sidebar: z.object({
      /** sidebar 出现在哪一侧（参考图里看深色块/头像那一栏在哪边） */
      side: z.enum(["left", "right"]),
      /** sidebar 宽度，CSS 长度值。常见 "220px" / "240px" 或 "30%" */
      width: z.string(),
      /** 哪些 section 放进 sidebar；其余 section 进 main */
      sections: z.array(z.string()),
      /** sidebar 背景色。null/undefined = 跟主页一致（透明 sidebar） */
      bgColor: z.string().optional(),
      /** sidebar 文字色（深底浅字时必填） */
      textColor: z.string().optional(),
    }),
  }),
]);
export type FrameConfig = z.infer<typeof FrameConfig>;

// === LayoutConfig ===
/**
 * 模板的渲染配置。Skill 看参考图产出，引擎读这个 + ResumeContent 渲染最终页面。
 *
 * 三个维度独立：
 * 1. **frame** —— 骨架（纵/横），决定页面整体分区
 * 2. ***Variant** —— 风格细节（标题样式、item 卡片样式），跟 frame 正交
 * 3. **theme + sectionIcons** —— 颜色和图标，跟前两者都正交
 */
export const LayoutConfig = z.object({
  /** 骨架（必填）。Skill 必须明确表达这是纵向还是横向。 */
  frame: FrameConfig,
  headerVariant: HeaderVariantSchema,
  sectionTitleVariant: SectionTitleVariantSchema,
  itemHeaderVariant: ItemHeaderVariantSchema,
  theme: z.object({
    primaryColor: z.string(),
    accentColor: z.string().optional(),
    cardBg: z.string().optional(),
    cardRadius: z.string().optional(),
    cardShadow: z.string().optional(),
    fontFamily: z.string().optional(),
  }),
  sectionIcons: z.record(z.string(), z.string()),
});
export type LayoutConfig = z.infer<typeof LayoutConfig>;

// === UploadedTemplate ===
export const UploadedTemplate = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  decoration: DecorationConfig.nullable(),
  layout: LayoutConfig,
});
export type UploadedTemplate = z.infer<typeof UploadedTemplate>;
