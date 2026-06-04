import {
  Briefcase,
  GraduationCap,
  FolderGit2,
  Wrench,
  LayoutList,
  User,
  Award,
  FlaskConical,
  Palette,
  Mail,
  Phone,
  MapPin,
  Globe,
  Languages,
  Code,
  Camera,
  BookOpen,
  Heart,
  Star,
  Trophy,
  Building,
  Building2,
  Calendar,
  Clock,
  Computer,
  Database,
  Lightbulb,
  Monitor,
  Music,
  Pen,
  PenTool,
  Pencil,
  Smile,
  Sparkles,
  Target,
  Zap,
  Mic,
  Newspaper,
  Plane,
  Rocket,
  Smartphone,
  type LucideIcon,
} from "lucide-react";

/**
 * Lucide icon 字符串名 → React 组件的 lookup 表。
 *
 * Skill（template-studio）产出的 `sectionIcons` 是
 * `Record<sectionKey, lucideName>`（如 `{experience: "Briefcase"}`），
 * 渲染端必须把字符串转成实际的 React 组件才能挂在 DOM。
 *
 * 这里**只 import whitelist**而不是动态拉所有 lucide icon —— bundle size
 * 是关键考量（lucide-react 完整包 ~700KB，单独 import 每个 icon 只 ~2KB）。
 * 35 个 whitelist 覆盖 90% 简历用途；运营 Skill 输出 whitelist 外的 name
 * 时返回 null，调用方 fallback 到 section-meta 默认 icon——优雅降级，
 * 不抛错也不空缺图标。
 *
 * 扩展白名单：新增 import 后加进 `ICON_REGISTRY`，无需改其他文件。
 */
const ICON_REGISTRY: Record<string, LucideIcon> = {
  // 现有 section-meta 里的 9 个（保证 Skill 用默认 sectionKey 名字时一定命中）
  Briefcase,
  GraduationCap,
  FolderGit2,
  Wrench,
  LayoutList,
  User,
  Award,
  FlaskConical,
  Palette,
  // 常见简历元素：联系方式 / 资历 / 兴趣
  Mail,
  Phone,
  MapPin,
  Globe,
  Languages,
  Code,
  Camera,
  BookOpen,
  Heart,
  Star,
  Trophy,
  Building,
  Building2,
  Calendar,
  Clock,
  Computer,
  Database,
  Lightbulb,
  Monitor,
  Music,
  Pen,
  PenTool,
  Pencil,
  Smile,
  Sparkles,
  Target,
  Zap,
  Mic,
  Newspaper,
  Plane,
  Rocket,
  Smartphone,
};

/**
 * 把 Skill 输出的字符串 name 解析成 LucideIcon 组件。Whitelist 外的 name
 * 返回 null，调用方应该 fallback 到默认 icon（不要抛错——单条坏数据
 * 不击穿整页是渲染引擎的一致策略）。
 */
export function lookupLucideIcon(
  name: string | undefined | null,
): LucideIcon | null {
  if (!name) return null;
  return ICON_REGISTRY[name] ?? null;
}

/** 已注册的 lucide icon 名集合，可暴露给 Skill 端做 schema enum 校验。 */
export const REGISTERED_LUCIDE_NAMES: readonly string[] = Object.freeze(
  Object.keys(ICON_REGISTRY),
);
