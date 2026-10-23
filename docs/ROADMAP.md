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
- Random review (implemented: filter-aware shuffle-to-top, theme-scoped highlight); saved filters, richer card typography and custom extra categories remain pending.
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

## 2026-10-23 — v0.2 development started (not a stable release)

- **P0 fixed:** structurally ambiguous excerpts (missing/duplicate markers, unowned content within managed blocks, duplicate Extra IDs, ambiguous YAML) are read-only rather than rewritten; trailing unmanaged Markdown is preserved.
- **P0 fixed:** Vault-relative path validation now rejects absolute paths, unsafe Windows names and ambiguous segments. Folder repoint verifies canonical overlap and a real `excerpts` fenced code block.
- **P0 fixed:** repository update compares the originally loaded data snapshot with the current Vault.process content; silent overwrite of newer content is refused even without a frontmatter timestamp change.
- **P0 fixed:** quote/extra edit drafts are retained in memory across card rerenders and explicitly discarded on Cancel or successful Save. Drafts are **not** crash-recovery persisted.
- **v0.2 first feature:** random revisit respects current search/tag filters and surfaces the chosen card first. No Markdown write occurs during review.
- **Tests:** Markdown data suite expanded from 7 to 18 tests, with mock-Vault smoke scenarios for stale writes, malformed records, path collisions and false homepage authorization. Four jsdom UI interaction tests run in CI.
- **Still required:** end-to-end tests in actual Obsidian desktop/mobile, real-browser interaction and responsive-view verification (jsdom alone does not cover layout), 1k/10k performance fixtures, and reliable crash-recovery drafts.
- **Release policy:** package/manifest remain at v0.1.0 while v0.2 features are developed. Do not advertise v0.2.0 as released until release acceptance gates are met.

## 2026-10-23 — second v0.2 development iteration

- **Extra UI:** hide empty groups, keep populated groups and active composers visible; use Obsidian's native `Menu` for the six Extra creation types. No schema migration.
- **Quick capture:** block duplicate creation while a Vault write is pending, whether from rapid button taps or Ctrl/Cmd+Enter.
- **Data integrity discovery:** editing a tagless Entry previously duplicated the top-level `tags:` YAML key. This could render a newly edited document read-only. The patcher now replaces the existing key and list items line-by-line; regressions cover new Extras, subsequent tag updates, and custom YAML.
- **Read-only UI:** corrupted records no longer offer editing actions, while warning text remains visible.
- **Responsive design:** CSS container queries handle narrow Obsidian side panes independently of viewport width; all selectors remain scoped.
- **CI:** `npm run verify` runs 18 Markdown unit cases, official Obsidian API typecheck, esbuild, Vault smoke, and 4 jsdom DOM interaction cases. Mock UI checks do **not** claim actual desktop/mobile validation.
- **Open P0:** manual/automated genuine-client acceptance; page-level keyboard navigation and focus recovery; confirmation/undo robustness; save failures and offline mobile keyboard scenarios.
