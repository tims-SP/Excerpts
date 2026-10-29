const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const project = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(project, f), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const versions = JSON.parse(read('versions.json'));
const ci = read('.github/workflows/build.yml');
const screenshotCi = read('.github/workflows/screenshot-qa.yml');
const css = read('styles.css');
assert.equal(manifest.version, pkg.version, 'package and manifest versions differ');
assert.equal(versions[manifest.version], manifest.minAppVersion, 'versions.json is not synchronized');
assert.equal(lock.lockfileVersion, 3, 'Expected npm lockfile v3');
assert.equal(lock.name, pkg.name, 'Root lockfile package name differs');
assert.equal(lock.version, pkg.version, 'Root lockfile version differs');
assert.equal(lock.packages['']?.version, pkg.version, 'Lockfile root package is not synchronized');
assert.deepEqual(lock.packages['']?.devDependencies, pkg.devDependencies,
  'Direct dependencies differ from the lockfile');
for (const [name, expected] of Object.entries(pkg.devDependencies)) {
  assert.match(expected, /^[0-9]+[.][0-9]+[.][0-9]+(?:-[0-9A-Za-z.-]+)?$/,
    'Direct dependency must be an exact version: ' + name);
  assert.equal(lock.packages['node_modules/' + name]?.version, expected,
    'Installed direct dependency differs from pinned version: ' + name);
}
assert.match(ci, /npm ci --no-audit --no-fund/, 'Build CI must install frozen dependencies');
assert.match(screenshotCi, /npm ci --no-audit --no-fund/, 'Screenshot CI must install frozen dependencies');
assert.match(ci, /package-lock\\.json/, 'Source snapshot must contain the lockfile');
assert.match(ci, /excerpts-\$\{VERSION\}\.zip/, 'CI packaging is not versioned by manifest');
assert.match(ci, /dist\/excerpts-\*\.zip/, 'CI artifact list must include the versioned zip');
assert.match(css, /^\.excerpts-root\s*\{/m, 'Expected scoped root styles');
assert.equal(/(?:^|\n)\s*(?:body|html|\.workspace|\.markdown-preview-view)\s*\{/m.test(css), false, 'Unscoped rules would alter the host application');
console.log('Release and CSS isolation checks passed for ' + manifest.version);
