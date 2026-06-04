import { z } from "zod";

/**
 * Zod-first：所有 type 由 schema `z.infer` 推导，杜绝 schema drift（手写 type
 * 和 schema 各写一份后慢慢不同步的反模式）。下游 import 仍用 `import type {...}`
 * 无须改动——z.infer 出来的形状和原手写 interface 完全一致。
 */

// === Variant enums ===
// v1 渲染引擎的变体枚举。v2 SlotRenderer 不再使用这些变体做渲染分派，
// 但 DB 中已有行仍携带这些字段，Zod 解析需要接受它们。
type ResumeHeaderVariant = "classic" | "professional" | "modern-sidebar";
type ResumeSectionVariant = "classic" | "professional" | "modern" | "card-wrapped" | "full-width-bar";

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
  "full-width-bar",
]) satisfies z.ZodType<ResumeSectionVariant>;

const ItemHeaderVariantSchema = z.enum(["professional", "classic", "modern"]);

// 用户视角 category enum —— 同 lib/templates/registry.ts 的 TemplateCategory。
// 这里独立定义而非 import registry.ts，避免循环引用（registry.ts 已经引用
// UploadedTemplate）。两边手动同步即可——只有 5 个值。
export const TemplateCategorySchema = z.enum([
  "academic",
  "tech",
  "business",
  "creative",
  "general",
]);
export type TemplateCategoryValue = z.infer<typeof TemplateCategorySchema>;

// features 数组：抽屉里"这个模板的特点"显示。固定 3 条，每条 ≤ 60 字。
const FeaturesSchema = z.array(z.string().min(1).max(60)).length(3);

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

// === SectionIconDeclaration ===
/**
 * Section 图标声明。opt-in：模板不声明则不显示图标。
 * 兼容旧格式：读入时 string 值转为 { icon: oldValue }。
 */
export const SectionIconDeclaration = z.object({
  icon: z.string(),
  color: z.string().optional(),
});
export type SectionIconDeclaration = z.infer<typeof SectionIconDeclaration>;

/**
 * sectionIcons 字段的 schema：
 * - 新格式 `{ icon: string; color?: string }`
 * - 旧格式 `string`（只有 icon name）—— preprocess 自动升级
 */
const SectionIconsSchema = z.preprocess(
  (raw) => {
    if (typeof raw !== "object" || raw === null) return raw;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === "string") {
        result[key] = { icon: value };
      } else {
        result[key] = value;
      }
    }
    return result;
  },
  z.record(z.string(), SectionIconDeclaration),
);
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
    /** 隐藏 ResumeHeader（用于 banner-PNG 自带头像/姓名/联系方式的模板） */
    hideHeader: z.boolean().optional(),
  }),
  sectionIcons: SectionIconsSchema,
});
export type LayoutConfig = z.infer<typeof LayoutConfig>;

// === UploadedTemplate ===
/**
 * v2 模板数据结构。所有模板走 SlotRenderer（HTML+CSS slot-driven）渲染。
 * `html` 非空时可渲染，null 时跳过（不展示在模板库中）。
 */
export const UploadedTemplate = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  layout: LayoutConfig,
  html: z.string().nullable(),
  css: z.string().nullable(),
  category: TemplateCategorySchema.nullable(),
  features: FeaturesSchema.nullable(),
});
export type UploadedTemplate = z.infer<typeof UploadedTemplate>;
