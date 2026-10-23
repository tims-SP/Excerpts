# Excerpts Visual Rebuild · 11 Round Report

Version: **0.2.0-beta.4**. Baseline: `0.2.0-beta.3` on `main`.

This is a new **implementation**, not another mockup or just a design document.
The reference is **Obsidian theme/components** for platform consistency, **flomo** for instant capture and continuous cards, and **Apple HIG** for hierarchy, alignment, progressive disclosure and accessible controls.

## Eleven locally committed iterations

| Round | Concrete source changes | Verification |
| --- | --- | --- |
| 01 | Replaced accumulated CSS patches with one scoped surface/spacing system; native pane owns one inset only | `npm run verify` |
| 02 | Auto-growing capture textarea and IME-safe Cmd/Ctrl+Enter; correct draft restore height | `npm run verify` |
| 03 | Reordered card to **excerpt → tags → extras → footer**, time/actions subordinate | `npm run verify` |
| 04 | Moved `Add extra` into the footer tools; no empty extras toolbar or card divider | `npm run verify` |
| 05 | Collapsed global tag filter into an on-demand control; limited first-level choices to eight | `npm run verify` |
| 06 | Calm empty state and explicit clear-filter action | `npm run verify` |
| 07 | Fixed container-query ancestry; narrow Reading view fallback and long tags | `npm run verify` |
| 08 | Accessible quick-capture group and shortcut; keep focus on editor for repeated Ctrl/Cmd+Enter | `npm run verify` + new UI test |
| 09 | Long excerpt progressive expansion without changing Markdown source | `npm run verify` + new UI test |
| 10 | Reproducible mock WebView visual harness; assert single 16px inset, card alignment and compact composer | Chromium 320/390/768/1280, light/dark |
| 11 | Moved refresh/tag filter to one native list menu; keep search and revisit visible | `npm run verify` + new UI test |

## Measurable UI changes

- At simulated 390px viewport: collection/card left inset **16px**, where the earlier test mock accumulated ~28px of unrelated paddings.
- Default capture card height: **~122px** in the current Chromium fixture versus **~153px** in beta.3, with actual text input auto-growth.
- The main excerpt is the first element in each card, with date and actions in the footer (no long empty gap above the quote).
- Cards use native `--background-secondary` surfaces rather than a prominent outlined rectangle.
- `Add extra` stays accessible but moves into a small tool affordance; related Extras appear only when present.
- Global tag filtering and refresh are not permanently visible on the feed header.
- More than 420 Unicode characters can be expanded/collapsed without modifying the stored original.

## Visual validation

`scripts/visual-check.py` reads the **actual local `main.js` + `styles.css`** and a fixture in `tests/fixtures/preview-template.html`; no manually redrawn UI is involved. Requires a Python Playwright browser installation locally. The CI still performs Node data/UI/smoke tests and real TypeScript and esbuild compilation. Layout screenshots are in local `artifacts/` and can be regenerated.

Test matrix: light 320/390/768/1280, dark 390/1280. Geometry asserts no horizontal overflow, excerpt before footer, card/input left edges match, mobile inset is 16px, and default composer height is below 160px.

## Integrity and scope

The codec, repository, ID format, markdown file content, workspace paths, and vault integration were **not changed**. The plugin stays restricted to the selected collection workspace and continues to use the Obsidian `Menu`, `Modal`, and `setIcon()` APIs.

## Explicit limits

These results are from code/unit tests, JSDOM API mocks and Chromium visual fixtures, **not** from a genuine Obsidian Android/iOS client with its keyboard, scrollbars and theme. Device-specific typography, soft-keyboard behavior and plugin reload must still be user-tested before claiming stable visual acceptance.
