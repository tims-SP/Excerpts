const { test } = require('node:test');
const assert = require('node:assert/strict');
const { excerptFileStem, fitFileStem } = require('../.test-compiled/naming.js');
const date = new Date(2026, 9, 24, 0, 11);
const fallback = '摘录 2026-10-24 00-11';

test('explicit H1 takes priority over ordinary text and YAML', () => {
  assert.equal(excerptFileStem('普通文字\n\n# 关于时间的思考\n## 来源\n书籍', date), '关于时间的思考');
  assert.equal(excerptFileStem('---\ntags:\n - 生活\n---\n\n# 标题\n\n正文', date), '标题');
  assert.equal(excerptFileStem('  # 缩进标题\n\n正文', date), '缩进标题');
});
test('plain prose, lists, links and media all use timestamp fallback', () => {
  for (const content of [
    '人生没有白走的路，每一步都算数。',
    '> **生活不在别处**，就在此刻。',
    '- [x] 完成今天的阅读',
    '[一段引文](https://example.com)',
    '![[图片.png|海边日落]]',
    '![[电影.mp4]]',
    '![图片](images/test.jpg)',
    ''
  ]) assert.equal(excerptFileStem(content, date), fallback);
});
test('ignore fake H1 inside YAML, fenced code, indented blocks and comments', () => {
  const doc = '---\ntitle: "# YAML标题"\n---\n<!--\n# 注释标题\n-->\n~~~md\n# 代码标题\n~~~\n    # 缩进代码标题\n> # 引用标题\n## 来源\n正文';
  assert.equal(excerptFileStem(doc, date), fallback);
  assert.equal(excerptFileStem('---\n# yaml comment\n---\n普通摘录', date), fallback);
  assert.equal(excerptFileStem('~~~\n# 代码\n~~~\n# 真正的标题', date), '真正的标题');
});
test('sanitize explicit H1 and handle empty titles', () => {
  assert.equal(excerptFileStem('# 第一章: 过去/未来?', date), '第一章 过去 未来');
  assert.equal(excerptFileStem('# CON', date), '摘录 CON');
  assert.equal(excerptFileStem('# ...', date), fallback);
});
test('truncate long H1 and leave space for unique suffix', () => {
  const stem = excerptFileStem('# 这是一段非常非常长的中文摘录，必须在一定长度后截断，而且不能修改摘录本身', date);
  assert.ok(Array.from(stem).length <= 30);
  assert.ok(stem.endsWith('…'));
  assert.ok(Array.from(fitFileStem(stem, 28) + '-2').length <= 30);
  assert.equal(fitFileStem('短摘录', 28), '短摘录');
});
test('fallback uses device-local time', () => {
  assert.equal(excerptFileStem('正文', date), fallback);
});
