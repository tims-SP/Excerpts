# Excerpts development roadmap

## beta.11 — v4 visual and interaction rework

- Compact flomo-like capture: collapsed default action bar, content-driven growth and subdued borders.
- Consistent Obsidian-native spacing and reading surfaces for cards, H2, tags and controls.
- Persistent capture/edit drafts in plugin data; dirty editors remain visible during search and preserve input nodes.
- H2 toggles render only the relevant region and remove repeated group headings.
- YAML tags safely updated without formatting unrelated properties; IME, invalid-tag and CRLF checks.
- Acceptance pending real Obsidian mobile keyboards and third-party themes; mock Chromium visual matrix used for regression.


## beta.11 — v3 component alignment

- Preserve the `.excerpts` FileView and normal Markdown notes.
- Render all H2 occurrences as individual lightweight collapsible groups.
- Restore in-card Markdown editing and a shared on-demand capsule tag picker.
- Write Markdown text and YAML tag properties in one conflict-checked Vault.process call.
- Refresh the mocked FileView screenshot/layout harness and regression coverage.
- Remaining: real Obsidian desktop/mobile and complex-reference verification.


## beta.9 — Direct .excerpts file homepage

- Registered `.excerpts` as a native Obsidian FileView entrypoint.
- The directory containing `首页.excerpts` is the only indexing scope.
- Restored beta.6's inline composer, recent feed, collapsed search and tag filtering, random recall and content-first card layout.
- Markdown file storage and native rendering retained; card sections come from arbitrary Markdown `##` headings.
- No legacy collections, collection IDs, migration, mandatory frontmatter, private attachments or navigation homepage.

## Acceptance remaining

Real Obsidian desktop / Android / iOS QA; 1k/10k note stress checks; complex cross-section Markdown references and embeds.
