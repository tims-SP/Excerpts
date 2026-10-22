# Roadmap and acceptance matrix

## V0.1 — local collectible prototype

| Track | Implementation | Current state |
|---|---|---|
| Configurable disjoint workspaces | PluginSettingTab; create/replace/remove | Implemented; client UI unverified |
| Entry file format | frontmatter + blockquote + extras markers | Implemented; codec tests pass |
| Card stream / search / tags | single column, filter, sort, 40/page | Implemented; Chromium mock verified |
| Extras editor | source / variant / note / context / link / custom | Implemented; add/edit/delete extras |
| Data safety | path guard, Vault.process, protected malformed entries | Implemented; further scenarios required |
| CI & build | types + esbuild + unit tests + smoke | Implemented |
| Real Obsidian client check | desktop and Android/iOS | **Pending manual/automated client verification** |
| Source/variant comparison UX | table / provenance state | Pending |

## V0.2 — ergonomics

- Quick capture command from selection; clipboard support and explicit link/reference metadata.
- Random review, saved filters, richer card typography and custom extra categories.
- Undo operations and entry deletion with confirmation/Obsidian trash semantics.
- Source provenance status: verified/unverified/personal rewrite; support multiple editions/translations.
- List virtualization and persistent optional collection index (cache only, rebuildable).
- Keyboard navigation, accessibility and multilingual UI.

## V0.3 — generality

- Templates for idea, paragraph, page/URL and creative writing fragment.
- Drag-and-drop extras, reordering, related entry linking and user-defined display templates.
- Import and export from Markdown, JSON, CSV; migration safety checks.
- Optional gallery view; attachment preview. Never require a remote service.

## Stable release gate

- Windows/macOS/Linux and Android/iOS actual Obsidian test matrix.
- 1k/10k fixtures, large quote (>10k chars) and many-extra-item stress tests.
- Sync, conflict, file rename/move, app restart, timezone and UTF-8 roundtrips.
- Screen-reader and keyboard focus tests, stylesheet conflict tests under common Obsidian themes.
- Complete docs, downgrade/upgrade instructions and release artifacts.
