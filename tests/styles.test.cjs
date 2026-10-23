const {test}=require('node:test');const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');const css=readFileSync(require('node:path').join(__dirname,'../styles.css'),'utf8');
test('beta.6 compact compose, timeline and native content',()=>{
  for(const selector of ['.ex-composer','.ex-compose-actions','.ex-toolbar','.ex-toolbar-actions','.ex-card','.ex-quote','.ex-chips','.ex-extras','.ex-card-footer','.ex-search-wrap'])
    assert.ok(css.includes('.excerpts-root '+selector),selector);
  assert.match(css,/--background-secondary/);
  assert.match(css,/\.excerpts-root \.ex-card :is\(img, video/);
  assert.doesNotMatch(css,/(?:^|\n)\s*(?:body|html|\.workspace|\.markdown-preview-view)\s*\{/);
});
test('mobile touch, collapsed filters and card layout are scoped',()=>{
  assert.match(css,/@container \(max-width: 480px\)/);
  assert.match(css,/@media \(pointer: coarse\)/);
  assert.match(css,/min-height: 44px/);
  assert.match(css,/\.ex-search-wrap, \.ex-filter-tags, \.ex-tag-picker\)\[hidden\]/);
});
