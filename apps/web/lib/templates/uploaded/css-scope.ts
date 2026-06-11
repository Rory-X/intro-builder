/**
 * Skill v2 模板的 CSS 隔离层。
 *
 * Claude 写的 CSS 没有上下文意识——它会写 `.section { padding: 24px }`，
 * 一旦输出到主页面会把 app 里所有 `.section` 都改了。auto-scope 通过给
 * 每个 selector 前置 `[data-template-id="<id>"]` 把作用域圈在模板根节点
 * 内（SlotRenderer 在外层包了 `<div data-template-id="...">`）。
 *
 * 简单字符串实现，覆盖 80% 用例（顶层规则、descendant 组合、伪类）。
 * 不引 PostCSS 依赖——后续真有复杂场景（@media / @keyframes / nested
 * selectors）再升级。
 *
 * Skill 写的 CSS 必须遵守：
 * 1. 不允许 @media / @keyframes / @supports / @import（throw）
 * 2. 不允许 universal selector（`*`）—— 会污染主页面所有元素
 * 3. 不允许 element-only selector（`body { ... }`）—— 同样污染
 *
 * 见 spec §4.6（CSS selector 限制）+ §9 风险表 R5/R6。
 */

export class CssScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CssScopeError";
  }
}

/**
 * Element selector 列表——这些写在 selector 链最外层（不带 class/id 限定）
 * 时会污染主页面，必须拒绝。允许 `.foo p`（descendant），不允许裸 `p`。
 */
const FORBIDDEN_BARE_ELEMENTS = new Set([
  "html", "body", "head", "main", "header", "footer", "nav", "aside",
  "section", "article", "div", "span", "p", "a", "ul", "ol", "li",
  "h1", "h2", "h3", "h4", "h5", "h6", "img", "table", "tr", "td", "th",
  "input", "button", "form", "label", "select", "textarea",
]);

/**
 * Prepend `[data-template-id="<id>"]` to every selector in `css`.
 *
 * Throws CssScopeError on forbidden constructs (at-rules, universal,
 * bare element selector). Caller catches and surfaces to Skill so it
 * can rewrite the offending CSS.
 */
export function scopeCss(css: string, templateId: string): string {
  const trimmed = css.trim();
  if (!trimmed) return "";

  // 1. Detect at-rules — v1 不支持
  const atRule = /@(media|keyframes|supports|import|font-face|page|namespace)/i.exec(trimmed);
  if (atRule) {
    throw new CssScopeError(
      `scopeCss: @${atRule[1]} not supported in v1; rewrite the CSS without it`,
    );
  }

  const scope = `[data-template-id="${cssEscape(templateId)}"]`;

  // 2. Walk top-level rules: `selector-list { body }`
  // Regex limitations: doesn't handle nested rules / strings with `{` / etc.
  // Skill v2 CSS is flat (no nesting per dual-constraint), so this is fine.
  return trimmed.replace(/([^{}]+)\{([^{}]*)\}/g, (_full, rawSelectors, body) => {
    const scoped = (rawSelectors as string)
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean)
      .map((selector: string) => scopeOneSelector(selector, scope))
      .join(", ");
    return `${scoped} { ${(body as string).trim()} }`;
  });
}

function scopeOneSelector(selector: string, scope: string): string {
  // Reject universal selector at the chain head: `* { ... }` or `* .foo`
  if (selector.startsWith("*")) {
    throw new CssScopeError(
      `scopeCss: universal selector (*) at chain head is forbidden — would pollute main app`,
    );
  }

  // Reject bare element selector at the chain head: `body { ... }` / `p .foo`
  // Allow `.card p` (descendant) — bare element only forbidden at HEAD.
  const headToken = selector.split(/[\s>+~]/, 1)[0]?.split(/[.#:[]/, 1)[0];
  if (headToken && FORBIDDEN_BARE_ELEMENTS.has(headToken.toLowerCase())) {
    throw new CssScopeError(
      `scopeCss: bare element selector "${headToken}" at chain head is forbidden — ` +
        `qualify with a class (e.g. ".my-card ${headToken}") to scope cleanly`,
    );
  }

  return `${scope} ${selector}`;
}

/** Escape characters that would break the attribute selector. */
function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}
