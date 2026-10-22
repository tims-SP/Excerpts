const test = require('node:test');
const assert = require('node:assert/strict');
const { serializeEntry, parseEntry, patchEntry } = require('../.test-compiled/codec.js');
const { validateRelativePath, workspacePaths } = require('../.test-compiled/model.js');
const example = () => ({
  id:'e_test',collectionId:'w_test',created:'2026-10-23T00:00:00Z',updated:'2026-10-23T00:00:00Z',favorite:false,
  tags:['文学','A: B'],text:'有些话\n只有沉默以后才听得见。',extras: [
    {id:'x_source',kind:'source',title:'原始出处',content:'- 作者：测试\n- 链接：[[文档]]'},
    {id:'x_var',kind:'variant',title:'改写',content:'> 有些沉默值得倾听。'}
  ]
});
test('Markdown round-trip retains quote, tags and extras',()=>{
  const source=example(), restored=parseEntry(serializeEntry(source));
  assert.deepEqual(restored,source);
});
test('patch preserves user custom YAML and trailing notes',()=>{
  const first=serializeEntry(example()).replace('excerpts_schema: 1','custom_author: "saved"\nexcerpts_schema: 1')+'\n## Unmanaged notes\nDo not delete\n';
  const before=parseEntry(first); const next={...before,favorite:true,tags:['新标签'],extras:before.extras.map(e=>({...e,content:e.content+' updated'}))};
  const after=patchEntry(first,before,next); const parsed=parseEntry(after);
  assert.equal(parsed.favorite,true);assert.deepEqual(parsed.tags,['新标签']);
  assert.match(after,/custom_author: "saved"/);assert.match(after,/Do not delete/);
  assert.match(parsed.extras[0].content,/updated/);
});
test('broken item marker makes document read-only',()=>{
  const damaged=serializeEntry(example()).replace('<!-- excerpts:item:end -->','');
  assert.equal(parseEntry(damaged).readOnly,true);
  assert.throws(()=>patchEntry(damaged,example(),example()));
});
test('reserved markers cannot be injected',()=>{
  assert.throws(()=>serializeEntry({...example(),text:'<!-- excerpts:extras:start -->'}));
});
test('paths are safe and relative',()=>{
  assert.throws(()=>validateRelativePath('../outside'));
  assert.throws(()=>validateRelativePath('.obsidian/plugins'));
  assert.equal(workspacePaths({id:'w',name:'A',rootFolder:'选集/小说',entryFile:'首页.md',cardsFolder:'Cards',attachmentsFolder:'Media'}).cards,'选集/小说/Cards');
});

test('missing outer delimiter with remaining item marker is read-only',()=>{
  const damaged=serializeEntry(example()).replace('<!-- excerpts:extras:start -->','').replace('<!-- excerpts:extras:end -->','');
  assert.equal(parseEntry(damaged).readOnly,true);
});
test('invalid stray item end fails closed',()=>{
  const broken=serializeEntry(example()).replace('<!-- excerpts:extras:start -->','<!-- excerpts:extras:start -->\n<!-- excerpts:item:end -->');
  assert.equal(parseEntry(broken).readOnly,true);
});
