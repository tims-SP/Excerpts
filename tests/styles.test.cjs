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
  assert.match(css,/\.excerpts-root \.ex-search-wrap\[hidden\]/);
});

test('card edit and tag components have scoped styles',()=>{
  for(const name of ['.ex-entry-editor','.ex-editor-text','.ex-edit-actions','.ex-tag-editor','.ex-tag-custom','.ex-tag-option','.ex-group-body','.ex-warning'])
    assert.ok(css.includes('.excerpts-root '+name),'missing '+name);
  assert.ok(css.includes('.ex-card-footer[hidden]'));
  assert.ok(css.includes('max-width: 720px'));
});

test('regression: expanded tag input never inherits vertical 100-percent flex basis',()=>{
  assert.match(css,/\.excerpts-root \.ex-tag-custom\s*\{[^}]*flex:\s*0\s+0\s+auto;/);
  assert.match(css,/\.excerpts-root \.ex-tag-custom\s*\{[^}]*height:\s*44px;/);
  assert.doesNotMatch(css,/\.excerpts-root \.ex-tag-custom\s*\{[^}]*flex:\s*0\s+0\s+100%/);
  assert.match(css,/\.excerpts-root \.ex-card\.ex-card-no-tags > \.ex-chips\s*\{[^}]*display:\s*none/);
  assert.match(css,/\.excerpts-root \.ex-card\.ex-card-no-tags \.ex-footer-tag\s*\{[^}]*display:\s*inline-flex/);
  assert.match(css,/\.excerpts-root \.ex-card\.ex-editing\s*\{[^}]*border-color/);
});

test('tag custom input cannot consume entire column height',()=>{
  assert.match(css,/\.ex-tag-custom\s*\{[^}]*flex:\s*0 1 auto;/);
  assert.doesNotMatch(css,/\.ex-tag-custom\s*\{\s*flex:\s*0 0 100%/);
});

test('tag editor input does not use 100 percent flex basis in column layout',()=>{
  assert.match(css,/\.excerpts-root \.ex-tag-custom \{ flex: 0 1 auto; width: 100%;/);
  assert.doesNotMatch(css,/\.excerpts-root \.ex-tag-custom \{ flex: 0 0 100%; \}/);
});
