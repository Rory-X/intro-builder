"use client";

import {
  useDeferredValue,
  useId,
  useMemo,
  useState,
  useTransition,
  type ChangeEvent,
} from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { TEMPLATES } from "@/lib/templates/registry";
import { ClientTemplateRenderFromSerializable } from "@/lib/templates/render";
import type { SerializableResolvedTemplate } from "@/lib/templates/render";
import type { ResumeContent } from "@/lib/resume-schema";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { TemplateThumbnail } from "@/components/templates/template-thumbnail";
import { TemplatePreviewDrawer } from "@/components/templates/template-preview-drawer";
import { setTemplate } from "@/app/(app)/resume/[id]/edit/actions";

type TabValue = "all" | "builtin" | "uploaded";

type Props = {
  templates: SerializableResolvedTemplate[];
  /** 用户最近一份简历；不存在则 toggle 默认 OFF（强制走 demo 内容）。 */
  userResume: { id: string; content: ResumeContent } | null;
  demoResume: ResumeContent;
  /** 来自编辑器（"查看全部模板 →"）时为 "editor"，决定 P2.3 抽屉里 apply 后跳转目标。 */
  from: string | null;
};

/**
 * 给一个 SerializableResolvedTemplate 抽出"展示用"的元数据（name + description）：
 * - builtin：从客户端静态 TEMPLATES 表（registry.ts）查
 * - uploaded：直接读 resolved.template 字段
 * 客户端做这个映射，因为 ComponentType<Layout> 不能跨 SC→CC 边界（builtin
 * 那边只过来了 id），但 TEMPLATES 是客户端静态导入，安全可用。
 */
function getDisplayMeta(resolved: SerializableResolvedTemplate): {
  name: string;
  description: string;
  isRecommended?: boolean;
} {
  if (resolved.source === "builtin") {
    const meta = TEMPLATES.find((t) => t.id === resolved.id);
    return {
      name: meta?.name ?? resolved.id,
      description: meta?.description ?? "",
      isRecommended: meta?.isRecommended,
    };
  }
  return {
    name: resolved.template.name,
    description: resolved.template.description ?? "",
  };
}

export function TemplateLibraryClient({
  templates,
  userResume,
  demoResume,
  from,
}: Props) {
  // toggle 默认：用户有简历 → ON（展示真实简历内容套各模板的效果）
  // 没简历 → OFF + disable（toggle 灰掉，走 demo 内容）
  const canUseMyContent = userResume !== null;
  const [useMyContent, setUseMyContent] = useState<boolean>(canUseMyContent);
  const [tab, setTab] = useState<TabValue>("all");
  const [searchInput, setSearchInput] = useState<string>("");
  // 抽屉状态：selected 为 null 时不打开。
  const [selected, setSelected] =
    useState<SerializableResolvedTemplate | null>(null);
  const [isApplying, startApplying] = useTransition();
  const router = useRouter();

  // useDeferredValue 包住 content：toggle 切换会触发 5+ 缩略图同时重渲染，
  // 推迟 content 更新让 toggle 控件本身的视觉切换不被 thumbnail 渲染阻塞。
  const activeContent =
    useMyContent && userResume ? userResume.content : demoResume;
  const deferredContent = useDeferredValue(activeContent);

  // 过滤：tab + search。search 不区分大小写、按 name 子串匹配。
  const filtered = useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    return templates.filter((t) => {
      if (tab === "builtin" && t.source !== "builtin") return false;
      if (tab === "uploaded" && t.source !== "uploaded") return false;
      if (q) {
        const { name, description } = getDisplayMeta(t);
        const hay = `${name} ${description}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [templates, tab, searchInput]);

  // 抽屉留给 P2.3 —— 现在卡片点击只是 console + 视觉 hover 效果。
  const handleCardClick = (resolved: SerializableResolvedTemplate) => {
    setSelected(resolved);
  };

  // apply 链路：setTemplate（server action）→ toast → 关抽屉 → 视来源决定
  // 是否 redirect 回编辑器。setTemplate 内部已经过 getTemplateMetaAsync 校验，
  // 不存在的 templateId 会被收敛为 default builtin，所以这里不会"应用一个不存在
  // 的模板"——失败仅来自鉴权 / 网络 / DB。
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
        if (from === "editor") {
          router.push(`/resume/${targetResumeId}/edit`);
        } else {
          router.refresh();
        }
      } catch (error) {
        console.error("[templates] apply failed:", error);
        const message = error instanceof Error ? error.message : "未知错误";
        toast.error(`应用失败：${message}`);
      }
    });
  };

  const toggleId = useId();

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:py-12">
      <div className="mb-8 flex items-end justify-between gap-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold md:text-3xl">模板库</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            选个喜欢的模板套到你的简历上 ✨
          </p>
        </div>
        {/* "use my content" toggle */}
        <label
          htmlFor={toggleId}
          className={cn(
            "flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 text-sm",
            !canUseMyContent && "opacity-60",
          )}
        >
          <span className="relative inline-flex h-5 w-9 shrink-0">
            <input
              id={toggleId}
              type="checkbox"
              className="peer sr-only"
              checked={useMyContent}
              disabled={!canUseMyContent}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setUseMyContent(e.target.checked)
              }
            />
            <span className="pointer-events-none absolute inset-0 rounded-full bg-border transition-colors peer-checked:bg-primary peer-disabled:cursor-not-allowed" />
            <span className="pointer-events-none absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">用我的内容预览</span>
            <span className="text-xs text-muted-foreground">
              {canUseMyContent
                ? "把你最近一份简历套到下面的模板上"
                : "需要先创建一份简历才能开启"}
            </span>
          </span>
        </label>
      </div>

      {/* Tabs + search row */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Tabs
          value={tab}
          onValueChange={(v) => setTab((v as TabValue) ?? "all")}
        >
          <TabsList>
            <TabsTrigger value="all">全部</TabsTrigger>
            <TabsTrigger value="builtin">内置</TabsTrigger>
            <TabsTrigger value="uploaded">上传</TabsTrigger>
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
          没有匹配的模板。试试别的关键词？(｡•́︿•̀｡)
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {filtered.map((resolved) => (
            <TemplateCard
              key={`${resolved.source}:${resolved.id}`}
              resolved={resolved}
              content={deferredContent}
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
        content={deferredContent}
        resumeId={userResume?.id ?? null}
        isApplying={isApplying}
        onApply={handleApply}
      />
    </div>
  );
}

function TemplateCard({
  resolved,
  content,
  onClick,
}: {
  resolved: SerializableResolvedTemplate;
  content: ResumeContent;
  onClick: () => void;
}) {
  const { name, description, isRecommended } = getDisplayMeta(resolved);
  const sourceLabel = resolved.source === "builtin" ? "内置" : "上传";

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
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {sourceLabel}
            </span>
          </div>
        </div>
        {description && (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {description}
          </p>
        )}
      </div>
    </article>
  );
}
