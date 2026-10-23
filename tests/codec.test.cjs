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

test('missing extras boundaries block writes even without item markers',()=>{
  const raw=serializeEntry(example()).replace('<!-- excerpts:extras:start -->','').replace('<!-- excerpts:extras:end -->','');
  const parsed=parseEntry(raw);
  assert.equal(parsed.readOnly,true);
  assert.throws(()=>patchEntry(raw,parsed,parsed),/取消写入/);
});
test('manual content before managed extras is protected from rewriting',()=>{
  const raw=serializeEntry(example()).replace('<!-- excerpts:extras:start -->','## My private notes\\nImportant!\\n\\n<!-- excerpts:extras:start -->'.replaceAll('\\n','\n'));
  const parsed=parseEntry(raw);
  assert.equal(parsed.readOnly,true);
  assert.throws(()=>patchEntry(raw,parsed,parsed));
});
test('unmanaged content inside extras cannot disappear on save',()=>{
  const raw=serializeEntry(example()).replace('<!-- excerpts:extras:end -->','## User notes\\nKeep me\\n<!-- excerpts:extras:end -->'.replaceAll('\\n','\n'));
  const parsed=parseEntry(raw);
  assert.equal(parsed.readOnly,true);
  assert.match(parsed.problem,/附属区/);
});
test('unknown or duplicated extra IDs cannot be serialized',()=>{
  const sample=example();
  assert.throws(()=>serializeEntry({...sample,extras:[sample.extras[0],{...sample.extras[0]}]}),/重复/);
  assert.throws(()=>serializeEntry({...sample,extras:[{...sample.extras[0],kind:'arbitrary'}]}));
});
test('ambiguous managed YAML or tags cannot be overwritten',()=>{
  const raw=serializeEntry(example());
  for (const invalid of [
    raw.replace('tags:\\n'.replace('\\n','\n'),'tags: [abc]\\n'.replace('\\n','\n')),
    raw.replace('excerpts_id:','excerpts_id: "e_shadow"\\nexcerpts_id:'.replace('\\n','\n')),
    raw.replace('excerpts_schema: 1','excerpts_schema: 99')
  ]) {
    const parsed=parseEntry(invalid);
    assert.equal(parsed.readOnly,true);
    assert.throws(()=>patchEntry(invalid,parsed,parsed));
  }
});
test('trailing unmanaged notes survive repeated edits without spacing drift',()=>{
  const raw=serializeEntry(example())+'\\n## Personal notes\\nKeep exact spacing\\n'.replaceAll('\\n','\n');
  const first=parseEntry(raw);
  assert.equal(first.readOnly,undefined);
  const changed={...first,favorite:true};
  const once=patchEntry(raw,first,changed);
  const twice=patchEntry(once,parseEntry(once),changed);
  assert.ok(once.endsWith('\\n\\n## Personal notes\\nKeep exact spacing\\n'.replaceAll('\\n','\n')));
  assert.equal(twice,once);
});
test('foreign paragraph in main quote region is treated as read-only',()=>{
  const raw=serializeEntry(example()).replace('<!-- excerpts:extras:start -->','This line is not a quote\\n\\n<!-- excerpts:extras:start -->'.replaceAll('\\n','\n'));
  assert.equal(parseEntry(raw).readOnly,true);
});

test('reject absolute, platform-reserved and ambiguous paths',()=>{
  for (const invalid of ['/Users/demo','C:\\\\Vault', '//server/share', 'notes//quotes',
    'notes/CON.md', 'notes/trailing.', 'notes/space /item', 'notes/a?.md', 'notes/../escape']) {
    assert.throws(()=>validateRelativePath(invalid),invalid);
  }
  assert.equal(validateRelativePath('笔记\\摘录'), '笔记/摘录');
});

test('non-round-trippable quote whitespace is read-only',()=>{
  const original=serializeEntry(example());
  for (const raw of [
    original.replace('> 有些话','>  有些话'),
    original.replace('> 有些话','> 有些话  '),
    original.replace('\\n\\n<!-- excerpts:extras:start -->'.replaceAll('\\n','\n'),
      '\\n\\n\\n<!-- excerpts:extras:start -->'.replaceAll('\\n','\n'))
  ]) {
    const parsed=parseEntry(raw);
    assert.equal(parsed.readOnly,true);
    assert.throws(()=>patchEntry(raw,parsed,parsed));
  }
});
