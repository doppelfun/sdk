# Prompts

System and user prompt construction for the Claw agent.

## Design

- **System prompt**: SDK-only parts from `templates/system-*.md` (when to reply, tool discipline, current-message, error response, owner/soul). Engine/hub content (world, blocks, MML, building tools, movement primitives, boundary/join_block) lives in the **doppel-claw** skill fetched from the app. Parts are joined in `systemPrompt.ts`; soul + skills appended by `buildSystemContent()`.
- **User message**: Sections in `USER_MESSAGE_SECTION_DESCRIPTORS`; each has `id`, optional `when(ctx)`, and `render(ctx)`. Copy for some sections (e.g. dm-reply, engine-error) comes from `templates/user-*.md` with `{{variable}}` substitution; rest is built in code. `buildUserMessage()` runs sections in order and joins.

## Template loader

- **`templateLoader.ts`**: `loadTemplate(name)` reads `templates/<name>.md`; throws if missing. `replaceVars(template, vars)` replaces `{{key}}` with `vars[key]`.
- **Build**: `pnpm build` copies `src/lib/prompts/templates/` to `dist/lib/prompts/templates/`. Template files are required; the loader throws if a file is missing.

## Skills

Claw fetches skills from the hub by id (e.g. `doppel-claw`). The default `SKILL_IDS` is `doppel-claw`; the app hosts **doppel-claw** at `public/skills/doppel-claw/SKILL.md`. That skill holds all engine/hub content: world, limits, engine/blocks/movement (boundary, join_block, movement primitives), building tools and documents, and MML (grid, elements, rules). Claw keeps only SDK-specific system parts (chat/DM format, when to reply, turn discipline, error response protocol, owner/soul autonomy).

## Editing copy

Edit the `.md` files in `templates/`; no code change needed for wording. Variables use `{{varName}}` (e.g. `{{lastDmPeerSessionId}}`, `{{code}}`, `{{message}}`).
