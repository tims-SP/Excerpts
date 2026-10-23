# Excerpts — Architecture (beta.10)

A `.excerpts` file is an Obsidian FileView entrypoint. Its parent directory determines the Markdown scope. Each regular `.md` file becomes one card in the timeline; the original file stays authoritative.

- `src/main.ts`: extension registration, Vault file events, latest home entry, commands and minimal settings.
- `src/home-view.ts`: binds the entry FileView to the renderer.
- `src/view.ts`: small capture composer, newest-first feed, collapsed search, tag capsules and filtering, expandable H2 sections, single card edit action.
- `src/repository.ts`: file listing, bounded cache, fixed-size batched full-text search, plain Markdown creation and standard YAML tag updates.
- `src/codec.ts`: read-only extraction of display boundaries for H1 and H2.
- `src/settings.ts`: create and open home files; optional recursive scope.

There is no collection model, favorite state, random recall or custom attachment store. MarkdownRenderer renders card content in the original source path context.

## Lifecycle

Opening or closing a home file attaches or detaches the nested MarkdownRenderChild. Vault events trigger debounced refresh. The force-refresh command rebuilds indexes; manual polling is not needed. Up to 40 cards initially load; IntersectionObserver hydrates visible cards and repository reads have a concurrency cap of four. Search is batched, debounced and cancellable.

## QA

Mock-based UI tests are not a replacement for real Obsidian rendering and interaction tests. The old standalone screenshot scripts target removed Entry/Extra editors and should not be treated as current acceptance tests.
