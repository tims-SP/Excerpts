# Excerpts architecture & data invariants

## Layers

```
Obsidian Vault (Markdown + attachments)
  ↑ Vault API / process
EntryRepository (guarded read/write)
  ↑ Entry / Extra data model
MarkdownCodec (parse, serialize, patch)
  ↑
Collection renderer (Markdown codeblock, DOM & scoped CSS)
  ↑
Collection settings (persistent data.json, no implicit migration)
```

## File topology

A workspace root is selected by the user. Relative default names `首页.md`, `Cards/`, `Attachments/` are generated during creation; the root folder is **never** preselected by the plugin. Multiple workspaces are disjoint. The entry path is authoritative and must match `ctx.sourcePath` as well as the workspace ID inside its code block.

## Data format

`Entry` has `id`, `collectionId`, `created`, `updated`, `favorite`, `tags`, `text`, `extras`, and runtime `path`. The frontmatter stores immutable IDs and entry metadata; the first blockquote is the primary excerpt. Extras are ordinary Markdown sections with HTML comment markers delimiting each owned item.

### Invariants

- Stable identity is UUID-like random content rather than filenames or title text.
- `excerpts_id` and `excerpts_collection` must match on every update.
- Extra IDs are unique inside each entry.
- Editing an entry never deletes unrelated frontmatter or appends outside the managed extras section.
- Use `Vault.process()` to update based on latest contents.
- A duplicate, missing, unknown or malformed managed marker blocks auto-writing.
- UI renders user strings as text rather than unsafe HTML.
- Destroying a workspace setting must never delete notes.
- Folder repoint is a logical data-source switch, **not a file move**.
- Renaming a containing parent folder updates the configured root path.

## Implementation choices (v0.1)

- TypeScript, native DOM, CSS vars, `registerMarkdownCodeBlockProcessor`, `MarkdownRenderChild`.
- No React dependency yet: lightweight vanilla DOM is adequate for v0.1, makes building mobile-safe and minimizes bundle size. A future framework migration can replace the renderer without touching repository and codec.
- Read paths are bounded by the workspace's Cards directory, using batched reads, up to 40 initially rendered cards.
- Obsidian settings store only collection configuration; content is never duplicated into `data.json`.
- No arbitrary file requests or file-system APIs; everything goes through Obsidian Vault.

## Known edge cases / planned hardening

1. Merge conflicts and concurrently edited records: `Vault.process` prevents stale single-process writes but cannot resolve Git/Sync conflicts; explicit conflict UI is future work.
2. Markdown outside the canonical generated structure: preserve unowned trailing content, but current parser is designed for generated records rather than arbitrary notebook imports.
3. Embedding the renderer in Reading view: not a full-screen custom tab yet; future optional ItemView can reuse the same UI.
4. Source-level HTML comments inserted by users can conflict with managed delimiters; fail-closed validation is in place, but a stricter Markdown AST codec may follow.
5. Large vault indexing and smartphone performance: benchmark a 1k/10k fixture, consider incremental index before enabling features that touch all files.
6. External links and Obsidian wikilinks in extra content are stored as Markdown but not yet rendered as interactive links inside cards.
