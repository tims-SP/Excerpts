# Excerpts beta.6: layout, input surface & borders

Date: 2026-10-23. Based on the audit of beta.5. This is a focused UI change, **not** a storage migration.

## Design decisions

1. **Alignment:** mobile root padding 16px, reading card and capture card padding 16px with 1px occupied border. Their text begins on the same x-coordinate (33px at 390px viewport width). The single content inset belongs to the collection pane, never to Obsidian chrome.
2. **Surface separation:** capture uses host `--background-primary` + a subtle host border; reading cards use `--background-secondary` without heavy strokes. No custom brand palette, shadows or global selectors.
3. **Input controls:** capture expands with content; source/variant editor inputs retain visible boundaries. Narrow touch layouts give search, tags and source title fields at least 44px height.
4. **One edit surface:** main/extra editors inherit their card surface. The sticky action row uses the same background, eliminating the unexpected primary-colored band in the editing card.
5. **Extra editor:** remove repeated inset/card padding. When editing inside an extra row, the edit pane reaches the card's main content baseline rather than nesting two more visual frames.
6. **Small text:** date and list count now use `--text-muted` rather than `--text-faint`; compare actual themes independently for color contrast.
7. **Tap targets:** the mobile footer ellipsis/bookmark and card tags are at least 44x44px with a coarse pointer; desktop controls remain compact.
8. **CSS cascade:** consolidate duplicate panel rules; the coarse-pointer invariant is intentionally last in the stylesheet so later card-footer rules cannot shrink clickable areas.

## Measured before → after (mock Obsidian WebView)

| Case | beta.5 | beta.6 |
|---|---:|---:|
| 390px composer text x | 29px | 33px |
| 390px quote text x | 33px | 33px |
| Mobile card footer button | 32×32px | 44×44px |
| Mobile tags touch height | 27px | 44px |
| 320px nested source input width | ~205px | 253px |
| 390px nested source input width | ~275px (approx.) | 323px |
| Small date text | `--text-faint` | `--text-muted` |
| Main editor sticky action background | `--background-primary` | `--background-secondary` (card surface) |

The capture composer remains ≈122px high in normal mobile browser screenshot tests. Its distinct editable appearance is expressed by border and semantic surface, not a dark shadow.

## Regression checks

- `npm run verify`: Node Markdown tests, UI tests, static CSS invariant checks, Obsidian SDK typecheck, esbuild, mock plugin smoke and release alignment.
- `python scripts/spacing-check.py`: Chromium executable plus Playwright required. Tests 320/390/768/1280px light/dark surfaces, text baselines, tap sizes, nesting width, edit action continuity and overflow. The preview fixture now places the renderer inside an `excerpts-native-host` container to match the independent ItemView's layout.
- `python scripts/visual-check.py`: captures real built JS+CSS visuals for review.

## QA still required

Actual Obsidian Android/iOS view sizing, soft keyboard, custom third-party themes, portrait/landscape and accessibility font scaling have **not** been certified by a mocked Chromium runtime. Run those checks on the device before promoting beta.6 to stable.
