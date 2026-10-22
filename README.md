# 摘录 / Excerpts

An Obsidian community plugin for **folder-scoped local collections**. It never replaces the global Obsidian editor, theme, or file browser.

## Features in v0.1.0

- Create one or more collections bound to user-selected folders, with an independently generated home Markdown file.
- Open a flomo-inspired card feed only on the authorized home file in **Reading view**.
- Save each excerpt as a regular Markdown file in the collection's `Cards/` directory.
- Add tags, search, filter, favorite, and edit excerpts.
- Attach multiple sources, variants, notes, contexts, links, and custom blocks.
- Readable offline data; changing/deleting plugin settings does not delete Markdown.
- No global CSS selectors and no extra ribbon/sidebar clutter.

## Installation

Download the artifact produced by [GitHub Actions](../../actions/workflows/build.yml). Place `main.js`, `manifest.json`, and `styles.css` inside `YOUR_VAULT/.obsidian/plugins/excerpts/`. In Obsidian, enable **Community plugins → 摘录 Excerpts**.

## Setup

Open **Settings → Community plugins → 摘录 Excerpts**, enter a collection name and **folder path relative to the Vault**, then select **Create collection**. A home page is created automatically. Open that page in Reading view. No folder name is hardcoded.

## Build

Official build (CI): `npm install && npm run verify`. `npm run build` uses esbuild and real Obsidian API typings.

For restricted environments, a zero-dependency `npm run build:offline` uses an already-installed global TypeScript compiler to create `main.js`. `npm run typecheck:offline` typechecks against minimal compatibility shims; **CI typechecks against the real Obsidian API**. `npm test` tests the Markdown codec without Obsidian.

## Storage

A collection folder contains a generated `首页.md`, `Cards/` with a Markdown file per entry and `Attachments/`. The actual root folder is chosen in settings. `excerpts_id` and `excerpts_collection` preserve stable identities. Supplemental blocks use readable Markdown and hidden boundary comments; malformed blocks open read-only to avoid accidental damage.

## Limitations

- Designed for Reading view; Live Preview does not become a full-screen app.
- Files remain ordinary Markdown, but structured extras should be edited in the plugin to maintain markers.
- A conflicting Git merge must be resolved externally; there is no automatic multi-device conflict resolver.
- Full Obsidian desktop/iOS/Android acceptance tests have not yet run; mobile support is a build target.
- Deleting entries and image attachments in the UI, multi-column gallery, import, and semantic search are deferred.

## Roadmap

1. v0.1: Collection setup, cards, metadata, extras editing, search and safe writes.
2. v0.2: Source metadata fields, random review, template management and improved mobile UX.
3. v0.3: Import/export, performance index, gallery and excerpt relationships.

License: MIT (see LICENSE).
