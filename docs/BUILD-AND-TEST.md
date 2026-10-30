# Excerpts — Build, verification, and recovery

## Canonical production build

The only supported distributable is produced from the committed `package.json` and
`package-lock.json`, using Node.js 22 and the **Build and test** workflow:

```sh
npm ci --no-audit --no-fund
npm run verify
```

`npm ci` must not change the lockfile. Direct developer dependency versions are exact,
and `scripts/check-release.cjs` verifies the lockfile root, versions, CI installation
commands, package assets, and scoped CSS. Keep dependency updates deliberate: update
both npm files together, review the resolved tree, and rerun **both** workflows.

The separate **Screenshot QA** workflow also uses `npm ci` before compiling and
running Chromium geometry, focus, continuous-frame, and scale regressions.
These are mocked-host tests, not official Obsidian client validation.

## Official installation artifact

The **Build and test** workflow packages the resulting `main.js`,
`manifest.json`, and `styles.css` into `dist/excerpts/` and a versioned
`excerpts-<version>.zip`. Only the successful build for a reviewed commit
may be considered for a release. Download the artifact from that commit, extract
it into a **test vault**, and verify the installed bundle instead of testing a
different local build.

Additional debugging artifacts, not distributables:

- `excerpts-source-snapshot`: source, test scripts, configuration, **lockfile**
  and documentation from the same successful build; kept for seven days.
- `excerpts-dev-deps`: Linux/Node 22 dependency archive, kept for seven days;
  can be paired with the matching source snapshot for offline investigation.

## Restricted / offline environments

If npm registry access is unavailable, recover the **source snapshot and dependency
archive from the same completed successful run**, extract into one directory, and run
`npm run verify`. Such a recovery validates the recorded dependency set but does
not replace a fresh `npm ci` in connected CI.

`npm run typecheck:offline` uses limited local Obsidian type declarations for
diagnosis only. The old `build:offline` bundler is **removed**: its hand-maintained
module list omitted runtime imports, so the resulting `main.js` was not a valid
supported plugin. Do not distribute any bundle generated from that path.

## Testing limitations and release gate

Neither unit tests, jsdom, Chromium snapshots nor a successful mock Vault smoke test
certify actual Obsidian desktop, Android, or iOS behavior. Follow the real-device
matrix in `docs/VISUAL-QA.md`, including media, touch/IME, deep scroll and third-party
themes. A stable release requires that evidence, the independent installation check,
and required branch checks on `main`.

GitHub Actions running successfully is not equivalent to **enforced** branch
protection. The repository administrator must configure a branch ruleset requiring:

- `Build and test / build`
- `Screenshot QA / Visual inventory and layout guards`

The rule must prevent bypass / direct push to `main` for ordinary development.

## Manual installation

Put the verified distributable files under:

```text
YOUR_VAULT/.obsidian/plugins/excerpts/main.js
YOUR_VAULT/.obsidian/plugins/excerpts/manifest.json
YOUR_VAULT/.obsidian/plugins/excerpts/styles.css
```

Enable the community plugin only in a test vault until the official-device
acceptance items have passed.
