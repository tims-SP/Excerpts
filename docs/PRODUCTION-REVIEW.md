# Excerpts — production-readiness review (G0 / G1)

Review date: 2026-10-29  
Baseline: `main` @ `6a6947203cef51f1649d2bf3da0499c4111aa48a`  
Target: stabilize the existing beta.16 scope; **no new product features**.

## Evidence classification

- **Confirmed configuration failure:** verified in the repository or GitHub API.
- **Code risk:** implementation merits focused tests; not asserted to be a reproduced bug.
- **Acceptance gap:** no required end-to-end/official-client evidence.
- **Legacy drift:** documentation or abandoned implementation contradicts supported behavior.

Do not mark an acceptance gap fixed because mock tests passed. Do not alter
application behavior solely to satisfy a test.

## G0 findings

| Priority | Evidence type | Finding | Closure requirement |
| --- | --- | --- | --- |
| P0 | Confirmed | `main` is unprotected; successful CI jobs are not required merge checks | Enable GitHub branch ruleset and verify a failing check blocks merge / direct push |
| P0 | Confirmed | No `package-lock.json`; `npm install` and `obsidian: latest` make dependencies time-dependent | Commit resolved lockfile, pin direct versions, use `npm ci` in both workflows |
| P0 | Acceptance gap | Android / iOS official Obsidian matrix is not signed off | Test devices and record results under `docs/VISUAL-QA.md` |
| P1 | Confirmed | Alternate offline bundler omits imports used by current `src/main.ts` and `src/view.ts` | Remove unsupported `build:offline` command and implementation; retain only diagnostic offline typecheck |
| P1 | Coverage gap | Chromium 1k/10k/30k regression measures already indexed tag filtering and virtual DOM only | Test real Vault scans, full-text reads, native media and memory/scroll behavior |
| P1 | Code risk | `src/view.ts` combines multiple concurrent UI/lifecycle owners | State-transition review before any minimal behavioral correction |
| P1 | Code risk | Asynchronous Markdown rendering, row unmount and reopen may overlap | Focused leak/teardown tests and real client verification |
| P2 | Legacy drift | Old ROADMAP/PRODUCT descriptions no longer match manual refresh and current list model | Refresh documents from current implementation |
| P2 | Coverage gap | Release artifact currently lacks clean official-client installation evidence | Install downloaded candidate in clean vault and record runtime proof |

## Draft PR disposition

On 2026-10-29 the five open Draft PRs diverged from `main`:

- [#37](https://github.com/tims-SP/Excerpts/pull/37): retain as a **reference**, not a merge-ready implementation; after G1, compare native control replacement against current `main` and rebase/recreate only if needed.
- [#36](https://github.com/tims-SP/Excerpts/pull/36): recheck recovery behavior; current `view.ts` already has `getRecoveryInfo` and `renderRecoveryHint`; do not cherry-pick wholesale.
- [#9](https://github.com/tims-SP/Excerpts/pull/9), [#8](https://github.com/tims-SP/Excerpts/pull/8), [#7](https://github.com/tims-SP/Excerpts/pull/7): obsolete UI/in-card edit directions; do not merge without an explicit new product decision.

These are disposition recommendations, not assertions that branches were closed.

## Production gates, in order

**G1 — reproducible delivery:** exact npm dependency snapshot, pinned dev dependencies,
clean `npm ci`, check-release constraints, source snapshot includes lockfile;
`main` protection configuration is an administrator task, not a source-code workaround.

**G2 — correctness:** inspect `main.ts` locks, navigation failure cleanup and temporary
editor lifecycle; then `repository.ts` race windows, deletion verification and
frontmatter writes; then `view.ts` search/scan/tag async state transitions; finally
`virtual-list.ts` retained focus, anchor and renderer disposal.
For each confirmed defect: failing regression -> smallest correction -> full CI.

**G3 — performance:** separate indexing, full-text search, native Markdown hydration,
media and deep-scroll tests at 1k, 10k and 30k. Report measurements without inventing
a budget. Bounded DOM count alone is not a performance certificate.

**G4 — device acceptance:** actual Obsidian desktop, Android and iOS, including
third-party theme, IME, virtual keyboard, rotated panes, video, image, 100/1k/10k
entries and continuous-frame behavior. Missing evidence means **not verified**.

**G5 — stable release:** clean install from same-commit official GitHub Actions
artifact, stable manifest version, changelog and verified Release assets. Do not
publish a production-ready claim until P0 gates are complete.

## Change guardrails

1. Markdown and Obsidian Vault remain the source of truth.
2. Refuse/disable an unsafe operation with an actionable message; do not add
   automatic retry, background scans, compatibility data models or generic queues.
3. Retain existing exclusive scan ownership, stale-index contract, virtual rows,
   MarkdownRenderChild lifecycle, and deliberate user-triggered refresh.
4. No large UI redesign or gratuitous reorganization as part of G1.
5. Record the test proof for each completed item; CI success is necessary but not
   sufficient for client certification.
