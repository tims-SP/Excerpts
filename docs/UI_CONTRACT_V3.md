# Excerpts UI interaction contract (v3)

This is the approval baseline for the beta.9-derived component refactor. New architecture work must not silently change these rules.

## Unchanged storage and entrypoint

- A normal `.md` note is exactly one excerpt card.
- Any `.excerpts` home file opens a native Obsidian `FileView` scoped to its parent folder. There is no collection chooser, Entry/Extra model, managed attachments or migration layer.
- Media, links and embedded Markdown render through `MarkdownRenderer` with the source note path.
- Card order: Markdown body, tags, H2 groups, date/actions.

## H2 group semantics

- Every level-two heading becomes a generic, initially collapsed section trigger.
- Names are unconstrained; `## 来源`, `## 变种`, `## 批注`, `## 第一章` all behave alike.
- Repeated names are separate occurrences; the source order is unchanged.
- H2-only documents keep their section trigger(s), not a synthetic body; empty sections show no open-body frame.
- Multiple sections may remain open simultaneously; toggling one affects only the same card.
- Triggers use native chevrons, subdued copy and a soft selected surface. Open content uses a subtle inset/border but no nested card.
- Expanded Markdown is rendered by Obsidian; the source note is never rewritten merely for display.

## Editing

- Primary pencil opens the Markdown text editor **in the card**, not a new Markdown tab.
- The secondary overflow option opens the original note to use Obsidian's full editor or add Markdown sections.
- One `TagPicker` is shared by quick capture and card editing. Chosen chips are visible; search/suggestions appear only after "添加标签" is pressed.
- Recommendations are scoped to existing tags, searchable and ordered by frequency; selecting one keeps the picker open for repeated additions. Enter creates a chip; IME composition must not accidentally confirm. "完成" or Escape closes.
- Search text alone is **never** silently saved as a tag. Only selected chips are saved.
- Only YAML property tags are edited by the chip picker; inline `#tags` belong to the Markdown text editor.
- Markdown and YAML tags commit together through one `Vault.process`; an external mutation of the original file causes a conflict error, never an overwrite.
- A dirty cancel is explicitly confirmed. Dirty edits block switching cards; list refresh keeps the in-memory edit state. Editor loss on plugin unload/restart still needs real-client QA.

## Layout and QA

- Obsidian owns color, font, focus and most shape tokens. Card body is the most prominent layer. Never introduce global CSS selectors or custom app shell.
- Composition and reading card content share horizontal baseline; narrower touch devices retain 44px effective targets and safe-area-aware edit actions.
- Validate source-only, repeated H2, tags, images/video embeds, transitions, caret during refresh, YAML preservation and mobile keyboards.
- The preview HTML and screenshot scripts must run against the **current** FileView and compiled `main.js`, not retired collection APIs. They remain mocked Chromium checks, not certification of Android/iOS Obsidian.
