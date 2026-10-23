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

## Recoverable deletion (v0.2 development)

- Deleting an entire Entry **renames** its existing Markdown file with `Vault.rename` into a collection-local `Excerpts-Recycle/` directory. The bytes, custom frontmatter and trailing notes remain unchanged. The folder is outside `Cards/`, so archived entries disappear from the active stream without being destroyed.
- A native Obsidian confirmation modal is mandatory for the user-facing archive action. Never invoke `Vault.delete` for it.
- In-session undo holds a temporary receipt containing original/archive paths, immutable entry IDs and original raw bytes. Undo refuses to overwrite an occupied source path or silently move an externally changed archive. If the session ends, the Markdown file remains in `Excerpts-Recycle/` for manual recovery.
- Both archive and restore validate collection ownership and path scope. Archive refuses a stale entry snapshot or read-only damaged Markdown. They do not claim atomic cross-process protection against a concurrent external rename or write; these remain sync-race limitations to test in actual clients.
- Removing an individual Extra now has a one-item in-session undo token. Undo uses `Vault.process` and the post-delete snapshot, so a newer edit cannot silently be overwritten. The token is not persistent; preserve permanent edit history through Git or file backups.
- All collection content remains Markdown. No archived content or drafts are duplicated into plugin `data.json`.


## Recoverable editing drafts (v0.2 development)

- Quick capture and main Entry quote editor auto-backup their inputs after roughly 350 ms of idle typing to Markdown notes under `<workspace>/Excerpts-Drafts/`. These files are separate from the authoritative `Cards/` Entry documents and never copied into plugin settings or a remote service.
- A new random draft ID is created per editor session; two windows never intentionally share an editable backup file. Draft writes use `Vault.process` and compare the entire expected serialized note before modification, refusing externally edited backups.
- Draft notes contain a readable heading and a fenced JSON payload for exact Unicode/Markdown text round trips. Malformed, foreign-collection or noncanonical records are ignored by automatic recovery and left available for manual inspection.
- The workspace presents explicit recovery actions; it never silently replaces existing composer text. For Entry drafts, the original Entry revision snapshot is checked before loading. A changed current Entry opens a read-only conflict preview, never a write operation.
- When a save or explicit cancel completes, the corresponding draft backup is moved into `Excerpts-Drafts/Resolved/`, retaining a manual recovery history. Files are not permanently deleted by the plugin.
- Editing begun before an external modification is guarded by an original revision snapshot even after UI rerender. Both quote and Extra editors refuse stale saves. This supplements the repository's atomic `Vault.process` check.
- **Limitations:** automatic backup can miss the last ~350 ms of typing if the app is killed before a scheduled Vault write; unload only attempts a final async flush. Draft persistence currently covers **quick capture and main quote editing**, not the six Extra editors. A completed save can leave a resolved backup behind if moving it fails; this is reported. The real Obsidian client/storage/sync behavior remains unverified.

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
