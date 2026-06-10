# Template Architecture Cleanup Design

## Problem

The current `main` branch still carries multiple generations of the resume and template model at the same time. The user-facing meaning has already moved to two concepts:

- `basic`: identity headline fields, currently name, target role, and job-search status.
- `profile`: icon-bearing profile/contact information, rendered through a contact loop.

The code and template protocol have not fully caught up. `ResumeContent` still exposes `basics`, template HTML still accepts `basics.*`, some docs still recommend `profile.name/title/status`, and the renderer still has compatibility paths for legacy `data-bind` usage. This makes the current architecture ambiguous: a template author can use several names for the same data, and runtime code must keep compatibility branches alive.

The goal is to make `main` represent only the current architecture, with no temporary dual model and no old template protocol.

## Desired Current Architecture

`ResumeContent` should expose two top-level objects:

- `basic`
  - `name`
  - `title`
  - `status`
- `profile`
  - `photo`
  - `email`
  - `phone`
  - `location`
  - `website`
  - `summary`

This is the only current content shape after migration. New code should not read or write `content.basics`.

The template slot protocol should expose:

- `basic.name`
- `basic.title`
- `basic.status`
- `profile.photo`
- `profile.summary`
- `profile.contacts`
- inside `profile.contacts`: `contact.type`, `contact.icon`, `contact.label`, `contact.href`

The template protocol should not expose `basics.*`, `basics.icon.*`, or `profile.name/title/status`. `profile` is for the icon-bearing profile/contact group and summary/photo, not for the identity headline.

`sectionOrder` should no longer use `basics` as a section id. The personal summary/profile section id is `profile`, replacing `sectionOrder: ["basics", ...]` with `["profile", ...]`.

Contact source fields remain scalar fields under `profile`:

- `profile.email`
- `profile.phone`
- `profile.location`
- `profile.website`

Templates derive `profile.contacts` from those scalar fields. The editor does not gain an arbitrary contact-list UI in this cleanup.

## Data Migration

This is not a compatibility layer. Existing persisted resume JSON must be migrated to the new shape by a one-time DB backfill before the current parser accepts it.

The migration should be explicit and one-way:

- Old `basics.name/title/status` move to `basic.name/title/status`.
- Old `basics.photo/email/phone/location/website/summary` move to `profile.photo/email/phone/location/website/summary`.
- Old `sectionOrder` entries equal to `basics` move to `profile`.
- Old Agent operation field paths such as `basics.summary` move to `profile.summary`.
- After migration, Zod parsing should validate only the current shape.

The application parser should reject raw `basics` as current content. The backfill script can reuse a pure migration helper, but active runtime code should not silently keep old rows working as a second architecture.

## Template Migration

Published template HTML in the database must be rewritten to the current protocol:

- `basics.name` and `profile.name` become `basic.name`.
- `basics.title` and `profile.title` become `basic.title`.
- `basics.status` and `profile.status` become `basic.status`.
- Direct contact fields `basics.email/phone/location/website` and `profile.email/phone/location/website` become a `profile.contacts` loop using `contact.icon`, `contact.label`, and `contact.href`.
- `basics.photo` becomes `profile.photo`.
- `basics.summary` becomes `profile.summary`.
- `basics.icon.*` is removed. Contact icons come from `contact.icon` inside the `profile.contacts` loop.
- The status row stays in the headline next to title, shares the same text style, and has no icon.

The migration should include a repeatable script and a strict verification gate. Running the script after a clean migration should report no changes needed.

## Renderer Cleanup

After DB templates and tests are migrated, the renderer should remove legacy runtime paths:

- Remove `BASICS_BINDINGS`.
- Remove `BASICS_ICON_BINDINGS`.
- Remove legacy arbitrary-element `data-bind` rendering.
- Remove direct contact linkification for old top-level contact slots.
- Keep only current slot and loop bindings.

If a template uses an old binding after this cleanup, it should fail verification before publishing. Runtime placeholders are acceptable for invalid templates, but the published template gate should prevent them.

## CSS Contract

Templates should use the current CSS variable contract for user-adjustable typography and spacing. Hardcoded values are allowed only for decorative/fixed regions where user controls are not expected to affect layout.

The verification gate should make this distinction explicit. At minimum, it should fail hardcoded body/content typography that bypasses:

- `--font-size`
- `--body-line-height`
- `--section-gap`
- `--item-gap`
- `--heading-gap`
- `--page-padding`
- `--photo-scale`

If the implementation needs decorative exceptions, they should be encoded as narrow selector allowlists with comments explaining the fixed region.

## Docs And Skill Cleanup

The public template authoring surface must describe only the current architecture:

- `docs/schema-v2/template-slot-fields.md`
- `docs/schema-v2/template-slot-fields.json`
- `docs/schema-v2/html-slot-protocol.json`
- `docs/schema-v2/example-template.html`
- `template-studio-skill/SKILL.md`
- `template-studio-skill/scripts/insert-template.ts`

These files should not list `basics.*` as deprecated-but-supported. They should reject it as invalid current protocol.

## Tests And Verification

The implementation should use TDD. The first failing tests should cover the new contract before production code changes:

- `ResumeContent` rejects `basics` as the current parsed shape and accepts `basic/profile`.
- content migration converts old `basics` input into `basic/profile`.
- slot binding renders `basic.*`, `profile.photo`, `profile.summary`, and `profile.contacts`.
- slot binding rejects or placeholders old `basics.*`, `basics.icon.*`, and `profile.name/title/status`.
- template verification fails old published HTML and passes migrated HTML.
- Agent allowed field paths use current paths only.

Final verification must run:

- focused tests for schema, migration, renderer, verifier, Agent field paths, autosave/editor behavior
- `scripts/verify-templates.ts`
- `scripts/maintain-template-db.ts`
- `pnpm test`
- `pnpm tsc --noEmit`
- `pnpm lint`
- `pnpm build`

Manual smoke should include editor preview, template library preview, PDF preview, and one Agent operation touching the profile/summary field path.

## Non-Goals

This work should not redesign the resume editor UI, add new visible fields, change the visual design of templates beyond protocol-required HTML/CSS normalization, or introduce new template engines.

Historical database migrations and old planning documents do not need to be rewritten. Active runtime code, current docs, current tests, current seed/demo data, and current published template rows do need to be cleaned.

## Fixed Decisions

The profile section id is `profile`.

Contact source fields stay scalar under `profile`, and template-only `profile.contacts` is derived at render time from those scalar fields.

The old `basics` object is not accepted as current parsed content after the DB backfill.
