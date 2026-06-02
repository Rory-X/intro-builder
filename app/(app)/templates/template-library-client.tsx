"use client";

import {
  useMemo,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { Search, Star } from "lucide-react";
import { toast } from "sonner";
import { TEMPLATES } from "@/lib/templates/registry";
import { ClientTemplateRenderFromSerializable } from "@/lib/templates/render";
import type { SerializableResolvedTemplate } from "@/lib/templates/render";
import type { ResumeContent } from "@/lib/resume-schema";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { TemplateThumbnail } from "@/components/templates/template-thumbnail";
import { TemplatePreviewDrawer } from "@/components/templates/template-preview-drawer";
import { setTemplate } from "@/app/(app)/resume/[id]/edit/actions";
import { toggleTemplateFavorite } from "./actions";
import type { TemplateCategory } from "@/lib/templates/registry";

// "all" 表示不过滤，"favorites" 表示只看当前用户收藏的，否则按 category 值精确
// 匹配。tab 列表 derive 自当前模板列表实际出现的 category，避免空 tab。
type TabValue = "all" | "favorites" | TemplateCategory;

const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  academic: "学术",
  tech: "互联网",
  business: "商务",
  creative: "创意",
  general: "通用",
};

// 显示顺序（不写在这里的不显示——但 Record 强制类型完备，所以 5 个都在）。
const CATEGORY_ORDER: TemplateCategory[] = [
  "tech",
  "business",
  "academic",
  "creative",
  "general",
];

type Props = {
  templates: SerializableResolvedTemplate[];
  /** 用户最近一份简历；null 表示没有简历，drawer 里的 toggle 会被禁用。 */
  userResume: { id: string; content: ResumeContent } | null;
  demoResume: ResumeContent;
  /** 当前用户已收藏的 templateId 列表，作为客户端收藏状态的初始值。 */
  favoritedIds: string[];
};

/**
 * 给一个 SerializableResolvedTemplate 抽出"展示用"的元数据（name + description + category）：
 * - builtin：从客户端静态 TEMPLATES 表（registry.ts）查
 * - uploaded：直接读 resolved.template 字段
 * 客户端做这个映射，因为 ComponentType<Layout> 不能跨 SC→CC 边界（builtin
 * 那边只过来了 id），但 TEMPLATES 是客户端静态导入，安全可用。
 */
function getDisplayMeta(resolved: SerializableResolvedTemplate): {
  name: string;
  description: string;
  isRecommended?: boolean;
  category?: TemplateCategory;
} {
  if (resolved.source === "builtin") {
    const meta = TEMPLATES.find((t) => t.id === resolved.id);
    return {
      name: meta?.name ?? resolved.id,
      description: meta?.description ?? "",
      isRecommended: meta?.isRecommended,
      category: meta?.category,
    };
  }
  if (resolved.source === "unified") {
    return {
      name: resolved.id,
      description: "",
    };
  }
  return {
    name: resolved.template.name,
    description: resolved.template.description ?? "",
    category: resolved.template.category ?? undefined,
  };
}

export function TemplateLibraryClient({
  templates,
  userResume,
  demoResume,
  favoritedIds,
}: Props) {
  // 网格里的所有缩略图永远用 demoResume —— /templates 是全局浏览入口，
  // "用我的内容预览"已经下沉到 TemplatePreviewDrawer（点击卡片打开后才决定）。
  const [tab, setTab] = useState<TabValue>("all");
  const [searchInput, setSearchInput] = useState<string>("");
  // 抽屉状态：selected 为 null 时不打开。
  const [selected, setSelected] =
    useState<SerializableResolvedTemplate | null>(null);
  const [isApplying, startApplying] = useTransition();
  // 收藏状态用本地 Set 做乐观更新：点击立即变黄，server action 失败再回滚。
  // 初始值来自 server 预取的 favoritedIds（page.tsx）。
  const [favorites, setFavorites] = useState<Set<string>>(
    () => new Set(favoritedIds),
  );
  const [, startToggleFavorite] = useTransition();
  const router = useRouter();

  // 收藏切换：先乐观改本地 Set（UI 立刻反馈），再调 action；失败回滚 + toast。
  // 不 await，借 useTransition 标记 pending，连点也不会丢状态（onConflictDoNothing
  // + delete 幂等，server 侧无副作用）。
  const toggleFavorite = (templateId: string) => {
    const willFavorite = !favorites.has(templateId);
    setFavorites((cur) => {
      const next = new Set(cur);
      if (willFavorite) next.add(templateId);
      else next.delete(templateId);
      return next;
    });
    startToggleFavorite(async () => {
      const res = await toggleTemplateFavorite(templateId, willFavorite);
      if (!res.success) {
        // 回滚到操作前状态
        setFavorites((cur) => {
          const reverted = new Set(cur);
          if (willFavorite) reverted.delete(templateId);
          else reverted.add(templateId);
          return reverted;
        });
        toast.error(`收藏失败：${res.error ?? "未知错误"}`);
      }
    });
  };

  // 过滤：tab + search。search 不区分大小写、按 name 子串匹配。tab=all 不限；
  // tab=favorites 只看收藏（按 resolved.id 匹配，与套用用的 id 一致）；其余按
  // category 精确匹配。
  const filtered = useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    return templates.filter((t) => {
      if (tab === "favorites") {
        if (!favorites.has(t.id)) return false;
      } else if (tab !== "all") {
        const { category } = getDisplayMeta(t);
        if (category !== tab) return false;
      }
      if (q) {
        const { name, description } = getDisplayMeta(t);
        const hay = `${name} ${description}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [templates, tab, searchInput, favorites]);

  // 实际出现的 category 集合（按 CATEGORY_ORDER 顺序，不显示空 tab）。
  // 例如只有 tech / business 模板时，tab 列表只显示「全部 / 互联网 / 商务」。
  const availableCategories = useMemo(() => {
    const present = new Set<TemplateCategory>();
    for (const t of templates) {
      const { category } = getDisplayMeta(t);
      if (category) present.add(category);
    }
    return CATEGORY_ORDER.filter((c) => present.has(c));
  }, [templates]);

  // 抽屉留给 P2.3 —— 现在卡片点击只是 console + 视觉 hover 效果。
  const handleCardClick = (resolved: SerializableResolvedTemplate) => {
    setSelected(resolved);
  };

  // apply 链路：setTemplate（server action）→ toast → 关抽屉 → 跳编辑器看效果。
  // setTemplate 内部已经过 getTemplateMetaAsync 校验，不存在的 templateId 会
  // 被收敛为 default builtin，所以这里不会"应用一个不存在的模板"——失败仅来自
  // 鉴权 / 网络 / DB。
  //
  // 跳转策略：永远 push 到 /resume/[id]/edit。早期版本对 from=editor 跳编辑器、
  // 否则 router.refresh() 留在 /templates，但 gallery 没有"当前已选中模板"的
  // 视觉指示，刷完跟没刷一样，用户会以为"完全没生效"。统一跳编辑器让用户能
  // 立刻看到模板套上自己内容的真实效果，闭环更强。from=editor 时 push 同一份
  // 编辑器路由也是回到原页面，行为不变。
  const handleApply = () => {
    if (!selected || !userResume) return;
    const targetTemplateId = selected.id;
    const targetResumeId = userResume.id;
    const targetName = getDisplayMeta(selected).name;
    startApplying(async () => {
      try {
        await setTemplate(targetResumeId, targetTemplateId);
        toast.success(`已应用模板：${targetName}`);
        setSelected(null);
        router.push(`/resume/${targetResumeId}/edit?from=templates`);
      } catch (error) {
        console.error("[templates] apply failed:", error);
        const message = error instanceof Error ? error.message : "未知错误";
        toast.error(`应用失败：${message}`);
      }
    });
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:py-12">
      <div className="mb-8">
        <h1 className="text-2xl font-bold md:text-3xl">模板库</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          选个喜欢的模板套到你的简历上 ✨
        </p>
      </div>

      {/* Tabs + search row */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Tabs
          value={tab}
          onValueChange={(v) => setTab((v as TabValue) ?? "all")}
        >
          <TabsList>
            <TabsTrigger value="all">全部</TabsTrigger>
            <TabsTrigger value="favorites" className="gap-1">
              <Star className="size-3.5" />
              我收藏的{favorites.size > 0 ? ` ${favorites.size}` : ""}
            </TabsTrigger>
            {availableCategories.map((c) => (
              <TabsTrigger key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="搜索模板名 / 描述"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-border/60 p-16 text-center text-muted-foreground">
          {tab === "favorites"
            ? "还没有收藏任何模板。点模板右上角的 ⭐ 收藏，方便下次快速套用 ✨"
            : "没有匹配的模板。试试别的关键词？(｡•́︿•̀｡)"}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {filtered.map((resolved) => (
            <TemplateCard
              key={`${resolved.source}:${resolved.id}`}
              resolved={resolved}
              content={demoResume}
              isFavorited={favorites.has(resolved.id)}
              onToggleFavorite={() => toggleFavorite(resolved.id)}
              onClick={() => handleCardClick(resolved)}
            />
          ))}
        </div>
      )}

      <TemplatePreviewDrawer
        open={selected !== null}
        onOpenChange={(o) => {
          if (!o) setSelected(null);
        }}
        resolved={selected}
        demoContent={demoResume}
        userContent={userResume?.content ?? null}
        resumeId={userResume?.id ?? null}
        isApplying={isApplying}
        onApply={handleApply}
        isFavorited={selected ? favorites.has(selected.id) : false}
        onToggleFavorite={
          selected ? () => toggleFavorite(selected.id) : undefined
        }
      />
    </div>
  );
}

function TemplateCard({
  resolved,
  content,
  isFavorited,
  onToggleFavorite,
  onClick,
}: {
  resolved: SerializableResolvedTemplate;
  content: ResumeContent;
  isFavorited: boolean;
  onToggleFavorite: () => void;
  onClick: () => void;
}) {
  const { name, description, isRecommended, category } = getDisplayMeta(resolved);
  const categoryLabel = category ? CATEGORY_LABELS[category] : null;

  return (
    <article
      className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5"
    >
      <button
        type="button"
        onClick={onClick}
        className="block w-full text-left"
        aria-label={`查看模板 ${name}`}
      >
        <TemplateThumbnail>
          <ClientTemplateRenderFromSerializable
            resolved={resolved}
            content={content}
            sectionOrder={content.sectionOrder}
            styleSettings={content.styleSettings}
          />
        </TemplateThumbnail>
      </button>
      <div className="flex flex-col gap-1.5 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-base font-semibold">{name}</h3>
          <div className="flex shrink-0 items-center gap-1">
            {isRecommended && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                推荐
              </span>
            )}
            {categoryLabel && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {categoryLabel}
              </span>
            )}
          </div>
        </div>
        {/* 信息区底行：描述（左）+ 收藏五角星（右下角，与描述同行居中对齐）。
            星放在 meta footer 内而非缩略图上方，绝不遮挡简历预览。收藏后填充黄色。 */}
        <div className="flex min-h-8 items-center gap-2">
          {description && (
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {description}
            </p>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite();
            }}
            aria-label={isFavorited ? `取消收藏 ${name}` : `收藏 ${name}`}
            aria-pressed={isFavorited}
            className="ml-auto grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Star
              className={
                isFavorited ? "size-4 fill-yellow-400 text-yellow-400" : "size-4"
              }
            />
          </button>
        </div>
      </div>
    </article>
  );
}
