import { z } from "zod";

/**
 * Zod-first：所有 type 由 schema `z.infer` 推导，杜绝 schema drift。
 */

// 用户视角 category enum —— 同 lib/templates/registry.ts 的 TemplateCategory。
// 这里独立定义而非 import registry.ts，避免循环引用。
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
export const SectionIconsSchema = z.preprocess(
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
  sectionIcons: SectionIconsSchema,
  html: z.string().nullable(),
  css: z.string().nullable(),
  category: TemplateCategorySchema.nullable(),
  features: FeaturesSchema.nullable(),
});
export type UploadedTemplate = z.infer<typeof UploadedTemplate>;
