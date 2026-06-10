const TITLE_SLOT_RE =
  /<slot\b[^>]*\bdata-bind=["'](?:profile|basics)\.title["'][^>]*>(?:\s*<\/slot>)?/i;
const STATUS_SLOT_RE =
  /<slot\b[^>]*\bdata-bind=["'](?:profile|basics)\.status["'][^>]*>(?:\s*<\/slot>)?/i;
const STATUS_SLOT_RE_GLOBAL =
  /<slot\b[^>]*\bdata-bind=["'](?:profile|basics)\.status["'][^>]*>(?:\s*<\/slot>)?/gi;
const CLOCK_ICON_SLOT_RE =
  /<slot\b[^>]*\bdata-bind=["']basics\.icon\.Clock["'][^>]*>(?:\s*<\/slot>)?/gi;
const TITLE_BINDING_RE = /data-bind=["'](?:profile|basics)\.title["']/i;
const NON_STATUS_PROFILE_BINDING_RE =
  /data-bind=["'](?:profile|basics)\.(?:name|email|phone|location|website|photo|summary)["']|data-bind=["']profile\.contacts["']/i;
const PROFILE_STATUS_CLASS_RE = /\bclass=["'][^"']*\bprofile-status\b/i;

export const PROFILE_HEADLINE_PATCH_MARKER =
  "intro-builder template db patch 2026-06 profile headline";

export const PROFILE_HEADLINE_STATUS_HTML =
  '<span class="profile-status"><span class="profile-sep"> · </span><span class="profile-status-value"><slot data-bind="profile.status"></slot></span></span>';

export const PROFILE_HEADLINE_CSS = `

/* ${PROFILE_HEADLINE_PATCH_MARKER}: title/status share one inline headline, no icon */
.profile-status {
  display: inline;
  font: inherit;
  color: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
}
.profile-status-value {
  font: inherit;
  color: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
}
.profile-status:has(.profile-status-value:empty),
.profile-status-value:empty {
  display: none;
}
.profile-sep {
  font: inherit;
  color: inherit;
  opacity: 0.72;
}
`;

type HtmlNode = {
  tag: string;
  start: number;
  openEnd: number;
  end: number;
  closeEnd: number;
};

export type ProfileHeadlineIssue =
  | "missing-title"
  | "missing-status"
  | "duplicate-status"
  | "status-not-in-profile-headline"
  | "status-clock-icon";

export function normalizeProfileHeadlineHtml(html: string): string {
  if (!TITLE_SLOT_RE.test(html)) return html;

  const withoutClockIcons = html.replace(CLOCK_ICON_SLOT_RE, "");
  const withoutStatus = removeStatusOccurrences(withoutClockIcons);
  const normalizedTitle = withoutStatus.replace(
    TITLE_SLOT_RE,
    `<slot data-bind="profile.title"></slot>${PROFILE_HEADLINE_STATUS_HTML}`,
  );
  return cleanupSeparators(collapseEmptyInlineElements(normalizedTitle));
}

export function checkProfileHeadlineHtml(html: string): ProfileHeadlineIssue[] {
  const issues: ProfileHeadlineIssue[] = [];
  if (!TITLE_SLOT_RE.test(html)) issues.push("missing-title");

  const statusMatches = html.match(STATUS_SLOT_RE_GLOBAL) ?? [];
  if (statusMatches.length === 0) {
    issues.push("missing-status");
  } else if (statusMatches.length > 1) {
    issues.push("duplicate-status");
  }

  if (/data-bind=["']basics\.icon\.Clock["']/i.test(html)) {
    issues.push("status-clock-icon");
  }

  if (statusMatches.length === 1) {
    const statusIndex = html.search(STATUS_SLOT_RE);
    const statusNode = findSmallestAncestor(html, statusIndex, (node) =>
      PROFILE_STATUS_CLASS_RE.test(html.slice(node.start, node.openEnd)),
    );
    if (!statusNode) issues.push("status-not-in-profile-headline");
  }

  return issues;
}

function removeStatusOccurrences(html: string): string {
  let next = html;
  for (let i = 0; i < 20; i++) {
    const match = STATUS_SLOT_RE.exec(next);
    if (!match || match.index === undefined) return next;

    const statusIndex = match.index;
    const profileStatusNode = findSmallestAncestor(next, statusIndex, (candidate) =>
      PROFILE_STATUS_CLASS_RE.test(next.slice(candidate.start, candidate.openEnd)),
    );
    const node =
      profileStatusNode ??
      findLargestAncestor(next, statusIndex, (candidate) => {
        const nodeHtml = next.slice(candidate.start, candidate.closeEnd);
        return (
          !TITLE_BINDING_RE.test(nodeHtml) &&
          !NON_STATUS_PROFILE_BINDING_RE.test(nodeHtml)
        );
      });

    const range = node
      ? expandToAdjacentSeparator(next, node.start, node.closeEnd)
      : expandToAdjacentSeparator(next, match.index, match.index + match[0].length);
    next = `${next.slice(0, range.start)}${next.slice(range.end)}`;
  }
  return next;
}

function findSmallestAncestor(
  html: string,
  index: number,
  predicate: (node: HtmlNode) => boolean,
): HtmlNode | null {
  const candidates = collectNodes(html)
    .filter((node) => node.start <= index && index < node.closeEnd)
    .sort((a, b) => a.closeEnd - a.start - (b.closeEnd - b.start));
  return candidates.find(predicate) ?? null;
}

function findLargestAncestor(
  html: string,
  index: number,
  predicate: (node: HtmlNode) => boolean,
): HtmlNode | null {
  const candidates = collectNodes(html)
    .filter((node) => node.start <= index && index < node.closeEnd)
    .filter(predicate)
    .sort((a, b) => b.closeEnd - b.start - (a.closeEnd - a.start));
  return candidates[0] ?? null;
}

function collectNodes(html: string): HtmlNode[] {
  const nodes: HtmlNode[] = [];
  const stack: Array<Omit<HtmlNode, "end" | "closeEnd">> = [];
  const tagRe = /<\/?([a-zA-Z][\w:-]*)([^>]*)>/g;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(html)) !== null) {
    const full = match[0];
    const tag = match[1].toLowerCase();
    if (full.startsWith("<!--") || full.startsWith("<!")) continue;
    if (full.startsWith("</")) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag !== tag) continue;
        const open = stack.splice(i, 1)[0];
        nodes.push({
          ...open,
          end: match.index,
          closeEnd: tagRe.lastIndex,
        });
        break;
      }
      continue;
    }
    if (full.endsWith("/>") || isVoidTag(tag)) continue;
    stack.push({
      tag,
      start: match.index,
      openEnd: tagRe.lastIndex,
    });
  }

  return nodes;
}

function isVoidTag(tag: string): boolean {
  return ["img", "br", "hr", "input", "meta", "link"].includes(tag);
}

function expandToAdjacentSeparator(
  html: string,
  start: number,
  end: number,
): { start: number; end: number } {
  let nextStart = start;
  let nextEnd = end;
  const before = html.slice(0, nextStart);
  const after = html.slice(nextEnd);

  const prevSep = before.match(
    /(?:\s*(?:[·|/,-]\s*)|\s*<span\b[^>]*class=["'][^"']*(?:sep|separator|dot)[^"']*["'][^>]*>[\s\S]*?<\/span>\s*)$/i,
  );
  const nextSep = after.match(
    /^(?:\s*(?:[·|/,-]\s*)|\s*<span\b[^>]*class=["'][^"']*(?:sep|separator|dot)[^"']*["'][^>]*>[\s\S]*?<\/span>\s*)/i,
  );

  if (prevSep) nextStart -= prevSep[0].length;
  else if (nextSep) nextEnd += nextSep[0].length;

  return { start: nextStart, end: nextEnd };
}

function collapseEmptyInlineElements(html: string): string {
  let next = html;
  for (let i = 0; i < 20; i++) {
    const collapsed = next.replace(
      /<(span|div|p)\b([^>]*)>\s*<\/\1>/gi,
      "",
    );
    if (collapsed === next) return next;
    next = collapsed;
  }
  return next;
}

function cleanupSeparators(html: string): string {
  return removeSeparatorAfterProfileStatus(html);
}

function removeSeparatorAfterProfileStatus(html: string): string {
  let next = html;
  let cursor = 0;
  while (cursor < next.length) {
    const index = next.indexOf(PROFILE_HEADLINE_STATUS_HTML, cursor);
    if (index < 0) return next;
    const afterStart = index + PROFILE_HEADLINE_STATUS_HTML.length;
    const after = next.slice(afterStart);
    const sep = after.match(
      /^\s*<span\b[^>]*class=["'][^"']*(?:sep|separator|dot)[^"']*["'][^>]*>[\s\S]*?<\/span>/i,
    );
    if (sep) {
      next = `${next.slice(0, afterStart)}${next.slice(afterStart + sep[0].length)}`;
      cursor = afterStart;
    } else {
      cursor = afterStart;
    }
  }
  return next;
}
