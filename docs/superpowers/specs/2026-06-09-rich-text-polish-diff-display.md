# Rich Text Polish Diff Display Spec

## Background

The rich-text polish flow now returns structured TipTap replacements and applies them safely after user confirmation. The suggestion panel still shows only the final `polishedText`, so users cannot quickly see what changed before clicking "应用润色".

## Goal

Show AI polish suggestions as compact single-line text diffs in the existing candidate panel.

## Requirements

- Display meaningful original and polished text differences before the user applies the suggestion.
- Display real surrounding text so users can see where each change happened.
- Use single-line diff rows with inline deleted and inserted spans.
- Filter whitespace-only and punctuation-only diff fragments so TipTap list spacing does not create visual noise.
- Keep the existing "应用润色" and "放弃" actions unchanged.
- Do not change Agent, BFF, autosave, TipTap apply semantics, database schema, or PDF rendering.
- Keep the panel compact enough for narrow editor columns.
- Fall back to plain polished text when a meaningful diff cannot be computed.

## Design

`RichTextEditor` captures both the focused editor's plain text and original TipTap JSON when the polish request starts, then stores them in the candidate once the response returns. `PolishCandidatePanel` renders a small `PolishDiffView` instead of raw `polishedText`.

When the Agent returns `replacementTiptapJson`, the display compares original and replacement TipTap text blocks one by one, so list structure and blank lines do not become visible diff noise. Each changed block renders as one single-line row with short surrounding context, deleted text in red strikethrough, and inserted text in green. If structured replacement data is unavailable or mismatched, the display falls back to a single normalized plain-text diff row.

## Acceptance Criteria

- The panel shows single-line diff rows with context, deleted original text, and inserted polished text.
- The panel does not render whitespace-only fragments.
- The panel keeps showing the final polished text behaviorally available through the existing apply path.
- Existing polish apply tests continue to pass.
