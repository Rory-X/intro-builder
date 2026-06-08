# Rich Text Polish Diff Display Spec

## Background

The rich-text polish flow now returns structured TipTap replacements and applies them safely after user confirmation. The suggestion panel still shows only the final `polishedText`, so users cannot quickly see what changed before clicking "应用润色".

## Goal

Show AI polish suggestions as a compact change summary in the existing candidate panel.

## Requirements

- Display meaningful original and polished text differences before the user applies the suggestion.
- Use compact delete/insert chips instead of rendering the whole rich-text field again.
- Filter whitespace-only and punctuation-only diff fragments so TipTap list spacing does not create visual noise.
- Keep the existing "应用润色" and "放弃" actions unchanged.
- Do not change Agent, BFF, autosave, TipTap apply semantics, database schema, or PDF rendering.
- Keep the panel compact enough for narrow editor columns.
- Fall back to plain polished text when a meaningful diff cannot be computed.

## Design

`RichTextEditor` captures the focused editor's current plain text when the polish request starts and stores it in the candidate once the response returns. `PolishCandidatePanel` renders a small `PolishDiffView` instead of raw `polishedText`.

The diff helper operates on plain strings and tokenizes Chinese text and punctuation at character granularity while keeping contiguous ASCII words and whitespace grouped. It uses a simple longest common subsequence over tokens, then converts the raw diff into display chips by keeping only non-empty delete/insert text with letters, numbers, or Chinese characters. The panel uses a neutral background, limits its height, and uses red/green only inside the chips.

## Acceptance Criteria

- The panel shows deleted original text and inserted polished text for a changed suggestion without rendering whitespace-only fragments.
- The panel keeps showing the final polished text behaviorally available through the existing apply path.
- Existing polish apply tests continue to pass.
