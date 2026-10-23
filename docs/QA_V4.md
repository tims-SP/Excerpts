# Excerpts beta.11 — v4 interface acceptance record

## Product baseline
- Each excerpt is a normal `.md` file; `.excerpts` FileView remains the homepage.
- Obsidian MarkdownRenderer handles read mode and file-relative embeds; arbitrary H2 names and duplicate occurrences stay collapsible.
- Quick capture defaults to a compact one-line input and reveals tools progressively.
- Pencil editing is in-card; YAML property tags are selected chips with on-demand suggestions; edits are committed together.

## Actual verification completed
- GitHub Actions: `npm run verify` (TypeScript, Node codec, smoke, UI, CSS scope), plus a **real Chromium** component-state gate `scripts/visual-acceptance-v4.py`. The gate saves screenshots as `excerpts-visual-qa`.
- In a separate local Chromium run of the **compiled GitHub Actions package**, manually examined generated full-page screenshots at 320, 390, 768 and 1280 pixels, with light and dark modes.
- Extended mock testing used warm third-party-like theme tokens, 20px reading text and a 360px narrow desktop split.
- The complete local interaction matrix generated 84 screenshots: default, capture focused, capture typed, capture tags, illegal tag, saved capture, multiple H2, inline editor, editor tags, dirty search, discard confirmation and discarded state across seven viewport/theme cases. A second run covered third-party tokens, long capture, filter, zero search, and repeated H2 cases.
- Measured on local Chromium preview: default quick capture 62px high; first card begins around 172–178px; input and card body text start at equal horizontal X; no horizontal document overflow in the checked variants.

## Confirmed component / state checks
| Area | States |
|---|---|
| Homepage | Open real `.excerpts`; default collapsed search and quick capture; counts; empty search and filters |
| Quick capture | Empty, focus, disabled/enabled Save, multiline, tag selection, invalid tag, save/reset and persisted draft |
| Card | Short/long text, native Markdown rendering delegation, metadata and actions, narrow widths, light/dark/warm theme |
| H2 | Default collapsed, multiple open, duplicate names, heading-only notes, no repeated open heading, local region replacement |
| Tag picker | Selected first, hidden recommendations, search/create, remove, validation feedback, Chinese IME delimiter handling |
| Inline editing | Bounded height, no technical heading, save/cancel, dirty confirmation, restored draft, stale-source conflict |
| Filtering | Search does not unmount a dirty editor or steal search focus; selected tags and H2 remain independent |
| YAML | Single Vault.process; tag-only update preserves unrelated properties, comments and CRLF; malformed YAML fails safely |
| Platform | Mock Chromium responsive geometry/touch checks and keyboard/caret tests |

## Boundaries / open verification
- A mock Obsidian host is **not a real Obsidian client**. Real Android and iOS keyboard/safe-area behavior, OS accessibility services, third-party installed themes and plugin interoperability cannot be certified by this run.
- The mock MarkdownRenderer demonstrates API calls and file-relative source paths but does **not certify real-world media and embed playback**; real Obsidian must check images, videos, footnotes, cross-section links and other plugins' embeds.
- Automated screenshot assertions cover geometry and key component states. Human visual review was performed on generated mock screenshots; they are not pixel-diff golden images against an original client screenshot.
- No changes were merged into main by this development PR.

## beta.12 — Card action overlap regression

- Editor actions must be normal-flow, not sticky, in narrow mobile clients. Save/Cancel appear after Markdown and tags and cannot cover either.
- Each card uses a vertical layout: body, tags, H2 groups, then a wrapping footer. Card action icons stay in the footer and never intrude into Markdown reading width.
- Chromium geometry assertions inspect actual DOM rectangles for the card, text, sections, footer, action buttons, and edit textarea; in addition to 320/390/768/1280px checks, exercise 240/280px with long CJK text, media placeholders, and a scrolled long Markdown editor.
- Browser mocks cannot certify physical mobile keyboards, real embeds, and third-party CSS. Those remain real-client QA items.
