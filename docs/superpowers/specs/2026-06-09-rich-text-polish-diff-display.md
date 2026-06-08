# Rich Text Polish Diff Display Spec

## Background

The rich-text polish flow now returns structured TipTap replacements and applies them safely after user confirmation. The suggestion panel still shows only the final `polishedText`, so users cannot quickly see what changed before clicking "应用润色".

## Goal

Show AI polish suggestions as a compact single-column diff in the existing candidate panel.

## Requirements

- Display original and polished text differences before the user applies the suggestion.
- Use a single-column inline diff: unchanged text normal, deleted text with red-tinted strikethrough, inserted text with green-tinted highlight.
- Keep the existing "应用润色" and "放弃" actions unchanged.
- Do not change Agent, BFF, autosave, TipTap apply semantics, database schema, or PDF rendering.
- Keep the panel compact enough for narrow editor columns.
- Fall back to plain polished text when a meaningful diff cannot be computed.

## Design

`RichTextEditor` captures the focused editor's current plain text when the polish request starts and stores it in the candidate once the response returns. `PolishCandidatePanel` renders a small `PolishDiffView` instead of raw `polishedText`.

The diff helper operates on plain strings and tokenizes Chinese text and punctuation at character granularity while keeping contiguous ASCII words and whitespace grouped. It uses a simple longest common subsequence over tokens, which is sufficient for short resume fragments and avoids adding a dependency. The helper returns `equal`, `delete`, and `insert` parts that the panel renders with accessible inline text.

## Acceptance Criteria

- The panel shows deleted original text and inserted polished text for a changed suggestion.
- The panel keeps showing the final polished text behaviorally available through the existing apply path.
- Existing polish apply tests continue to pass.
