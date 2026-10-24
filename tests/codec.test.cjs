const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseMarkdown, findSectionHeadingLine } = require('../.test-compiled/codec.js');
const { belongsTo, isExcerptPath, validateRelativePath } = require('../.test-compiled/model.js');

test('regular Markdown needs no dedicated schema or frontmatter', () => {
  assert.deepEqual(parseMarkdown('# 时间\n\n普通正文\n\n## 来源\n\n《某本书》\n\n## 批注\n\n自己的理解'), {
    title: '时间', body: '普通正文',
    sections: [{name:'来源',markdown:'《某本书》'},{name:'批注',markdown:'自己的理解'}]
  });
});
test('arbitrary H2 groups, repeated groups and explicit body', () => {
  const doc = parseMarkdown('开头\n\n## 想法\n\nA\n\n## 正文\n\n补充正文\n\n## 想法\n\nB');
  assert.equal(doc.body,'开头');
  assert.deepEqual(doc.sections,[{name:'想法',markdown:'A'},{name:'正文',markdown:'补充正文'},{name:'想法',markdown:'B'}]);
});
test('code fences and nested headings are never treated as H2 boundaries', () => {
  const source = '# 标题\n\n'+'~~~md\n## 假标题\n~~~\n\n## 来源\n\n### 第三章\n内容';
  const doc = parseMarkdown(source);
  assert.match(doc.body,/## 假标题/);
  assert.equal(doc.sections[0].name,'来源');
  assert.match(doc.sections[0].markdown,/### 第三章/);
});
test('frontmatter omitted and first H2 preserved for section-only Markdown', () => {
  const doc = parseMarkdown('---\ntags:\n  - 思考\n---\n\n## 来源\n\n书名\n\n## 批注\n\n说明');
  assert.equal(doc.title,'');
  assert.equal(doc.body,'');
  assert.deepEqual(doc.sections,[{name:'来源',markdown:'书名'},{name:'批注',markdown:'说明'}]);
});
test('duplicated and empty H2 sections stay distinct', () => {
  const result=parseMarkdown('## 来源\n\n## 来源\n\n后半部分');
  assert.deepEqual(result.sections,[{name:'来源',markdown:''},{name:'来源',markdown:'后半部分'}]);
});
test('heading-free files show raw Markdown body without conversions', () => {
  const source = '> 引用\n\n![[图片.png]]\n\n- [x] 完成';
  const doc = parseMarkdown(source);
  assert.equal(doc.body,source);
  assert.deepEqual(doc.sections,[]);
});
test('scope indexes ordinary Markdown within the homepage parent directory', () => {
  const ws={rootFolder:'资料/摘录',homePath:'资料/摘录/首页.excerpts',recursive:true};
  assert.ok(isExcerptPath('资料/摘录/普通.md',ws));
  assert.ok(isExcerptPath('资料/摘录/子目录/普通.md',ws));
  assert.ok(!isExcerptPath('资料/摘录/首页.excerpts',ws));
  assert.ok(!isExcerptPath('资料/摘录/图片.png',ws));
  assert.ok(!isExcerptPath('资料/摘录夹/普通.md',ws));
  assert.ok(!isExcerptPath('资料/摘录/子目录/普通.md',{...ws,recursive:false}));
  assert.ok(belongsTo('a/b.md','a'));
});
test('unsafe Vault relative paths are rejected', () => {
  assert.throws(()=>validateRelativePath('../private'));
  assert.throws(()=>validateRelativePath('/private'));
  assert.throws(()=>validateRelativePath('.obsidian/plugins'));
  assert.equal(validateRelativePath('资料\\摘录/'),'资料/摘录');
});

test('H2 source-line lookup skips YAML and fenced headings, preserves duplicates and CRLF', () => {
  const raw = '---\r\ntags: [例子]\r\n---\r\n\r\n~~~md\r\n## 假分组\r\n~~~\r\n## 来源\r\nA\r\n## 来源\r\nB';
  assert.equal(findSectionHeadingLine(raw, 0), 7);
  assert.equal(findSectionHeadingLine(raw, 1), 9);
  assert.equal(findSectionHeadingLine(raw, 2), null);
  assert.equal(findSectionHeadingLine(raw, -1), null);
});

test('media classification skips code but preserves list continuation indentation',()=>{
  const {visibleMediaMarkdown}=require('../src/codec.ts');
  const source=[
    '- 引文',
    '    ![[清单中的图.png]]',
    '',
    '1. 第二项',
    '   - 子项',
    '     ![[嵌套视频.mp4]]',
    '    \x60\x60\x60md',
    '    ![[代码中的图.jpg]]',
    '    \x60\x60\x60',
    '',
    '    ![[独立缩进代码.png]]'
  ].join('\n');
  const visible=visibleMediaMarkdown(source);
  assert.match(visible,/清单中的图/);
  assert.match(visible,/嵌套视频/);
  assert.doesNotMatch(visible,/代码中的图/);
  assert.doesNotMatch(visible,/独立缩进代码/);
});
