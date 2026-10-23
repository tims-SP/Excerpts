# Excerpts — Markdown-first architecture (beta.7)

## Single source of truth

The only excerpt data source is an ordinary Markdown file within the selected Vault folder. Excerpts does **not** use Entry IDs, mandatory frontmatter, private Cards/Attachments folders, or extra-item boundary comments. There is no migration or legacy codec.

- `src/model.ts`: workspace settings and lightweight card metadata.
- `src/repository.ts`: scoped file discovery via `Vault.getMarkdownFiles()`, bounded lazy content reads, normal frontmatter mutations, batched full-text search.
- `src/codec.ts`: read-only Markdown section parser. It never serializes or updates a document.
- `src/view.ts`: card chrome, search, tags, section selector, lifecycle, MarkdownRenderer.
- `src/collection-view.ts`: native Obsidian ItemView.
- `src/main.ts`: collection management, file events and optional scheduled refresh.
- `src/settings.ts`: collection folder and refresh controls.

## Display rules

One .md file is one card. A leading H1 is an optional title. Content outside H2 sections is the default body; `## 正文` contributes to that body. Any other H2 creates a selectable section. Repeated H2 names are combined in their original order. Headings within fenced code blocks are not considered sections.

Card body and selected section content are passed as Markdown fragments to `MarkdownRenderer.render(app, markdown, container, originalPath, component)`; links and embeds use the original file path. Media and attachments are not copied into plugin-owned storage.

Tags come from Obsidian MetadataCache (frontmatter and inline tags). Frontmatter additions use `FileManager.processFrontMatter`. Inline tag removal is directed to the native editor. Optional favorite status is the standard frontmatter property `favorite: true`.

## Performance

File lists are indexed from Vault file and metadata caches, not by reading every Markdown file. An IntersectionObserver loads visible cards (with a bounded fallback). At most four file reads are active at a time. Repository content cache is limited to 50 items and ~8 MiB of UTF-16 text. Full-text search runs only when requested, with cancellation checks and batches. Vault events are debounced at 1.5 seconds; auto-refresh can be disabled. Optional scheduled validation runs only while an excerpt pane is visible.

## Safety

Displaying or refreshing a collection never alters its Markdown files. Remove Collection deletes the collection's settings entry only. New Markdown creates an empty ordinary note and opens the Obsidian editor. No plugin-owned attachment lifecycle or private trash/draft folders are created.

## Known limits

Actual Obsidian desktop and mobile tests remain necessary. Markdown fragments can differ from a full-document render when link references or other definitions cross H2 boundaries. The fallback and integration behavior should be tested with complex Markdown fixtures before stable release.
