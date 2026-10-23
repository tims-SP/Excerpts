# Excerpts — Product specification (beta.11)

A local-first Obsidian timeline for **capturing, reading and finding** excerpts. One normal `.md` file is one card; `首页.excerpts` is a real FileView entrypoint for its parent folder.

## Homepage

1. A small “摘录” title and compact, focus-expandable Markdown capture textarea. Optional tags are revealed only on request and have suggestions.
2. Newest-first single-column cards. Search is collapsed until requested; tag filtering is a direct icon action.
3. Content first. Render body and ordinary Markdown media embeds using Obsidian's MarkdownRenderer. H1 is optional; ordered H2 headings remain expandable sections, including repeated or initially empty sections.
4. Tags are independently editable as capsules, with continuous suggestions and custom creation. Each card has one edit action for in-card editing of the original Markdown. Save checks for external file changes and Cancel leaves the source untouched.
5. Date appears in the quiet footer. No per-card bookmark/favorite, shuffle recall, duplicate “add content” menu, or duplicate edit/copy/refresh menu.

## Storage

Markdown files and Vault attachments are the source of truth. Frontmatter is optional; tags are standard YAML. No collection IDs, private attachments, custom Entry/Extra schema or content migration.

## Preferences and refresh

Settings manage only the home entry and whether subfolders are included. Vault events trigger automatic refresh; a command is available for manual refresh. Newest-first sorting and batched search are internal defaults rather than user-facing tuning.

## Acceptance

Run unit, UI and build checks. Validate narrow-pane layout, large Vaults, embedded media, keyboard and touch states in real Obsidian on desktop and mobile before stable release.
