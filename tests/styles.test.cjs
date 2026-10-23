const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const css=readFileSync(require('node:path').join(__dirname,'../styles.css'),'utf8');
test('CSS affects only Excerpts cards and uses Obsidian theme variables',()=>{
  assert.match(css,/^\.excerpts-root\s*\{/m);
  assert.match(css,/--background-secondary/);
  assert.match(css,/\.excerpts-root \.ex-card \{/);
  assert.match(css,/\.excerpts-root \.ex-card :is\(img, video/);
  assert.doesNotMatch(css,/(?:^|\n)\s*(?:body|html|\.workspace|\.markdown-preview-view)\s*\{/);
});
test('mobile layout and touch controls are constrained to the pane',()=>{
  assert.match(css,/@container \(max-width: 480px\)/);
  assert.match(css,/@media \(pointer: coarse\)/);
  assert.match(css,/min-height: 44px/);
});
