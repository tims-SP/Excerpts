# Excerpts / 摘录 — Product specification

Status: **working prototype v0.1.0**. This is a local-first Obsidian plugin, not a standalone app.

## Why it exists

Collect sentences, paragraphs, dialogue, notes, source variants, translations, and personal commentary in a pleasurable, lightweight reading feed. The plugin must not disturb the normal Obsidian UI outside explicitly selected collection pages.

## Product vocabulary

- **Collection / 收藏集**: a separately configured folder with a home Markdown file.
- **Entry / 条目**: one small saved piece of content, persisted as one Markdown file.
- **Extra / 附属内容**: any number of text sections linked to an Entry (source, variant, note, context, link, custom).
- **View / 展示视图**: card stream today; other layouts in future.
- **Preset / 预设**: a content template such as sentence, quotation, literary excerpt, or idea. The model is not hardwired to quotes.

## Core requirements

1. Multiple collections, user-selected root folders, user-controlled entry pages; no hardcoded user folder paths.
2. Only the registered home page renders the custom interface in Obsidian Reading view; all other files work normally.
3. Markdown remains the sole durable content format and lives within the collection folder.
4. Every Entry supports independent editable Extras and keeps authorial variants distinct from verified source quotations.
5. Fast single-field capture first. Optional labels, references and notes must not get in the way of saving a sentence.
6. Desktop and mobile single-column mode, adaptive controls, keyboard support.
7. Offline-first, no account and no mandatory remote service; Git sync occurs outside this plugin.
8. Corrupted boundaries must block writes, not silently overwrite existing content.

## Non-goals for v0.1

No LLM inference, cloud sync backend, global file-browser interception, modifying other Obsidian themes, custom Markdown editor takeover, database, full-text search outside a collection, native mobile app or OCR.

## Major interactions

- Add: select collection -> paste or type -> optional tags -> save -> card appears.
- Read: scroll/search/filter card stream -> expand Source/Variant/Note.
- Edit: open per-entry editor or add/edit one extra item -> save to original Markdown file.
- Recover: open any entry as ordinary Markdown when the plugin is disabled.

## Acceptance targets

- Ordinary vault notes, editor, sidebar and other plugins remain unaffected.
- All new files stay inside the collection's own designated folders.
- Source and alternate wording remain separately labeled; ambiguous provenance should never silently be treated as verified.
- A malformed extra marker disables plugin editing of that entry while retaining its raw Markdown.
- 1,000 entries: no more than 40 rendered cards in the first batch; future indexed search/perf profiling required.
- Device targets: Windows, Linux, macOS, Android, iOS. Desktop and mobile real-client acceptance is required before stable release.
