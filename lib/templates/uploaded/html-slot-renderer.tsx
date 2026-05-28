import DOMPurify from "isomorphic-dompurify";
import parse, {
  domToReact,
  Element,
  type DOMNode,
  type HTMLReactParserOptions,
} from "html-react-parser";
import type { ReactElement } from "react";
import type { ResumeContent, StyleSettings } from "@/lib/resume-schema";
import type { TipTapJSON } from "@/lib/tiptap-types";
import { ResumeRichText } from "@/lib/templates/shared/resume-rich-text";
import {
  BASICS_BINDINGS,
  ITEM_BINDINGS,
  SECTION_BINDINGS,
  isLoopBinding,
  isValidBinding,
  resolveSection,
  deriveItems,
  type IterationContext,
} from "./slot-bindings";
import { scopeCss, CssScopeError } from "./css-scope";

/**
 * Skill v2 自由排版的核心渲染器。把 Claude 写的 HTML+CSS 转成 React 节点：
 *
 * 1. DOMPurify sanitize HTML（拒绝 <script> / on* / iframe 等）
 * 2. 提取 <template id="..."> 定义到 Map，从主 HTML 删除（spec §6.3 #2）
 * 3. CSS auto-scope（防主样式污染）
 * 4. html-react-parser visitor 替换 <slot> 元素
 *    - value slot → 替换为字符串 / RichText 节点
 *    - loop slot → 递归 parse template HTML，每次迭代更新 IterationContext
 * 5. 注入 styleSettings → CSS 变量
 *
 * 对 SSR / Puppeteer / Hydration 友好（同构无副作用纯函数）。
 *
 * 见 spec §5.2（接口）+ §4.3（slot 契约）+ §4.6（安全边界）。
 */

export type SlotRendererProps = {
  html: string;
  css: string | null;
  content: ResumeContent;
  styleSettings: StyleSettings;
  templateId: string;
};

/** DOMPurify whitelist —— spec §4.6 SAFE_TAGS */
const SAFE_TAGS = [
  "article", "header", "main", "section", "div", "span", "p",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "strong", "em", "a", "img", "time",
  "figure", "figcaption",
  // Skill v2 模板 schema 标签
  "template", "slot",
];
const SAFE_ATTRS = [
  "class", "id",
  "data-bind", "data-template",
  "src", "alt", "href", "title",
];

/** 嵌套深度上限 —— spec §6.3 #5 */
const MAX_NEST_DEPTH = 3;

export function SlotRenderer({
  html,
  css,
  content,
  styleSettings,
  templateId,
}: SlotRendererProps) {
  // 1. Sanitize HTML
  // Pre-step: HTML5 doesn't treat <slot /> as self-closing (it's not a void
  // element). Without this normalization, `<slot data-bind="x" />` becomes
  // `<slot data-bind="x">...rest of doc...</slot>` and the renderer eats
  // everything that follows. Convert <slot ... /> → <slot ...></slot>.
  const normalizedHtml = html
    .replace(/<slot\b([^>]*?)\/>/gi, "<slot$1></slot>")
    // React 19 escalates `<img src="">` from warning to dev-overlay error.
    // Skill v2 has no image-content mechanism yet — drop empty src so the
    // browser keeps the img as a placeholder shell instead of crashing render.
    .replace(/(<img\b[^>]*?)\s+src=(""|'')/gi, "$1");
  const cleanHtml = DOMPurify.sanitize(normalizedHtml, {
    ALLOWED_TAGS: SAFE_TAGS,
    ALLOWED_ATTR: SAFE_ATTRS,
    ADD_TAGS: ["template", "slot"],  // ensure not stripped
    ADD_ATTR: ["data-bind", "data-template"],
  });

  // 2. Extract <template id="..."> definitions and remove from main HTML.
  //    Web Components <template> elements have inert content; keeping them
  //    in the React tree would emit a real <template> DOM node and cause
  //    hydration warnings.
  const { mainHtml, templates } = extractTemplates(cleanHtml);

  // 3. CSS auto-scope (defensive: bail to no CSS if Skill wrote forbidden constructs)
  let scopedCss = "";
  if (css) {
    try {
      scopedCss = scopeCss(css, templateId);
    } catch (err) {
      if (err instanceof CssScopeError) {
        console.warn(`[SlotRenderer] CSS scope rejected for template=${templateId}:`, err.message);
      } else {
        throw err;
      }
    }
  }

  // 4. Build CSS variables for styleSettings (dual-constraint §4.2)
  const cssVars: Record<string, string> = {
    "--font-family": fontFamilyValue(styleSettings.fontFamily),
    "--font-size": `${styleSettings.fontSize}px`,
    "--line-height": String(styleSettings.lineHeight),
  };

  // 5. Sectioned LookupTable (memoized inside resolveSection per call) — pre-resolve
  const sectionIcons: Record<string, string> = {}; // template-level overrides not in v2 yet
  // Iteration context — empty at top level; populated as we descend into loops
  const rootCtx: IterationContext = {};

  // 6. Parse main HTML, walking nodes; replace <slot> elements
  const reactTree = parse(mainHtml, makeParserOptions({
    content, templates, ctx: rootCtx, depth: 0, sectionIcons,
  }));

  return (
    <div data-template-id={templateId} style={cssVars as React.CSSProperties}>
      {scopedCss && <style dangerouslySetInnerHTML={{ __html: scopedCss }} />}
      {reactTree}
    </div>
  );
}

// ─── Internals ────────────────────────────────────────────────────

type ParserCtx = {
  content: ResumeContent;
  templates: Map<string, string>;
  ctx: IterationContext;
  depth: number;
  sectionIcons: Record<string, string>;
};

function makeParserOptions(p: ParserCtx): HTMLReactParserOptions {
  const opts: HTMLReactParserOptions = {
    replace: (node: DOMNode) => {
      if (!isElement(node)) return undefined;
      if (node.name !== "slot") return undefined;
      return renderSlotElement(node, p);
    },
  };
  return opts;
}

function renderSlotElement(
  node: Element,
  p: ParserCtx,
): ReactElement {
  const binding = node.attribs?.["data-bind"];
  if (!binding) {
    return placeholder(`未指定 data-bind`);
  }
  if (!isValidBinding(binding)) {
    return placeholder(`未知 slot: ${binding}`);
  }

  // Loop slot
  if (isLoopBinding(binding)) {
    if (p.depth >= MAX_NEST_DEPTH) {
      return placeholder(`嵌套过深（>${MAX_NEST_DEPTH}）`);
    }
    const tplId = node.attribs?.["data-template"];
    if (!tplId) {
      return placeholder(`loop slot 缺 data-template: ${binding}`);
    }
    const tplHtml = p.templates.get(tplId);
    if (!tplHtml) {
      return placeholder(`模板未定义: ${tplId}`);
    }
    return <>{renderLoop(binding, tplHtml, p)}</>;
  }

  // Value slot — context-aware resolution
  if (binding in BASICS_BINDINGS) {
    const fn = BASICS_BINDINGS[binding as keyof typeof BASICS_BINDINGS];
    return <>{fn(p.content)}</>;
  }

  if (binding in SECTION_BINDINGS) {
    if (!p.ctx.section) {
      return placeholder(`ctx 不可用: ${binding}（必须在 sectionOrder loop 内）`);
    }
    const fn = SECTION_BINDINGS[binding as keyof typeof SECTION_BINDINGS];
    return <>{fn(p.ctx)}</>;
  }

  if (binding in ITEM_BINDINGS) {
    if (!p.ctx.item) {
      return placeholder(`ctx 不可用: ${binding}（必须在 section.items loop 内）`);
    }
    // Special: item.bullets returns TipTap doc → RichText render
    if (binding === "item.bullets") {
      const bullets = ITEM_BINDINGS["item.bullets"](p.ctx) as TipTapJSON;
      return <ResumeRichText content={bullets} />;
    }
    // Special: item.tags returns string[] → join
    if (binding === "item.tags") {
      const tags = ITEM_BINDINGS["item.tags"](p.ctx) as string[];
      return <>{tags.join(" · ")}</>;
    }
    const fn = ITEM_BINDINGS[binding as keyof typeof ITEM_BINDINGS];
    return <>{fn(p.ctx)}</>;
  }

  // Should be unreachable — isValidBinding covered all categories
  return placeholder(`unhandled binding: ${binding}`);
}

function renderLoop(
  loopName: string,
  tplHtml: string,
  p: ParserCtx,
): React.ReactNode {
  if (loopName === "sectionOrder") {
    const order = p.content.sectionOrder ?? [];
    const items = order
      .map((sectionId) => resolveSection(sectionId, p.content, p.sectionIcons))
      .filter((s): s is NonNullable<typeof s> => s !== null);
    return items.map((section, i) => {
      const childCtx: IterationContext = { ...p.ctx, section };
      return (
        <SlotChunk
          key={`section-${i}-${section.id}`}
          html={tplHtml}
          parserCtx={{ ...p, ctx: childCtx, depth: p.depth + 1 }}
        />
      );
    });
  }

  if (loopName === "section.items") {
    if (!p.ctx.section) {
      return placeholder(`section.items 必须在 sectionOrder loop 内`);
    }
    const items = deriveItems(p.ctx, p.content);
    return items.map((item, i) => {
      const childCtx: IterationContext = { ...p.ctx, item };
      return (
        <SlotChunk
          key={`item-${i}`}
          html={tplHtml}
          parserCtx={{ ...p, ctx: childCtx, depth: p.depth + 1 }}
        />
      );
    });
  }

  return placeholder(`未知 loop: ${loopName}`);
}

/**
 * Render a stretch of template HTML with the given iteration context.
 * Component (not just function) so React keys propagate cleanly.
 */
function SlotChunk({ html, parserCtx }: { html: string; parserCtx: ParserCtx }) {
  return <>{parse(html, makeParserOptions(parserCtx))}</>;
}

// ─── Template extraction ──────────────────────────────────────────

/**
 * Extract every `<template id="...">...</template>` block into a Map and
 * return the main HTML with those blocks removed. Critical for two reasons:
 * - Web Components <template> elements have inert content, so leaving them
 *   in the rendered tree wastes parsing.
 * - More importantly, html-react-parser would emit <template> DOM nodes
 *   that React hydrates, potentially causing SSR/CSR mismatches.
 *
 * Regex approach assumes templates are flat and don't nest other templates
 * (spec §6.3 #5: max 3 levels of nesting via slot, but template blocks
 * themselves are siblings).
 */
function extractTemplates(html: string): {
  mainHtml: string;
  templates: Map<string, string>;
} {
  const templates = new Map<string, string>();
  const re = /<template[^>]*\bid=["']([^"']+)["'][^>]*>([\s\S]*?)<\/template>/g;
  const mainHtml = html.replace(re, (_match, id: string, inner: string) => {
    templates.set(id, inner);
    return "";
  });
  return { mainHtml, templates };
}

// ─── Helpers ──────────────────────────────────────────────────────

function isElement(node: DOMNode): node is Element {
  return node instanceof Element;
}

function placeholder(msg: string): ReactElement {
  // Visible inline marker so Skill / reviewer immediately spots the problem
  return (
    <span
      style={{ color: "#dc2626", fontFamily: "monospace", fontSize: "0.85em" }}
      data-slot-error
    >
      [{msg}]
    </span>
  );
}

function fontFamilyValue(family: StyleSettings["fontFamily"]): string {
  switch (family) {
    case "serif":
      return `"PingFang SC", "Songti SC", Georgia, serif`;
    case "mono":
      return `"JetBrains Mono", "SF Mono", Consolas, monospace`;
    case "sans":
    default:
      return `-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif`;
  }
}

// Suppress unused import warning — domToReact may be needed if we extend
// the renderer later to handle children manually.
void domToReact;
