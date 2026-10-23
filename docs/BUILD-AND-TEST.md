# Build, test and recovery in restricted environments

## Online canonical build

GitHub Actions (`.github/workflows/build.yml`): checkout -> setup Node 22 -> npm install -> tests -> tsc using real Obsidian API declarations -> esbuild -> runtime smoke test -> package artifacts.

Artifacts:
- `excerpts-obsidian-plugin`: ZIP with `main.js`, `manifest.json`, `styles.css` and a nested installation zip.
- `excerpts-dev-deps`: Linux Node 22 `node_modules` snapshot, retained for seven days, intended only for isolated debug environments.
- `excerpts-source-snapshot`: matching repository source files and test scripts for reproducible offline builds, retained for seven days.

## Independent rebuild from a single Actions run

Download both `excerpts-source-snapshot` and `excerpts-dev-deps` from the **same completed successful run**. Each is an outer Actions ZIP containing a `.tar.gz` archive. Extract the source archive into a clean directory and extract the dependencies into that same directory, then run:

```sh
npm run verify
```

This rebuild checks Node data tests, TypeScript against the official Obsidian declarations, esbuild and the compiled-plugin Vault mock. Compare the generated `main.js` with the `excerpts-obsidian-plugin` artifact from the same commit. Node version and native dependency platform should match Actions (Linux, Node 22). The isolated rebuild still does **not** count as a genuine Obsidian client test.

## Local offline development

If `node_modules` cannot be installed via npm because the container cannot resolve public package hosts:

1. Download the dev-deps Action artifact using authenticated GitHub tooling.
2. Extract the ZIP, then untar `excerpts-deps-linux-node22.tar.gz` at the project root.
3. Run `npm run verify` with the recovered dependencies; this performs unit tests, official typecheck, esbuild compilation and compiled-plugin smoke tests.
4. Alternatively, when a global TypeScript compiler is available, use `npm run typecheck:offline && npm test && npm run build:offline` for an emergency offline bundle. This path uses minimal local declarations and **does not replace CI verification**.

## Installation

Extract the final installation ZIP so your vault contains:

```
YOUR_VAULT/.obsidian/plugins/excerpts/main.js
YOUR_VAULT/.obsidian/plugins/excerpts/manifest.json
YOUR_VAULT/.obsidian/plugins/excerpts/styles.css
```

Enable the plugin, configure a collection root (Vault-relative), create its workspace, then open the generated homepage in Reading view.

## What testing does not claim

Chromium mock-DOM checks verify click/render/write flows. Node smoke checks verify Vault interactions using mocks. Neither demonstrates that the plugin was tested inside the actual Obsidian desktop or mobile distribution. Never claim official-client certification without such a run.
