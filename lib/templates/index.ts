export { ClassicLayout } from "./classic/Layout";
export { classicMeta } from "./classic/meta";
export { ModernLayout } from "./modern/Layout";
export { modernMeta } from "./modern/meta";
export { ProfessionalLayout } from "./professional/Layout";
export { professionalMeta } from "./professional/meta";
export {
  TEMPLATES,
  TEMPLATE_IDS,
  DEFAULT_TEMPLATE_ID,
  resolveTemplateId,
  getTemplateMeta,
  getTemplateLayout,
} from "./registry";
export type { TemplateId, TemplateLayoutProps, TemplateMeta } from "./registry";
