# Excerpts — 20-round editing experience refactor

Target: **0.2.0-beta.5**. Branch: `feature/editor-experience-20-rounds` from beta.4.

Principles: Obsidian owns control surfaces and tokens, flomo motivates frictionless capture, and Apple HIG motivates focused progressive editing and recovery. **No changes to Entry Markdown serialization or collection-root permissions.**

## Completed rounds

| Round | Concrete change |
|---|---|
| 01 | Separated entry editor from source/variant editor visually using native surfaces |
| 02 | Centralized auto-growth logic for multiline textarea controls |
| 03 | Made quote editing use auto-sizing reading typography instead of fixed five rows |
| 04 | Made source/variant editing auto-size instead of four-row fixed textboxes |
| 05 | Prevented accidental save during CJK IME composition, including Android `keyCode=229` |
| 06 | Added accessible editor group roles, labels and shortcut annotations |
| 07 | Disabled repeated entry saving submissions during an in-flight write |
| 08 | Disabled repeated extra saving submissions during an in-flight write |
| 09 | Extended the optional draft schema for source/variant/editor drafts (old drafts still decode) |
| 10 | Persisted extra editor input and title to recoverable Markdown draft files |
| 11 | Preserved edited extra titles during subsequent draft writes |
| 12 | Added recovery action with read-only fallback when entry revision conflicts |
| 13 | Archived resolved/cancelled extra backups while preserving original entry data |
| 14 | Restored field focus, selection and scroll position across feed redraws |
| 15 | Made mobile editor actions keyboard-safe and text inputs resistant to auto-zoom |
| 16 | Introduced contextual source/variant prompts without changing data storage |
| 17 | Added regression test for extra draft surviving renderer teardown and reload |
| 18 | Added regression tests for IME safety and preserved edit caret |
| 19 | Refined editor spacing/touch affordances; repeated responsive visual checks |
| 20 | Versioned beta.5 release with repeatable source-backed editor screenshots and docs |

## Validation

- `npm run verify`: Markdown tests + UI tests + TypeScript/esbuild + simulated Obsidian load + release guard.
- `python scripts/visual-check.py`: uses generated **actual** `main.js` and `styles.css` in a simulated Obsidian WebView. Screenshots include entry editors in light/dark at mobile and desktop widths.
- Scope CSS exclusively to `.excerpts-root`; stable Markdown schema, folder isolation, and Vault API writes remain intact.

## Limitations and next follow-ups

- Tests are browser/DOM and Node mocks. A genuine Android/iOS Obsidian app test is required, especially for keyboard viewport, back navigation and composition.
- Large entries and large numbers of active Extra drafts warrant memory and I/O profiling.
- Per-extra editing has recoverable Markdown backups, but users should be able to enumerate every older backup in a dedicated recovery manager in future versions.
- A tiny race window can remain around async draft backups and view termination; deliberately avoid treating autosaved backups as guaranteed transactional saves. Always keep the active input available if a write fails.
- No mobile screenshots in CI until a first-party-compatible Obsidian Android test harness is available.
