# 摘录 / Excerpts

A lightweight, local-first Obsidian Markdown card reader.

## Design (v0.2.0-beta.7)

- **One Markdown file = one card.** Point a collection at any existing Vault folder; Markdown files copied into it show up immediately after a refresh. No private Entry/Extra schema, Cards directory, attachment database, or import conversion.
- H1 is an optional card title. The content before the H2 headings is the default body. Arbitrary H2 headings become optional card sections; \`## 正文\` joins the default body.
- Card content uses Obsidian \`MarkdownRenderer.render()\` to display Markdown and embeds in the same path context as its source file. Custom card UI handles sections, tags, favorites and edit entry points.
- Tags use Obsidian's metadata cache. Clicking a capsule filters cards. Adding tags edits standard Frontmatter \`tags\`; removing an inline \`#tag\` requires editing the Markdown.
- **Edit Markdown** opens the actual file in Obsidian's editor. **New Markdown** creates an empty \`.md\` in the selected folder, then opens it.
- File updates can be event driven or manual; optional periodic verification is available. Listing uses Vault metadata, cards render on demand, content cache is bounded and full-text search scans in cancellable batches.
- No custom attachment management. Embeds and relative links use ordinary Obsidian Markdown conventions.
- Collection removal deletes only plugin settings, not source notes.

## Setup

Install \`main.js\`, \`manifest.json\`, \`styles.css\` in \`.obsidian/plugins/excerpts/\`.
Enable the plugin, then open Settings → Excerpts to add a collection name and a Vault-relative folder path.
Existing folders are used as-is. Folders that do not exist are created without populating them with private schema files.
Use the command **打开摘录收藏集** or the settings button to view the collection.

## Notes

This beta intentionally makes a **breaking change** from the pre-beta.7 Entry/Extra workflow. There is no legacy migration or compatibility layer. Files are never converted or rewritten merely by opening a collection.

No official desktop/Android/iOS acceptance testing has yet been completed. Test on a copy of your Vault before relying on the beta.
