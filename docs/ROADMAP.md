# Excerpts — development status after breaking beta.7

## Implemented in beta.7

- Markdown folder discovery without required file schema
- H1 and H2 extraction with code-fence protection
- Standard Frontmatter and inline tag retrieval
- Obsidian MarkdownRenderer in cards with lazy loading
- Section selection in each card
- Tag capsule filtering and standard Frontmatter tag editing
- Native note editor entry point and new blank note
- Manual / event-driven refresh and optional scheduled validation
- Bounded cached Markdown reads, cancellable batched search
- Removal of obsolete private draft and attachment workflow

## Validation

GitHub Actions verify: parser/unit tests, TypeScript build, smoke, UI simulation, CSS and release invariants.

## Before stable release

1. Test media embeds, note links and source-path rendering in actual Obsidian on Windows/macOS/Linux and iOS/Android.
2. Stress-test 1k/10k Markdown notes and complex rich media notes on low-memory devices.
3. Improve full-document reference definition handling across independently rendered H2 sections.
4. Perform manual accessibility and touch navigation QA.
5. Review optional section selection persistence and tag Frontmatter concurrency.
