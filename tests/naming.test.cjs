const { test } = require('node:test');
const assert = require('node:assert/strict');
const { excerptFileStem, fitFileStem } = require('../.test-compiled/naming.js');
const date = new Date(2026, 9, 24, 0, 11);

test('H1 takes priority over body and YAML', () => {
  assert.equal(excerptFileStem('普通文字\n\n# 关于时间的思考\n## 来源\n书籍', date), '关于时间的思考');
  assert.equal(excerptFileStem('---\ntags:\n - 生活\n---\n\n# 标题\n\n正文', date), '标题');
});
test('first readable sentence, quotes, tasks and links', () => {
  assert.equal(excerptFileStem('人生没有白走的路，每一步都算数。\n第二句话', date), '人生没有白走的路，每一步都算数。');
  assert.equal(excerptFileStem('> **生活不在别处**，就在此刻。', date), '生活不在别处，就在此刻。');
  assert.equal(excerptFileStem('- [x] 完成今天的阅读', date), '完成今天的阅读');
  assert.equal(excerptFileStem('[一段引文](https://example.com)', date), '一段引文');
});
test('image descriptions and Obsidian embedded aliases', () => {
  assert.equal(excerptFileStem('![海边日落](images/2026.jpg)', date), '海边日落');
  assert.equal(excerptFileStem('![[图片.png|海边日落]]', date), '海边日落');
  assert.equal(excerptFileStem('![[图片.png|300x200]]', date), '摘录 2026-10-24 00-11');
  assert.equal(excerptFileStem('![[电影.mp4]]', date), '摘录 2026-10-24 00-11');
});
test('skip H2 headings, fenced code, comments and YAML', () => {
  const content = '---\ntitle: 内部配置\n---\n<!-- 注释内容 -->\n' +
    '~~~md\n# 代码标题\n~~~\n\n## 来源\n\n真实正文';
  assert.equal(excerptFileStem(content, date), '真实正文');
  assert.equal(excerptFileStem('## 批注\n\n![[附件.pdf]]', date), '摘录 2026-10-24 00-11');
});
test('unsafe names, reserved Windows names and empty content', () => {
  assert.equal(excerptFileStem('# 第一章: 过去/未来?', date), '第一章 过去 未来');
  assert.equal(excerptFileStem('# CON', date), '摘录 CON');
  assert.equal(excerptFileStem('# ...', date), '摘录 2026-10-24 00-11');
  assert.equal(excerptFileStem('', date), '摘录 2026-10-24 00-11');
});
test('truncate by Unicode code points with room for suffix', () => {
  const stem = excerptFileStem('这是一段非常非常长的中文摘录，必须在一定长度后截断，而且不能修改摘录本身', date);
  assert.ok(Array.from(stem).length <= 30, stem);
  assert.ok(stem.endsWith('…'), stem);
  assert.ok(Array.from(fitFileStem(stem, 28) + '-2').length <= 30);
  assert.equal(fitFileStem('短摘录', 28), '短摘录');
});
test('local fallback uses local date, not UTC serialization', () => {
  assert.equal(excerptFileStem('![[图片.png]]', date), '摘录 2026-10-24 00-11');
});
