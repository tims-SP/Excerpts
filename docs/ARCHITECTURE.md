# Excerpts — Architecture

An `.excerpts` file is an Obsidian FileView entrypoint; its parent folder defines the Markdown scope.
Each ordinary `.md` file is one excerpt. Markdown stays the only source of truth. Saved `.excerpts`
views store a tag/query filter, not an independent collection.

## Modules

- `src/main.ts`: plugin commands, exclusive metadata-scan owner, Vault invalidations,
  preview-mode and editing-mode Markdown openers.
- `src/home-view.ts`: lifecycle of an `.excerpts` FileView.
- `src/view.ts`: capture composer, date timeline, tags, H2 disclosures, selection and deletion,
  card preview behavior, and the integration with virtual rows.
- `src/virtual-list.ts`: single-scroll-container virtualization, row reuse, buffer selection,
  resize handling, mounted-row disposal and scroll-anchor compensation.
- `src/height-index.ts`: Fenwick tree for O(log n) row-height updates and scroll-offset lookup.
- `src/card-preview.ts`: read-only media classification, preview ceilings and safe-expand decisions.
- `src/repository.ts`: batched metadata scans, bounded parsed-Markdown and search-text caches,
  file creation, frontmatter edits and checked Trash deletion.
- `src/codec.ts`: read-only Markdown H1/H2 display boundaries.

## Feed and reading

The composer, filter toolbar and entire date-grouped feed share one `.excerpts-native-host`
scroll container. Desktop date rails remain left of cards; mobile date labels remain above them.
The timeline has no page numbers or manual load-more button. The logical row index contains
the full sorted/filter-matched dataset, while the DOM contains only the viewport and buffered
rows. Batch count is automatic from measured heights and viewport size, or fixed at 16/32/64/96
from settings; it never truncates the visible region. Up to four Markdown hydration tasks run
concurrently. Leaving the buffer disposes the corresponding MarkdownRenderChild.

Previews have content-specific height ceilings; short notes keep their natural height. Safe
bodies can expand within a card. Oversized bodies or H2 sections route to the native Markdown
Reading view (`mode: "preview"`) without editor focus. Editing stays a separate native
source-mode action. Markdown files and embedded media are never rewritten for the card layout.

## Indexing and safety

The existing manual index-refresh model is unchanged. Initial metadata scanning and explicit
refresh process 32/64/128/256 files per yield (default 64), report progress and cancel safely.
A plugin-level exclusive scan lock remains held until the scan has actually settled. Vault
changes invalidate relevant cached content and mark the displayed snapshot stale; they do not
launch an automatic scan. Search runs against the full committed index in cancellable batches;
normalized text reuse has bounded memory. Selection and deletion use the full filtered path
snapshot, not the virtualized DOM. Editing and destructive-operation guards remain authoritative.

When indexing is blocked, stale or failed, the existing page-status hint presents
the specific prerequisite and a direct **刷新摘录** action once the operation guard
permits it. An active search first exposes **清除搜索**; clearing never
automatically starts a scan. Bulk selection, tag edits and work in another
Excerpts view still block refresh until their owners finish or explicitly exit.
The hint also explains tag-editing, bulk-selection and cross-page navigation
guards while the underlying index is otherwise ready; it never bypasses them.
The hint updates when the existing owner lock changes, without polling,
replaying a refused operation or creating a second queue. Invalid views remain
read-only, with instructions to copy unsaved drafts and reopen the original entry.

## Verification

`npm run verify` runs unit/UI checks, builds the plugin, smoke-checks the output and verifies
release files. `npm run ui` includes 10,000/30,000-row virtualization checks, viewport scroll
restoration, native preview-mode entry and card-preview classification. Browser visual checks
are separate; mock DOM tests do not validate native Obsidian media rendering on real devices.
