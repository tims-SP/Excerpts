const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const contract = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/visual-class-contract.json'), 'utf8'));
const read = file => readFileSync(path.join(ROOT, file), 'utf8');

test('ex-prefixed UI identifiers are reviewed; new/removed components need explicit approval', () => {
  const all = new Set();
  for (const file of contract.files) {
    const text = read(file);
    for (const found of text.matchAll(/\bex-[a-z][a-z0-9-]*/g)) all.add(found[0]);
  }
  const actual = [...all].sort();
  assert.deepEqual(actual, contract.classes,
    'UI selectors/tokens have drifted: review new/deleted component states, then update approved inventory');
  assert.deepEqual(contract.classes, [...new Set(contract.classes)].sort());
});

test('all CSS pixel, color, and spacing modifications require approval against screenshots', () => {
  const bytes = readFileSync(path.join(ROOT, 'styles.css'));
  const gitBlob = createHash('sha1').update(Buffer.concat([
    Buffer.from('blob ' + bytes.length + '\0'), bytes
  ])).digest('hex');
  assert.equal(gitBlob, contract.stylesheet_git_blob_sha,
    'CSS changed: first inspect all affected Screenshot QA images, then explicitly approve the new style blob SHA');
});

test('screenshot suite covers runtime states and records component crops for review', () => {
  const suite = read('scripts/visual-audit.py');
  const workflow = read('.github/workflows/screenshot-qa.yml');
  const fixture = read('tests/fixtures/preview-template.html');
  for (const name of ['page-header','composer','composer-tag-picker','calendar-panel','calendar-grid','calendar-back','calendar-warning','card',
                      'card-tag-editor','card-section-open','list-search','list-filter',
                      'list-menu','selection-toolbar','delete-single-dialog',
                      'delete-bulk-dialog','saved-filter-dialog','saved-filter-error',
                      'empty-results','settings','folder-view','scan-progress','invalid-page',
                      'recovery-action','recovery-hint']) {
    assert.ok(suite.includes('"' + name + '"'), 'missing screenshot selector: ' + name);
  }
  for (const state of ['home','composer-picker','composer-draft','search-empty','filter',
                       'page-menu','section-open','card-picker','card-menu',
                       'single-delete','selection','bulk-delete','saved-filter',
                       'saved-filter-error','settings','folder','scan-complete',
                       'scan-blocked','scan-error','stale','scan-progress','invalid',
                       'recovery-search-stale','recovery-tag-stale','recovery-selection-stale',
                       'calendar-stale-warning','card-recovery-menu-scrolled','card-mutex-feedback']) {
    assert.ok(suite.includes('"' + state + '"'), 'missing screenshot scenario: ' + state);
  }
  assert.match(suite, /loc\.screenshot\(/);
  assert.match(suite, /page\.screenshot\(/);
  assert.match(suite, /set\(REQUIRED\)\.difference/);
  assert.match(workflow, /python scripts\/visual-audit\.py/);
  assert.match(workflow, /python scripts\/calendar-scroll-regression\.py/);
  assert.match(workflow, /artifacts\/\*\*\/\*\.png/);
  assert.match(fixture, /class Modal/);
  assert.match(fixture, /class Setting/);
  assert.match(fixture, /class Menu/);
});
