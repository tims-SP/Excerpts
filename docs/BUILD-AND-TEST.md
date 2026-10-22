# Build, test and recovery in restricted environments

## Online canonical build

GitHub Actions (`.github/workflows/build.yml`): checkout -> setup Node 22 -> npm install -> tests -> tsc using real Obsidian API declarations -> esbuild -> runtime smoke test -> package artifacts.

Artifacts:
- `excerpts-obsidian-plugin`: ZIP with `main.js`, `manifest.json`, `styles.css` and a nested installation zip.
- `excerpts-dev-deps`: Linux Node 22 `node_modules` snapshot, retained for seven days, intended only for isolated debug environments.

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
