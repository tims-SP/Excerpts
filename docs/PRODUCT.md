# Excerpts — product spec (Markdown-first beta.7)

Excerpts is a local-first Obsidian card view of ordinary Markdown files in one or more selected Vault folders.

## Essential experience

- Directly use an existing folder; .md files copied in are discovered with no imports or special metadata.
- One note equals one card, with optional H1 title and default body.
- Arbitrary `##` headings supply optional named sections (来源、变种、批注 are examples, not built-in schemas).
- Obsidian native Markdown rendering displays text, embeds, images, video, tables and links.
- Tags stay independent from sections and use native Obsidian metadata. Capsules support filtering and click-to-expand recommendations.
- A single Edit Markdown control opens the underlying .md file. New Markdown creates an empty note for native editing.
- No specialized attachment folder, editor forms or custom content database.

## Refresh and scale

Default event-driven updates; explicit manual refresh; configurable periodic check and batch size. Metadata-first listing, on-demand card hydration, at most four active reads, capped LRU memory and cancellable full-text search.

## Non-goals

Legacy Entry/Extra compatibility, automatic migration, private attachment management, remote sync, semantic search and custom full Markdown editing surfaces.

## Release acceptance

Run unit, TypeScript, smoke, UI and release checks in CI. Before stable release, perform genuine desktop/iOS/Android Obsidian acceptance and 1k/10k-note performance tests.
