"use client";

import type { ReactNode } from "react";
import type { ResumeContent } from "@intro-builder/shared/schemas";
import type { ResumeVersionListItem } from "@/app/(app)/resume/[id]/edit/actions";
import type { RichInlineDiffToken, TipTapDiff } from "@/lib/resume-diff";
import { buildResumeDiff, diffInlineText, diffTipTapDoc, type InlineDiffToken } from "@/lib/resume-diff";
import { cn } from "@/lib/utils";
import { VersionHistoryPopover, formatVersionTime } from "@/components/editor/version-history-popover";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Props = {
  oldContent: ResumeContent;
  newContent: ResumeContent;
  viewedVersion: ResumeVersionListItem;
  versions: ResumeVersionListItem[];
  onSelectVersion: (versionId: string) => void;
  onRestore: (versionId: string) => void;
  onClose: () => void;
  onPreviousVersion?: () => void;
  onNextVersion?: () => void;
  canPreviousVersion?: boolean;
  canNextVersion?: boolean;
};

export function ResumeDiffPreview({
  oldContent,
  newContent,
  viewedVersion,
  versions,
  onSelectVersion,
  onRestore,
  onClose,
  onPreviousVersion,
  onNextVersion,
  canPreviousVersion = false,
  canNextVersion = false,
}: Props) {
  const diff = buildResumeDiff(oldContent, newContent);

  function handleRestore() {
    if (window.confirm("确定要恢复到这个历史版本吗？恢复前会把当前内容保存为一条可找回的版本记录。")) {
      onRestore(viewedVersion.id);
    }
  }

  return (
    <div className="flex h-full overflow-hidden bg-muted">
      <aside className="hidden w-72 shrink-0 border-r bg-background p-4 lg:block">
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm font-medium text-primary">
          正在查看历史版本，简历内容暂不可编辑
        </div>
        <div className="mt-4">
          <VersionHistoryPopover
            versions={versions}
            activeVersionId={viewedVersion.id}
            onSelectVersion={onSelectVersion}
          />
        </div>
      </aside>
      <section className="min-w-0 flex-1 overflow-auto">
        <div className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-blue-200 bg-blue-50 px-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onPreviousVersion}
              disabled={!canPreviousVersion}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground"
              aria-label="上一个版本"
            >
              ←
            </button>
            <button
              type="button"
              onClick={onNextVersion}
              disabled={!canNextVersion}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground"
              aria-label="下一个版本"
            >
              →
            </button>
            <Popover>
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    className="rounded-full bg-blue-200 px-4 py-1.5 text-lg font-semibold text-blue-700"
                    aria-label="选择历史版本"
                  />
                }
              >
                {formatVersionTime(viewedVersion.createdAt).replace(/^.* · /, "")}
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-0">
                <VersionHistoryPopover
                  versions={versions}
                  activeVersionId={viewedVersion.id}
                  onSelectVersion={onSelectVersion}
                />
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRestore}
              className="rounded-md border border-blue-200 bg-background px-3 py-1.5 text-sm font-medium text-blue-700"
            >
              恢复此版本
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-blue-100"
              aria-label="关闭版本对比"
            >
              ×
            </button>
          </div>
        </div>

        <div className="flex justify-center p-6">
          <article
            aria-label="简历版本差异预览"
            className="min-h-[980px] w-[720px] bg-white px-12 py-10 text-gray-900 shadow-xl"
          >
            <header className="border-b-2 border-gray-900 pb-5">
              <h1 className="text-3xl font-bold tracking-normal">
                <InlineDiff tokens={diff.basics.name.tokens.length ? diff.basics.name.tokens : [{ type: "unchanged", text: newContent.basics.name }]} />
              </h1>
              <p className="mt-2 text-sm font-medium text-gray-700">
                <InlineDiff tokens={diff.basics.title.tokens.length ? diff.basics.title.tokens : [{ type: "unchanged", text: newContent.basics.title }]} />
              </p>
              <p className="mt-2 text-xs leading-6 text-gray-500">
                <InlineDiff tokens={diffInlineText(oldContent.basics.location, newContent.basics.location)} />
                {newContent.basics.phone ? " · " : ""}
                <InlineDiff tokens={diffInlineText(oldContent.basics.phone, newContent.basics.phone)} />
                {newContent.basics.email ? " · " : ""}
                <InlineDiff tokens={diffInlineText(oldContent.basics.email, newContent.basics.email)} />
              </p>
            </header>

            {renderPlainSection("个人简介", oldContent.basics.summary, newContent.basics.summary)}
            {renderRichSection("个人总结", diff.richText.summary)}
            {renderArraySection("工作经历", oldContent.experience, newContent.experience, "company", "title", "content")}
            {renderArraySection("项目经历", oldContent.projects, newContent.projects, "name", "role", "content")}
            {renderArraySection("教育经历", oldContent.education, newContent.education, "school", "degree", "highlights")}
            {renderArraySection("研究经历", oldContent.research, newContent.research, "name", "role", "content")}
            {renderRichSection("专业技能", diff.richText.skills)}
            {renderRichSection("荣誉奖项", diff.richText.awards)}
            {renderRichSection("作品集", diff.richText.portfolio)}
          </article>
        </div>
      </section>
    </div>
  );

  function renderPlainSection(title: string, oldText: string, newText: string) {
    if (!oldText && !newText) return null;
    return (
      <section className="mt-6">
        <h2 className="mb-2 text-base font-bold">{title}</h2>
        <p className="text-sm leading-7">
          <InlineDiff tokens={diffInlineText(oldText, newText)} />
        </p>
      </section>
    );
  }

  function renderRichSection(title: string, richDiff: TipTapDiff) {
    if (!richDiff.blocks.some(hasVisibleRichDiffBlock)) return null;
    return (
      <section className="mt-6">
        <h2 className="mb-2 text-base font-bold">{title}</h2>
        <DiffRichText diff={richDiff} />
      </section>
    );
  }

  function renderArraySection<
    T extends Record<string, unknown>,
    TitleKey extends keyof T,
    SubKey extends keyof T,
    RichKey extends keyof T,
  >(
    title: string,
    oldItems: T[],
    newItems: T[],
    titleKey: TitleKey,
    subKey: SubKey,
    richKey: RichKey,
  ) {
    const length = Math.max(oldItems.length, newItems.length);
    if (length === 0) return null;
    return (
      <section className="mt-6">
        <h2 className="mb-3 text-base font-bold">{title}</h2>
        <div className="space-y-4">
          {Array.from({ length }, (_, index) => {
            const oldItem = oldItems[index] ?? {};
            const newItem = newItems[index] ?? {};
            const richDiff = diffTipTapDoc(
              ((oldItem as T)[richKey] as never) ?? { type: "doc", content: [] },
              ((newItem as T)[richKey] as never) ?? { type: "doc", content: [] },
            );
            return (
              <div key={index} className="text-sm">
                <div className="flex items-baseline justify-between gap-4 font-semibold">
                  <span>
                    <InlineDiff
                      tokens={diffInlineText(
                        String(oldItem[titleKey] ?? ""),
                        String(newItem[titleKey] ?? ""),
                      )}
                    />
                  </span>
                  <span className="text-xs text-gray-500">
                    <InlineDiff
                      tokens={diffInlineText(
                        String((oldItem as Record<string, unknown>).start ?? ""),
                        String((newItem as Record<string, unknown>).start ?? ""),
                      )}
                    />
                    {" - "}
                    <InlineDiff
                      tokens={diffInlineText(
                        String((oldItem as Record<string, unknown>).end ?? ""),
                        String((newItem as Record<string, unknown>).end ?? ""),
                      )}
                    />
                  </span>
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  <InlineDiff
                    tokens={diffInlineText(
                      String(oldItem[subKey] ?? ""),
                      String(newItem[subKey] ?? ""),
                    )}
                  />
                </div>
                <DiffRichText diff={richDiff} />
              </div>
            );
          })}
        </div>
      </section>
    );
  }
}

function InlineDiff({ tokens }: { tokens: InlineDiffToken[] }) {
  return (
    <>
      {tokens.map((token, index) => (
        <span
          key={`${token.type}-${index}-${token.text}`}
          data-diff-token={token.type === "unchanged" ? undefined : token.type}
          className={tokenClass(token.type)}
        >
          {token.text}
        </span>
      ))}
    </>
  );
}

function DiffRichText({ diff }: { diff: TipTapDiff }) {
  return (
    <div className="space-y-1 text-sm leading-7">
      {diff.blocks.map((block, index) => {
        const content = (
          <>
            {block.tokens.map((token, tokenIndex) => (
              <MarkedToken key={`${index}-${tokenIndex}`} token={token} />
            ))}
          </>
        );
        const props = {
          "data-diff-block": block.status === "unchanged" ? undefined : block.status,
          className: cn(
            block.status === "added" && "border-l-2 border-blue-500 bg-blue-50/60 pl-2",
            block.status === "removed" && "border-l-2 border-red-500 bg-red-50/60 pl-2",
          ),
        };
        if (block.type === "horizontalRule") return <hr key={index} {...props} className={cn(props.className, "my-3 border-gray-300")} />;
        if (block.type === "heading") return <h3 key={index} {...props} className={cn(props.className, "text-base font-bold")}>{content}</h3>;
        if (block.type === "listItem") {
          const listType = block.attrs?.listType === "orderedList" ? "ordered" : "bullet";
          if (listType === "ordered") {
            return <ol key={index} {...props} className={cn(props.className, "ml-5 list-decimal")}><li>{content}</li></ol>;
          }
          return <ul key={index} {...props} className={cn(props.className, "ml-5 list-disc")}><li>{content}</li></ul>;
        }
        if (block.type === "blockquote") return <blockquote key={index} {...props} className={cn(props.className, "border-l-4 pl-3 text-gray-600")}>{content}</blockquote>;
        if (block.type === "codeBlock") return <pre key={index} {...props} className={cn(props.className, "rounded bg-gray-950 px-3 py-2 text-xs text-gray-100")}>{content}</pre>;
        return <p key={index} {...props}>{content}</p>;
      })}
    </div>
  );
}

function hasVisibleRichDiffBlock(block: TipTapDiff["blocks"][number]) {
  return block.type === "horizontalRule" || block.tokens.some((token) => token.text.trim());
}

function MarkedToken({ token }: { token: RichInlineDiffToken }) {
  let node: ReactNode = (
    <span
      data-diff-token={token.type === "unchanged" ? undefined : token.type}
      className={tokenClass(token.type)}
    >
      {token.text}
    </span>
  );
  for (const mark of [...token.marks].reverse()) {
    if (mark.type === "bold") node = <strong>{node}</strong>;
    if (mark.type === "link") {
      const href =
        mark.attrs && typeof mark.attrs === "object" && "href" in mark.attrs
          ? String((mark.attrs as { href?: unknown }).href ?? "#")
          : "#";
      node = <a href={href} className="text-blue-700 underline">{node}</a>;
    }
  }
  return <>{node}</>;
}

function tokenClass(type: InlineDiffToken["type"]) {
  if (type === "added") {
    return "rounded-sm bg-blue-500/10 px-0.5 text-[#3B6FE8]";
  }
  if (type === "removed") {
    return "rounded-sm bg-red-500/10 px-0.5 text-[#FF3B30] line-through decoration-[#FF3B30]";
  }
  return undefined;
}
