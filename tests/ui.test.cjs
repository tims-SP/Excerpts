/* DOM interaction regressions with Obsidian mocks. Not a real Obsidian client. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://obsidian.local/' });
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
HTMLElement.prototype.empty = function () { this.replaceChildren(); };
HTMLElement.prototype.addClass = function (name) { this.classList.add(name); };
HTMLElement.prototype.setText = function (value) { this.textContent = value; };
HTMLElement.prototype.scrollIntoView = function () {};

class TAbstractFile { constructor(path) { this.path = path; } }
class TFile extends TAbstractFile {}
class TFolder extends TAbstractFile {}
class MarkdownRenderChild { constructor(el) { this.containerEl = el; } }
class Plugin {
  async loadData() { return null; }
  async saveData(value) { this.saved = value; }
  addSettingTab() {}
  registerEvent() {}
  addCommand() {}
  registerMarkdownCodeBlockProcessor(kind, callback) { this.processor = callback; }
}
class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; } }
class Setting {}
class Notice { constructor(message) { Notice.last = message; } }
class Menu {
  constructor() { this.items = []; }
  addItem(cb) {
    const item = {
      setTitle(title) { this.title = title; return this; },
      onClick(action) { this.action = action; return this; }
    };
    cb(item); this.items.push(item); return this;
  }
  showAtPosition() { Menu.last = this; return this; }
}
const replacement = { TAbstractFile, TFile, TFolder, MarkdownRenderChild, Plugin, PluginSettingTab, Setting, Notice, Menu };
const oldLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'obsidian') return replacement;
  return oldLoad.call(this, request, parent, isMain);
};
const Excerpts = require(path.resolve(__dirname, '../main.js'));
Module._load = oldLoad;

async function fixture() {
  const files = new Map();
  let processes = 0;
  const vault = {
    getAbstractFileByPath(p) { return files.get(p)?.file || null; },
    getMarkdownFiles() { return [...files.values()].filter(value => value.file instanceof TFile).map(value => value.file); },
    async createFolder(p) { if (files.has(p)) throw Error('exists'); files.set(p, { file: new TFolder(p) }); },
    async create(p, data) { if (files.has(p)) throw Error('exists'); const file = new TFile(p); files.set(p, { file, data }); return file; },
    async cachedRead(file) { return files.get(file.path).data; },
    async process(file, callback) { processes++; const item = files.get(file.path); item.data = callback(item.data); },
    on() { return {}; }
  };
  const plugin = new Excerpts();
  plugin.app = { vault, workspace: { getLeaf() { return {}; } } };
  await plugin.onload();
  const workspace = await plugin.createWorkspace('测试收藏集', '隔离/摘录');
  const repo = plugin.repo;
  const container = document.createElement('div');
  document.body.append(container);
  let renderer;
  plugin.processor('workspace: ' + workspace.id, container, {
    sourcePath: '隔离/摘录/首页.md', addChild(child) { renderer = child; }
  });
  assert.ok(renderer);
  renderer.onload();
  await renderer.reload();
  return {
    plugin, workspace, repo, renderer, container, files, vault,
    get processes() { return processes; },
    async close() { renderer.onunload(); container.remove(); }
  };
}
function click(scope, label) {
  const found = [...scope.querySelectorAll('button')].find(button => button.textContent.includes(label));
  assert.ok(found, 'Missing button: ' + label);
  found.click(); return found;
}
function type(element, value) {
  assert.ok(element);
  element.value = value;
  element.dispatchEvent(new window.Event('input', { bubbles: true }));
}

test('empty groups stay hidden, menu can create an Extra, and draft survives refresh', async () => {
  const f = await fixture();
  try {
    await f.repo.create(f.workspace, '原文'); await f.renderer.reload();
    assert.equal(f.container.querySelectorAll('.ex-extra-group').length, 0);
    click(f.container, '添加内容');
    assert.deepEqual(Menu.last.items.map(item => item.title), ['来源','变种','批注','上下文','关联','自定义']);
    Menu.last.items.find(item => item.title === '来源').action();
    assert.equal(f.container.querySelectorAll('.ex-extra-group').length, 1);
    const editor = f.container.querySelector('.ex-extra-group .ex-edit-panel');
    type(editor.querySelector('input'), '《作品》');
    type(editor.querySelector('textarea'), '章节：一');
    await f.renderer.reload();
    const restored = f.container.querySelector('.ex-extra-group .ex-edit-panel');
    assert.equal(restored.querySelector('input').value, '《作品》');
    assert.equal(restored.querySelector('textarea').value, '章节：一');
    click(restored, '保存');
    await new Promise(resolve => setImmediate(resolve));
    await f.renderer.reload();
    const list = await f.repo.list(f.workspace);
    assert.equal(list[0].extras.length, 1, 'Unexpected extras; last Notice: ' + Notice.last + '\nRaw: ' + f.files.get(list[0].path).data);
    assert.equal(list[0].extras[0].title, '《作品》');
    assert.equal(list[0].extras[0].content, '章节：一');
    assert.equal(f.container.querySelectorAll('.ex-extra-group').length, 1);
  } finally { await f.close(); }
});

test('quote draft survives refresh but Cancel discards it without writing', async () => {
  const f = await fixture();
  try {
    const entry = await f.repo.create(f.workspace, '原始正文');
    const before = f.files.get(entry.path).data;
    await f.renderer.reload();
    click(f.container, '编辑');
    type(f.container.querySelector('.ex-edit-panel textarea'), '尚未提交的草稿');
    click(f.container, '刷新');
    await f.renderer.reload();
    assert.equal(f.container.querySelector('.ex-edit-panel textarea').value, '尚未提交的草稿');
    click(f.container.querySelector('.ex-edit-panel'), '取消');
    click(f.container, '编辑');
    assert.equal(f.container.querySelector('.ex-edit-panel textarea').value, '原始正文');
    assert.equal(f.files.get(entry.path).data, before);
  } finally { await f.close(); }
});

test('quick capture prevents duplicate saves from clicks and shortcuts', async () => {
  const f = await fixture();
  try {
    const create = f.repo.create.bind(f.repo);
    let release;
    let calls = 0;
    f.repo.create = (...args) => {
      calls++;
      return new Promise(resolve => { release = () => resolve(create(...args)); });
    };
    const editor = f.container.querySelector('.ex-compose-text');
    type(editor, '一次摘录');
    const saveButton = click(f.container, '保存摘录');
    assert.equal(saveButton.disabled, true);
    saveButton.click();
    editor.dispatchEvent(new window.KeyboardEvent('keydown', { ctrlKey: true, key: 'Enter', bubbles: true }));
    assert.equal(calls, 1);
    release();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await f.repo.list(f.workspace)).length, 1);
    assert.equal(saveButton.disabled, false);
    assert.equal(editor.value, '');
  } finally { await f.close(); }
});

test('damaged Markdown remains read-only; random revisit does not write', async () => {
  const f = await fixture();
  try {
    const entry = await f.repo.create(f.workspace, '不能覆盖的原文');
    const data = f.files.get(entry.path);
    data.data = data.data.replace('<!-- excerpts:extras:end -->', '');
    await f.renderer.reload();
    const card = f.container.querySelector('.ex-card');
    assert.match(card.textContent, /仅能阅读/);
    assert.equal([...card.querySelectorAll('button')].some(b => /编辑|珍藏|添加内容/.test(b.textContent)), false);
    await f.repo.create(f.workspace, '可回顾的独特词语');
    await f.renderer.reload();
    type(f.container.querySelector('.ex-toolbar input'), '独特词语');
    click(f.container, '随机回顾');
    assert.match(f.container.querySelector('.ex-card.ex-recalled').textContent, /可回顾的独特词语/);
    assert.equal(f.processes, 0);
  } finally { await f.close(); }
});
