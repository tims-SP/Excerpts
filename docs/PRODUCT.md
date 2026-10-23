# Excerpts — product specification (beta.11)

Excerpts is an Obsidian Markdown card stream for collecting and rereading passages, ideas, dialogue and quotations.

The user creates or opens a real `首页.excerpts` file in any desired Vault folder. That file is an entrypoint, not a document to be parsed as a card. Opening the file in Obsidian directly shows the original flomo-inspired capture-and-reading homepage, with no “My Excerpts” collection, separate listing page or mandatory metadata.

## Homepage experience

1. Minimal title “摘录”.
2. Compact, focus-expandable quick capture field, optional tag pill suggestions and a Save button. Saving creates a plain `.md` in the homepage directory.
3. “最近收藏” toolbar: count, collapsed search icon, random recall icon and `Menu` for tag filtering and refresh.
4. Single-column content-first card feed. Ordinary Markdown is rendered using Obsidian's Markdown renderer; H1 is optional; each H2 occurrence (including duplicated names) appears as an independent lightweight collapsed group.
5. Card tags remain independent from H2 sections. Capsule tags allow filtering; expanded editor offers suggestions and custom tags.
6. Date and lightweight controls follow card content. The primary pencil opens an in-card Markdown editor with progressive capsule tag selection and one atomic save. The overflow menu can open the original note in Obsidian.

## Storage

Each `.md` is a card; frontmatter is optional, tags and favorite use standard Obsidian metadata. Images, video, audio and other attachments use Markdown embeds and normal vault resource paths. No custom collection metadata, private attachment store or schema markers.

## Development constraints

This is a deliberately breaking development release. No migration or legacy compatibility. Full client QA on Windows/macOS and Android/iOS, large-vault pressure tests and complex Markdown embed/reference checks remain mandatory before stable release.

## v4 validated interaction states

Compact, focus-expandable capture; inline Markdown editing with persistent drafts; active dirty editor remains visible across filters; H2 regions toggle in place without duplicate headings; selected-first tags and explicit invalid input feedback. Screenshot geometry is checked across mobile/desktop and light/dark mocks. Real Obsidian platform testing remains required.

## Interaction source of truth

See [UI_CONTRACT_V3.md](UI_CONTRACT_V3.md). It supersedes legacy Entry/Extra and modal-editor interactions documented before Markdown-first beta.9.
