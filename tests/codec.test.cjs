const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseMarkdown } = require('../.test-compiled/codec.js');
const { belongsTo, isExcerptPath, validateRelativePath } = require('../.test-compiled/model.js');

test('regular Markdown needs no dedicated schema or frontmatter', () => {
  assert.deepEqual(parseMarkdown('# 时间\n\n普通正文\n\n## 来源\n\n《某本书》\n\n## 批注\n\n自己的理解'), {
    title: '时间', body: '普通正文',
    sections: [{name:'来源',markdown:'《某本书》'},{name:'批注',markdown:'自己的理解'}]
  });
});
test('arbitrary H2 groups, repeated groups and explicit body', () => {
  const doc = parseMarkdown('开头\n\n## 想法\n\nA\n\n## 正文\n\n补充正文\n\n## 想法\n\nB');
  assert.equal(doc.body,'开头\n\n补充正文');
  assert.deepEqual(doc.sections,[{name:'想法',markdown:'A\n\nB'}]);
});
test('code fences and nested headings are never treated as H2 boundaries', () => {
  const source = '# 标题\n\n'+'~~~md\n## 假标题\n~~~\n\n## 来源\n\n### 第三章\n内容';
  const doc = parseMarkdown(source);
  assert.match(doc.body,/## 假标题/);
  assert.equal(doc.sections[0].name,'来源');
  assert.match(doc.sections[0].markdown,/### 第三章/);
});
test('frontmatter is omitted from display; section-only Markdown still has a body', () => {
  const doc = parseMarkdown('---\ntags:\n  - 思考\n---\n\n## 来源\n\n书名\n\n## 批注\n\n说明');
  assert.equal(doc.title,'');
  assert.equal(doc.body,'书名');
  assert.equal(doc.sections[0].name,'批注');
});
test('heading-free files show raw Markdown body without conversions', () => {
  const source = '> 引用\n\n![[图片.png]]\n\n- [x] 完成';
  const doc = parseMarkdown(source);
  assert.equal(doc.body,source);
  assert.deepEqual(doc.sections,[]);
});
test('scope accepts nested Markdown and excludes old draft/recycle paths', () => {
  const ws={rootFolder:'资料/摘录',recursive:true};
  assert.ok(isExcerptPath('资料/摘录/普通.md',ws));
  assert.ok(isExcerptPath('资料/摘录/子目录/普通.md',ws));
  assert.ok(!isExcerptPath('资料/摘录/Excerpts-Drafts/abc.md',ws));
  assert.ok(!isExcerptPath('资料/摘录/Excerpts-Recycle/abc.md',ws));
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
