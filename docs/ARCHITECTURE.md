# Excerpts — beta.11 architecture

## Main invariant

The `.excerpts` file is an Obsidian **FileView navigation entry**. It stores no excerpt content or collection ID. Its parent folder is the read/write scope, and any `.md` file beneath that folder (including nested ones when enabled) is one card. The file tree and Markdown vault remain the source of truth.

- `src/main.ts`: registers extension with `registerExtensions(["excerpts"], "excerpts-home-file")`, manages file events, last-used homepage and commands.
- `src/home-view.ts`: native `FileView` binding the opened file's parent path to a scoped card renderer. Opening any `.excerpts` file immediately opens the complete timeline; no collection chooser.
- `src/view.ts`: beta.6 flomo-like homepage chrome (quick capture, recent feed, collapsible search and tag filtering, random recall). Card bodies and occurrence-keyed H2 groups render using `MarkdownRenderer` with the source note path. The in-card source editor and progressive TagPicker do not introduce Entry/Extra schemas.
- `src/repository.ts`: Vault folder file discovery, bounded lazy cache, batched full text searches, quick capture writing plain Markdown and optional standard YAML tags, favorite edits, and one atomic `Vault.process` for inline Markdown + YAML tag changes with byte-for-byte stale-source guards.
- `src/codec.ts`: read-only Markdown section extraction; repeated and section-only H2 headings are preserved. `src/tag-editor.ts`: reusable capsule tags, on-demand suggestions, IME-safe keyboard flow.
- `src/settings.ts`: create/open `首页.excerpts` in a selected folder, global display and refresh settings.

There are no collection IDs, managed Cards or Attachments directories, Entry/Extra schema, migration flow, or intermediate home navigation view. `data.json` contains only global UI/sync preferences and a last-opened homepage path.

## Lifecycle and performance

Opening a `.excerpts` file creates a `MarkdownRenderChild`. Closing/swapping a file unloads the child and its nested Markdown render components. Vault changes are debounced. Initial page cap is 40 cards, hydrated with `IntersectionObserver` when available, and repository reads have a concurrent limit of four. Full-text search is delayed, batched and cancellable; rendered Markdown cache is bounded.

## Limitations for acceptance

Real Obsidian clients must confirm FileView registration on desktop and mobile, scoped media/embed rendering, touch menu behavior and performance. Markdown references spanning separate H2 sections can require further refinement.

## Locked interaction contract

See [UI_CONTRACT_V3.md](UI_CONTRACT_V3.md). Do not regress to a separate entry editor, collection schema, or comma-only tags.

## v4 durability

`src/main.ts` serializes settings and editor/capture drafts in plugin data. `src/view.ts` preserves active editor DOM through search and refresh, while H2 clicks replace only their sections. `src/repository.ts` performs a conflict-checked atomic note write and surgically changes the YAML `tags` field. No migration layer is introduced.
