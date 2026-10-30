# Excerpts — Roadmap

Current development baseline: `0.2.0-beta.16` (2026-10-29).

## Frozen product scope

- `.excerpts` FileView and folder context-menu entrypoint; optional saved filtered views.
- Normal Markdown files as the only excerpt data; H1 / H2 read-only content layout,
  Obsidian native Markdown previews and source-editor entrypoints.
- Quick capture, YAML tag editing, tag filtering, full-text search and date view.
- Single-scroll-container virtual timeline, bounded rendering, selection and
  checked deletion using the Obsidian Vault/file manager APIs.
- **Manual** index refresh; file events mark the committed index stale. Blocked
  operations are refused rather than queued or silently retried.

No new UI/features are planned during the production-hardening pass.

## Active production work

See [PRODUCTION-REVIEW.md](PRODUCTION-REVIEW.md) for the complete evidence-ranked
G0 review, P0/P1 gates, Draft PR disposition, and G1–G5 execution order.

1. **G1 / reproducible build:** exact dependencies and `npm ci`, retire the
   invalid offline bundle, improve release checks, enable mandatory checks on main.
2. **G2 / behavior correctness:** locks, stale-index/write races, cancellation,
   virtual-list identity, MarkdownRenderer lifecycle and failure feedback.
3. **G3 / measured performance:** actual Vault indexing, search, memory and media,
   independent of synthetic Chromium tag-filter benchmarks.
4. **G4 / official client tests:** real desktop, Android and iOS, including touch,
   IME, soft keyboard, media and theme/viewport transitions. Record real evidence
   in [VISUAL-QA.md](VISUAL-QA.md).
5. **G5 / stable release:** independently verified release ZIP and community
   marketplace policy review.

## Never claim without evidence

Automated mock/client simulation checks do not verify official Obsidian clients.
A successful GitHub Actions run cannot replace main-branch protection. Production
acceptance remains open until the documented gates have actually passed.
