const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=file=>fs.readFileSync(path.resolve(__dirname,'..',file),'utf8');
test('visual mock tracks current native .excerpts FileView instead of removed collection API',()=>{
  const fixture=read('tests/fixtures/preview-template.html');
  const visual=read('scripts/visual-check.py');
  const spacing=read('scripts/spacing-check.py');
  assert.match(fixture,/class FileView/);
  assert.match(fixture,/首页\.excerpts/);
  assert.match(fixture,/pane\.openFile\(home\)/);
  assert.match(fixture,/__EXCERPTS_BUNDLE__/);
  for(const [name,contents] of [['fixture',fixture],['visual',visual],['spacing',spacing]]){
    assert.doesNotMatch(contents,/createWorkspace|plugin\.processor|ex-extra-editor|ex-extra-item/,name);
  }
  assert.match(visual,/ex-entry-editor/);
  assert.match(visual,/ex-group-trigger/);
  assert.match(spacing,/ex-editor-text/);
  assert.match(spacing,/ex-group-trigger/);
});
test('v3 H2 and editor styles remain local to Excerpts root',()=>{
  const css=read('styles.css');
  for(const name of ['.ex-group-trigger','.ex-group-body','.ex-tag-picker','.ex-tag-pill','.ex-entry-editor','.ex-editor-text','.ex-edit-actions'])
    assert.ok(css.includes('.excerpts-root '+name) || css.includes('.excerpts-root button'+name) ||
      css.includes('.excerpts-root textarea'+name),name);
  assert.match(css,/\.ex-card\.ex-is-editing/);
  assert.match(css,/@media \(pointer: coarse\)/);
});
