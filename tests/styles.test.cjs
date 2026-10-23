const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const css = readFileSync(require('node:path').join(__dirname, '../styles.css'), 'utf8');

test('a single content inset and an Obsidian themed capture surface', () => {
  assert.match(css, /\.excerpts-root\s*\{[\s\S]*?padding: var\(--ex-space-5\) var\(--ex-space-4\)/);
  assert.match(css, /\.excerpts-root \.ex-composer \{[^}]*background: var\(--background-primary\)[^}]*border: 1px solid var\(--ex-subtle-border\)/);
  assert.match(css, /@container \(max-width: 480px\)\s*\{[\s\S]*?\.excerpts-root \{ padding: var\(--ex-space-3\) var\(--ex-space-4\) 48px; \}/);
});

test('interactive card metadata uses legible host color', () => {
  assert.match(css, /\.excerpts-root \.ex-date \{ color: var\(--text-muted\)/);
  assert.match(css, /\.excerpts-root \.ex-count \{ color: var\(--text-muted\)/);
});

test('coarse-pointer footer and tags are 44px controls', () => {
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*?\.excerpts-root \.ex-card-footer button\.ex-icon-button,[\s\S]*?\.excerpts-root button\.ex-tag \{ min-width: 44px; min-height: 44px; \}/);
  assert.match(css, /\.excerpts-root \.ex-card-footer button\.ex-icon-button \{ width: 44px; height: 44px; \}/);
});

test('entry actions inherit card surface and Extras do not nest inset backgrounds', () => {
  assert.match(css, /\.excerpts-root \.ex-edit-panel \.ex-actions \{ position: sticky;[^}]*background: var\(--ex-surface\)/);
  assert.match(css, /\.excerpts-root \.ex-extra-item \.ex-extra-editor \{[^}]*margin: var\(--ex-space-2\) calc\(-1 \* var\(--ex-space-3\)\) 0; padding: 0;/);
  assert.equal((css.match(/\.excerpts-root \.ex-edit-panel \{ display: flex/g)||[]).length,1,'edit panels must have a single base layout declaration');
});
