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
HTMLElement.prototype.createDiv = function (options) {
  const el = document.createElement('div');
  if (options?.cls) el.className = options.cls;
  this.appendChild(el); return el;
};
HTMLElement.prototype.scrollIntoView = function () {};

class TAbstractFile { constructor(path) { this.path = path; } }
class TFile extends TAbstractFile {}
class TFolder extends TAbstractFile {}
class MarkdownRenderChild { constructor(el) { this.containerEl = el; } }
class ItemView {
  constructor(leaf) { this.leaf = leaf; this.contentEl = document.createElement('div'); }
  async setState(state) { this.state = state; }
}
class Plugin {
  registerView(kind, factory) { this.viewType = kind; this.viewFactory = factory; }
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
class Modal {
  constructor() { this.contentEl = document.createElement('div'); Modal.last = this; }
  open() { this.isOpen = true; }
  close() { this.isOpen = false; }
}
function setIcon(el, name) { el.setAttribute('data-icon', name); const svg=document.createElement('svg');svg.setAttribute('aria-hidden', 'true');el.append(svg); }
const replacement = { TAbstractFile, TFile, TFolder, ItemView, MarkdownRenderChild, Plugin, PluginSettingTab, Setting, Notice, Menu, Modal, setIcon };
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
    async read(file) { return files.get(file.path).data; },
    async rename(file, next) {
      if (files.has(next)) throw Error('destination occupied');
      const item = files.get(file.path);
      if (!item) throw Error('source missing');
      files.delete(file.path); file.path = next; files.set(next, item);
    },
    async process(file, callback) { processes++; const item = files.get(file.path); item.data = callback(item.data); },
    on() { return {}; }
  };
  const plugin = new Excerpts();
  const workspaceEvents = new Map();
  const activeLeaf = { view: { getViewType: () => 'markdown' }, async setViewState(state) { this.lastState = state; }, };
  plugin.app = { vault, workspace: { activeLeaf, on(type, cb) { workspaceEvents.set(type, cb); return {}; }, onLayoutReady(cb) { this.layoutReady = cb; }, getActiveFile() { return null; }, getLeaf() { return activeLeaf; }, async revealLeaf() {} } };
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
    plugin, workspace, repo, renderer, container, files, vault, workspaceEvents,
    get processes() { return processes; },
    async close() { renderer.onunload(); container.remove(); }
  };
}
function click(scope, label) {
  const candidates = [...scope.querySelectorAll('button')].filter(button => !button.hidden && !button.closest('[hidden]'));
  const exact = candidates.find(button => button.textContent.trim() === label || button.getAttribute('aria-label') === label);
  const found = exact || candidates.find(button =>
    button.textContent.replace(/\s+/g, ' ').includes(label.replace(/\s+/g, ' ')) || button.getAttribute('aria-label')?.includes(label));
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
    click(f.container, '列表选项');
    Menu.last.items.find(item => item.title === '刷新').action();
    await f.renderer.reload();
    assert.equal(f.container.querySelector('.ex-edit-panel textarea').value, '尚未提交的草稿');
    click(f.container.querySelector('.ex-edit-panel'), '取消');
    assert.equal(Modal.last.isOpen, true, 'Unsaved edits require explicit discard');
    click(Modal.last.contentEl, '放弃更改');
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
    const saveButton = click(f.container, '保存');
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
    click(f.container, '搜索');
    type(f.container.querySelector('.ex-search-wrap input'), '独特词语');
    click(f.container, '随机回顾');
    assert.match(f.container.querySelector('.ex-card.ex-recalled').textContent, /可回顾的独特词语/);
    assert.equal(f.processes, 0);
  } finally { await f.close(); }
});

test('native confirmation archives intact Markdown; Undo restores without overwriting', async () => {
  const f = await fixture();
  try {
    const entry = await f.repo.create(f.workspace, '保留原文');
    const original = f.files.get(entry.path).data;
    await f.renderer.reload();
    click(f.container, '更多');
    const action = Menu.last.items.find(item => item.title === '移至回收站');
    assert.ok(action);
    action.action();
    assert.equal(Modal.last.isOpen, true);
    assert.match(Modal.last.contentEl.textContent, /不会永久删除/);
    click(Modal.last.contentEl, '取消');
    assert.equal(Modal.last.isOpen, false);
    assert.equal(f.files.get(entry.path).data, original);
    click(f.container, '更多');
    Menu.last.items.find(item => item.title === '移至回收站').action();
    click(Modal.last.contentEl, '移至回收站');
    await new Promise(resolve => setImmediate(resolve));
    await f.renderer.reload();
    assert.equal(f.files.has(entry.path), false);
    assert.equal(f.container.querySelectorAll('.ex-card').length, 0);
    const archived = [...f.files.entries()].find(([p]) => p.includes('/Excerpts-Recycle/'));
    assert.ok(archived);
    assert.equal(archived[1].data, original);
    const undo = [...f.container.querySelectorAll('button')].find(b => b.textContent.includes('撤销删除'));
    assert.equal(undo.hidden, false);
    undo.click();
    await new Promise(resolve => setImmediate(resolve));
    await f.renderer.reload();
    assert.equal(f.files.get(entry.path).data, original);
    assert.equal(undo.hidden, true);
    assert.equal(f.container.querySelectorAll('.ex-card').length, 1);
  } finally { await f.close(); }
});

test('undo leaves both files untouched if another note occupies the old path', async () => {
  const f = await fixture();
  try {
    const entry = await f.repo.create(f.workspace, '需要恢复');
    await f.renderer.reload();
    click(f.container, '更多');
    Menu.last.items.find(item => item.title === '移至回收站').action();
    click(Modal.last.contentEl, '移至回收站');
    await new Promise(resolve => setImmediate(resolve));
    const receipt = f.renderer.lastTrash;
    assert.ok(receipt);
    const archived = f.files.get(receipt.recyclePath).data;
    f.files.set(entry.path, { file: new TFile(entry.path), data: 'other note' });
    click(f.container, '撤销删除');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.files.get(entry.path).data, 'other note');
    assert.equal(f.files.get(receipt.recyclePath).data, archived);
    assert.match(Notice.last, /拒绝覆盖/);
    assert.ok(f.renderer.lastTrash);
  } finally { await f.close(); }
});

test('deleting one Extra can be undone without changing other content', async () => {
  const f = await fixture();
  try {
    const initial = await f.repo.create(f.workspace, '不变的摘录', ['标签']);
    await f.repo.update(initial, previous => ({ ...previous, extras: [
      { id: 'x_a', kind: 'source', title: '来源一', content: '第一卷' },
      { id: 'x_b', kind: 'source', title: '来源二', content: '第二卷' }
    ] }));
    await f.renderer.reload();
    click(f.container.querySelector('.ex-card'), '来源  2');
    click(f.container.querySelector('.ex-card'), '修改');
    click(f.container.querySelector('.ex-card'), '删除条目');
    click(f.container.querySelector('.ex-card'), '确认删除');
    await new Promise(resolve => setImmediate(resolve));
    let entry = (await f.repo.list(f.workspace))[0];
    assert.deepEqual(entry.extras.map(e => e.id), ['x_b']);
    assert.equal(entry.text, '不变的摘录');
    const undo = click(f.container, '撤销附属删除');
    await new Promise(resolve => setImmediate(resolve));
    entry = (await f.repo.list(f.workspace))[0];
    assert.deepEqual(entry.extras.map(e => e.id), ['x_a','x_b']);
    assert.deepEqual(entry.extras.map(e => e.content), ['第一卷','第二卷']);
    assert.deepEqual(entry.tags, ['标签']);
    assert.equal(undo.hidden, true);
  } finally { await f.close(); }
});

test('Extra undo refuses to overwrite a newer externally changed entry', async () => {
  const f = await fixture();
  try {
    const initial = await f.repo.create(f.workspace, '原文');
    await f.repo.update(initial, x => ({ ...x, extras: [
      { id: 'x_a', kind: 'source', title: '来源', content: '一' }
    ] }));
    await f.renderer.reload();
    click(f.container, '来源  1');
    click(f.container, '修改');
    click(f.container, '删除条目');
    click(f.container, '确认删除');
    await new Promise(resolve => setImmediate(resolve));
    const deleted = (await f.repo.list(f.workspace))[0];
    const newState = await f.repo.update(deleted, x => ({ ...x, text: '外部新修改' }));
    const expected = f.files.get(newState.path).data;
    click(f.container, '撤销附属删除');
    await new Promise(resolve => setImmediate(resolve));
    assert.match(Notice.last, /刷新后重试/);
    assert.equal(f.files.get(newState.path).data, expected);
    assert.equal((await f.repo.list(f.workspace))[0].extras.length, 0);
  } finally { await f.close(); }
});

test('archiving is blocked while an unsaved quote draft exists', async () => {
  const f = await fixture();
  try {
    const original = await f.repo.create(f.workspace, '保存的版本');
    const raw = f.files.get(original.path).data;
    await f.renderer.reload();
    click(f.container, '编辑');
    type(f.container.querySelector('.ex-edit-panel textarea'), '未保存的正文');
    click(f.container, '更多');
    Menu.last.items.find(item => item.title === '移至回收站').action();
    assert.match(Notice.last, /未保存的编辑草稿/);
    assert.equal(f.files.get(original.path).data, raw);
    assert.equal(f.renderer.lastTrash, null);
    assert.equal(f.container.querySelector('.ex-edit-panel textarea').value, '未保存的正文');
    click(f.container.querySelector('.ex-edit-panel'), '取消');
    click(Modal.last.contentEl, '放弃更改');
    click(f.container, '更多');
    Menu.last.items.find(item => item.title === '移至回收站').action();
    assert.equal(Modal.last.isOpen, true);
    click(Modal.last.contentEl, '取消');
  } finally { await f.close(); }
});

async function reopenRenderer(f) {
  f.renderer.onunload();
  f.container.replaceChildren();
  let next;
  f.plugin.processor('workspace: ' + f.workspace.id, f.container, {
    sourcePath: '隔离/摘录/首页.md',
    addChild(child) { next = child; }
  });
  f.renderer = next;
  next.onload();
  await new Promise(resolve => setTimeout(resolve, 35));
  await next.reload();
}

test('capture draft survives renderer restart and resolves only after a successful save', async () => {
  const f = await fixture();
  try {
    const composer = f.container.querySelector('.ex-compose-text');
    type(composer, '重启后恢复的摘录');
    type(f.container.querySelector('.ex-tags-input'), '恢复, 草稿');
    await new Promise(resolve => setTimeout(resolve, 430));
    const draftFiles = [...f.files.keys()].filter(p => /Excerpts-Drafts\/d_.*\.md$/.test(p));
    assert.equal(draftFiles.length, 1);
    assert.match(f.files.get(draftFiles[0]).data, /重启后恢复的摘录/);
    assert.equal(f.plugin.saved.workspaces.length, 1);
    assert.equal('drafts' in f.plugin.saved, false);
    await reopenRenderer(f);
    click(f.container, '恢复未保存输入');
    assert.equal(f.container.querySelector('.ex-compose-text').value, '重启后恢复的摘录');
    assert.equal(f.container.querySelector('.ex-tags-input').value, '');
    assert.deepEqual([...f.container.querySelectorAll('.ex-composer .ex-tag-chip span:first-child')].map(x => x.textContent), ['#恢复', '#草稿']);
    click(f.container, '保存');
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal((await f.repo.list(f.workspace)).length, 1);
    assert.deepEqual((await f.repo.list(f.workspace))[0].tags, ['恢复', '草稿']);
    assert.equal(f.files.has(draftFiles[0]), false);
    assert.ok([...f.files.keys()].some(p => p.includes('/Excerpts-Drafts/Resolved/')));
  } finally { await f.close(); }
});

test('quote edit draft survives restart without automatically altering the Entry', async () => {
  const f = await fixture();
  try {
    const original = await f.repo.create(f.workspace, '旧正文');
    await f.renderer.reload();
    click(f.container, '编辑');
    type(f.container.querySelector('.ex-edit-panel textarea'), '尚未提交的新正文');
    await new Promise(resolve => setTimeout(resolve, 430));
    assert.equal((await f.repo.list(f.workspace))[0].text, '旧正文');
    await reopenRenderer(f);
    click(f.container, '恢复草稿');
    assert.equal(f.container.querySelector('.ex-edit-panel textarea').value, '尚未提交的新正文');
    assert.equal(f.files.get(original.path).data.includes('尚未提交的新正文'), false);
    click(f.container.querySelector('.ex-edit-panel'), '保存修改');
    await new Promise(resolve => setTimeout(resolve, 65));
    assert.equal((await f.repo.list(f.workspace))[0].text, '尚未提交的新正文');
    assert.ok([...f.files.keys()].some(p => p.includes('/Excerpts-Drafts/Resolved/')));
  } finally { await f.close(); }
});

test('quote draft conflict stays copy-only and cannot overwrite external edits', async () => {
  const f = await fixture();
  try {
    const original = await f.repo.create(f.workspace, '起始正文');
    await f.renderer.reload();
    click(f.container, '编辑');
    type(f.container.querySelector('.ex-edit-panel textarea'), '重要的草稿');
    await new Promise(resolve => setTimeout(resolve, 430));
    const source = (await f.repo.list(f.workspace))[0];
    await f.repo.update(source, x => ({ ...x, text: '外部更新正文' }));
    await reopenRenderer(f);
    click(f.container, '恢复草稿');
    assert.match(Modal.last.contentEl.textContent, /版本冲突/);
    assert.equal(Modal.last.contentEl.querySelector('textarea').readOnly, true);
    assert.equal(Modal.last.contentEl.querySelector('textarea').value, '重要的草稿');
    assert.equal((await f.repo.list(f.workspace))[0].text, '外部更新正文');
    assert.ok([...f.files.keys()].some(p => /Excerpts-Drafts\/d_.*\.md$/.test(p)));
  } finally { await f.close(); }
});

test('a manually corrupted draft is not offered or overwritten', async () => {
  const f = await fixture();
  try {
    type(f.container.querySelector('.ex-compose-text'), '文件结构待保护');
    await new Promise(resolve => setTimeout(resolve, 430));
    const p = [...f.files.keys()].find(path => /Excerpts-Drafts\/d_.*\.md$/.test(path));
    assert.ok(p);
    const corrupted = f.files.get(p).data.replace('~~~json', '~~~javascript');
    f.files.get(p).data = corrupted;
    await reopenRenderer(f);
    const recovery = [...f.container.querySelectorAll('button')].find(b => b.textContent.includes('恢复未保存输入'));
    assert.equal(recovery.hidden, true);
    assert.equal(f.files.get(p).data, corrupted);
  } finally { await f.close(); }
});


test('native theme UI exposes icon-only actions with accessible labels', async () => {
  const f = await fixture();
  try {
    await f.repo.create(f.workspace, '卡片内容', ['文学']);
    await f.renderer.reload();
    const header = f.container.querySelector('.ex-header');
    assert.equal(header.querySelector('.ex-eyebrow'), null, 'old decorative English title must disappear');
    assert.equal(header.querySelector('.ex-title').textContent, '测试收藏集');
    assert.ok(f.container.querySelector('button[aria-label="随机回顾"] [aria-hidden="true"]'));
    const card = f.container.querySelector('.ex-card');
    assert.ok(card.querySelector('button[aria-label="编辑"] [aria-hidden="true"]'));
    assert.equal(card.querySelector('button[aria-label="珍藏"]').getAttribute('aria-pressed'), 'false');
    click(card, '珍藏');
    await new Promise(resolve => setImmediate(resolve));
    await f.renderer.reload();
    assert.equal(f.container.querySelector('button[aria-label="取消珍藏"]').getAttribute('aria-pressed'), 'true');
    assert.ok(f.container.querySelector('.ex-toolbar-title .ex-list-heading'));
    assert.equal(f.container.querySelectorAll('.ex-extra-group').length, 0);
  } finally { await f.close(); }
});

test('dedicated view is registered and homepage opens it without changing ordinary files', async () => {
  const f = await fixture();
  try {
    assert.equal(f.plugin.viewType, 'excerpts-collection');
    const fileOpen = f.workspaceEvents.get('file-open');
    assert.equal(typeof fileOpen, 'function');
    const leaf = f.plugin.app.workspace.activeLeaf;
    fileOpen(new TFile('普通笔记.md'));
    assert.equal(leaf.lastState, undefined);
    fileOpen(new TFile('隔离/摘录/首页.md'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(leaf.lastState.type, 'excerpts-collection');
    assert.equal(leaf.lastState.state.workspaceId, f.workspace.id);
    f.plugin.settings.autoOpenHome = false;
    leaf.lastState = undefined;
    fileOpen(new TFile('隔离/摘录/首页.md'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(leaf.lastState, undefined, 'opt-out must allow editing the original Markdown homepage');
    const view = f.plugin.viewFactory(leaf);
    assert.equal(view.getDisplayText(), '摘录');
    await view.setState({ workspaceId: f.workspace.id }, {});
    assert.ok(view.contentEl.querySelector('.excerpts-root'));
    await view.onClose();
  } finally { await f.close(); }
});

test('capture is compact, optional fields and search are hidden until requested', async () => {
  const f = await fixture();
  try {
    const quote = f.container.querySelector('.ex-compose-text');
    assert.equal(quote.placeholder, '记录你想留下的文字……');
    assert.equal(quote.rows, 2);
    const tags = f.container.querySelector('.ex-tags-input');
    assert.equal(tags.hidden, true);
    click(f.container, '添加标签');
    assert.equal(tags.hidden, false);
    const search = f.container.querySelector('.ex-search-wrap');
    assert.equal(search.hidden, true);
    click(f.container, '搜索');
    assert.equal(search.hidden, false);
    assert.equal(f.container.querySelector('.ex-filter-tags'), null, 'no redundant All tag on empty collection');
    assert.ok(f.container.querySelector('.ex-compose-actions .ex-btn-primary'));
  } finally { await f.close(); }
});


test('composer focus and Escape close optional inputs with accessible focus', async () => {
  const f = await fixture();
  try {
    const quote = f.container.querySelector('.ex-compose-text');
    quote.dispatchEvent(new window.Event('focus'));
    assert.ok(f.container.querySelector('.ex-composer').classList.contains('ex-is-composing'));
    const tagsToggle = click(f.container, '添加标签');
    const tags = f.container.querySelector('.ex-tags-input');
    assert.equal(tagsToggle.getAttribute('aria-expanded'), 'true');
    assert.equal(tagsToggle.getAttribute('aria-controls'), tags.id);
    tags.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(tags.hidden, true);
    const searchToggle = click(f.container, '搜索');
    const input = f.container.querySelector('.ex-search-wrap input');
    assert.equal(searchToggle.getAttribute('aria-controls'), input.parentElement.id);
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(input.parentElement.hidden, true);
    assert.equal(searchToggle.getAttribute('aria-expanded'), 'false');
  } finally { await f.close(); }
});

test('keyboard focus survives a feed refresh when the original control still exists', async () => {
  const f = await fixture();
  try {
    await f.repo.create(f.workspace, '一条可以阅读的摘录');
    await f.renderer.reload();
    const more = f.container.querySelector('button[aria-label="更多摘录操作"]');
    more.focus();
    assert.equal(document.activeElement, more);
    await f.renderer.reload();
    assert.equal(document.activeElement?.getAttribute('aria-label'), '更多摘录操作');
    assert.ok(f.container.querySelector('.ex-count[role="status"][aria-live="polite"]'));
  } finally { await f.close(); }
});

test('Ctrl+Enter saves an existing quote editor without disturbing unrelated notes', async () => {
  const f = await fixture();
  try {
    const entry = await f.repo.create(f.workspace, '初始文字');
    await f.renderer.reload();
    click(f.container, '编辑');
    const editor = f.container.querySelector('.ex-edit-panel textarea');
    type(editor, '调整后的摘录');
    editor.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await f.repo.list(f.workspace))[0].text, '调整后的摘录');
    assert.equal(f.files.get(entry.path).data.includes('调整后的摘录'), true);
  } finally { await f.close(); }
});

test('card menu offers editing, favorite toggle, copy and safe archive', async () => {
  const f = await fixture();
  try {
    await f.repo.create(f.workspace, '需要复制的原文');
    await f.renderer.reload();
    click(f.container, '更多摘录操作');
    assert.deepEqual(Menu.last.items.map(x => x.title), ['珍藏', '编辑摘录', '复制正文', '移至回收站']);
    assert.equal(f.container.querySelector('time.ex-date').hasAttribute('datetime'), true);
    const tag = f.container.querySelector('.ex-filter-tags button');
    assert.equal(tag, null, 'empty tag filter is not rendered');
  } finally { await f.close(); }
});

test('Ctrl+Enter in supplementary editor saves the text and leaves the quote intact', async () => {
  const f = await fixture();
  try {
    await f.repo.create(f.workspace, '不会被修改的主摘录');
    await f.renderer.reload();
    click(f.container, '添加内容');
    Menu.last.items.find(x => x.title === '变种').action();
    const edit = f.container.querySelector('.ex-extra-group .ex-edit-panel');
    type(edit.querySelector('input'), '译文差异');
    type(edit.querySelector('textarea'), '翻译后的不同版本');
    edit.querySelector('textarea').dispatchEvent(new window.KeyboardEvent('keydown', {key:'Enter',metaKey:true,bubbles:true,cancelable:true}));
    await new Promise(resolve => setImmediate(resolve));
    const saved = (await f.repo.list(f.workspace))[0];
    assert.equal(saved.text, '不会被修改的主摘录');
    assert.equal(saved.extras[0].title, '译文差异');
    assert.equal(saved.extras[0].content, '翻译后的不同版本');
  } finally { await f.close(); }
});

test('keyboard capture remains ready for the next excerpt after Ctrl+Enter', async () => {
  const f = await fixture();
  try {
    const quote = f.container.querySelector('.ex-compose-text');
    quote.focus();
    type(quote, '第一条，继续输入');
    quote.dispatchEvent(new window.KeyboardEvent('keydown', { ctrlKey: true, key: 'Enter', bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(quote.value, '');
    assert.equal(document.activeElement, quote);
    assert.equal((await f.repo.list(f.workspace)).length, 1);
  } finally { await f.close(); }
});

test('long excerpts expand without changing stored Markdown', async () => {
  const f = await fixture();
  try {
    const longText = '摘录内容。'.repeat(120);
    const entry = await f.repo.create(f.workspace, longText);
    const before = f.files.get(entry.path).data;
    await f.renderer.reload();
    const quote = f.container.querySelector('.ex-quote');
    assert.ok(quote.textContent.length < longText.length);
    const toggle = click(f.container, '展开全文');
    assert.ok(f.container.querySelector('.ex-quote').textContent.length === longText.length);
    click(f.container, '收起全文');
    assert.equal(f.files.get(entry.path).data, before);
    assert.equal(f.processes, 0);
  } finally { await f.close(); }
});


test('list actions use one native overflow menu instead of permanent refresh and filter icons', async () => {
  const f = await fixture();
  try {
    assert.equal(f.container.querySelectorAll('.ex-toolbar-actions button').length, 3);
    click(f.container, '列表选项');
    assert.deepEqual(Menu.last.items.map(x => x.title), ['标签筛选','刷新']);
    Menu.last.items[0].action();
    assert.equal(f.renderer.filterOpen, true);
  } finally { await f.close(); }
});

test('source editor draft survives renderer teardown and can be restored', async () => {
  const f = await fixture();
  let next = null;
  const another = document.createElement('div');
  try {
    await f.repo.create(f.workspace, '摘录正文'); await f.renderer.reload();
    click(f.container, '添加内容');
    Menu.last.items.find(i => i.title === '来源').action();
    const editor = f.container.querySelector('.ex-extra-editor');
    type(editor.querySelector('input'), '《第二版来源》');
    type(editor.querySelector('textarea'), '页码：第九页');
    await new Promise(resolve => setTimeout(resolve, 500));
    f.renderer.onunload();
    document.body.append(another);
    f.plugin.processor('workspace: ' + f.workspace.id, another, {
      sourcePath: '隔离/摘录/首页.md', addChild(child) { next = child; }
    });
    assert.ok(next);
    next.onload();
    await next.reload();
    await next.loadDrafts();
    click(another, '添加内容');
    Menu.last.items.find(i => i.title === '来源').action();
    click(another, '恢复上次编辑');
    const restored = another.querySelector('.ex-extra-editor');
    assert.equal(restored.querySelector('input').value, '《第二版来源》');
    assert.equal(restored.querySelector('textarea').value, '页码：第九页');
    const entries = await f.repo.list(f.workspace);
    assert.equal(entries[0].extras.length, 0, 'Recovery must not modify the original entry without save');
  } finally {
    next?.onunload(); another.remove(); await f.close();
  }
});

test('IME composition does not submit entry or extra editors', async () => {
  const f = await fixture();
  try {
    const entry = await f.repo.create(f.workspace, '原文');
    await f.renderer.reload();
    click(f.container, '编辑');
    const edit = f.container.querySelector('.ex-entry-editor textarea');
    type(edit, '新正文');
    edit.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true, bubbles: true }));
    await new Promise(r => setImmediate(r));
    assert.equal((await f.repo.list(f.workspace))[0].text, '原文');
    click(f.container, '取消');
    click(Modal.last.contentEl, '放弃更改');
    click(f.container, '添加内容');
    Menu.last.items.find(i => i.title === '变种').action();
    const extra = f.container.querySelector('.ex-extra-editor textarea');
    type(extra, '变种草稿');
    extra.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true, bubbles: true }));
    await new Promise(r => setImmediate(r));
    assert.equal((await f.repo.list(f.workspace))[0].extras.length, 0);
  } finally { await f.close(); }
});

test('editing field retains focus and caret through list refresh', async () => {
  const f = await fixture();
  try {
    await f.repo.create(f.workspace, '初始文本');
    await f.renderer.reload();
    click(f.container, '编辑');
    const textarea = f.container.querySelector('.ex-entry-editor textarea');
    type(textarea, '中英文 mixed text');
    textarea.focus(); textarea.setSelectionRange(3, 8);
    await f.renderer.reload();
    const restored = f.container.querySelector('.ex-entry-editor textarea');
    assert.equal(document.activeElement, restored);
    assert.equal(restored.selectionStart, 3);
    assert.equal(restored.selectionEnd, 8);
  } finally { await f.close(); }
});

test('tag picker stays collapsed until Add and supports repeated suggestions, custom chips and single-save', async () => {
  const f = await fixture();
  try {
    await f.repo.create(f.workspace, '标签样本', ['哲学', '文学']);
    const target = await f.repo.create(f.workspace, '编辑目标', ['文学']);
    await f.renderer.reload();
    const card = [...f.container.querySelectorAll('.ex-card')].find(x => x.dataset.entryId === target.id);
    click(card, '编辑');
    const editor = card.querySelector('.ex-entry-editor');
    assert.equal(editor.querySelector('.ex-tag-entry').hidden, true, 'Suggestions stay closed by default');
    assert.equal(card.querySelector('.ex-chips'), null, 'Reading-only duplicate tags must be hidden in editing');
    click(editor, '添加标签');
    assert.equal(editor.querySelector('.ex-tag-entry').hidden, false);
    click(editor, '添加已有标签：哲学');
    assert.equal(editor.querySelector('.ex-tag-entry').hidden, false, 'Allow sequential additions');
    assert.deepEqual([...editor.querySelectorAll('.ex-tag-chip span:first-child')].map(x => x.textContent), ['#文学', '#哲学']);
    type(editor.querySelector('.ex-tag-entry input'), '创作');
    editor.querySelector('.ex-tag-entry input').dispatchEvent(new window.KeyboardEvent('keydown',
      { key: 'Enter', bubbles: true, cancelable: true }));
    assert.ok([...editor.querySelectorAll('.ex-tag-chip')].some(x => x.textContent.includes('#创作')));
    click(editor, '移除标签：文学');
    click(editor, '完成');
    assert.equal(editor.querySelector('.ex-tag-entry').hidden, true);
    assert.match(editor.querySelector('.ex-editor-status').textContent, /未保存/);
    click(editor, '保存修改');
    await new Promise(resolve => setImmediate(resolve));
    const saved = (await f.repo.list(f.workspace)).find(x => x.id === target.id);
    assert.deepEqual(saved.tags, ['哲学', '创作']);
    assert.equal(saved.text, '编辑目标');
    assert.equal(f.container.querySelector('.ex-entry-editor'), null);
  } finally { await f.close(); }
});

test('capture tag chips are submitted only with the excerpt and recoverable after picker closes', async () => {
  const f = await fixture();
  try {
    const form = f.container.querySelector('.ex-composer');
    const input = form.querySelector('.ex-tags-input');
    type(form.querySelector('.ex-compose-text'), '带标签的新摘录');
    click(form, '添加标签');
    type(input, '阅读');
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal((await f.repo.list(f.workspace)).length, 0, 'Tag operations must not write an Entry');
    click(form, '完成');
    assert.equal(input.hidden, true);
    assert.ok(form.querySelector('.ex-tag-chip').textContent.includes('#阅读'));
    click(form, '保存');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual((await f.repo.list(f.workspace))[0].tags, ['阅读']);
  } finally { await f.close(); }
});

test('IME selection cannot commit or save tags while composing', async () => {
  const f = await fixture();
  try {
    await f.repo.create(f.workspace, '正文');
    await f.renderer.reload();
    click(f.container, '编辑');
    const editor = f.container.querySelector('.ex-entry-editor');
    click(editor, '添加标签');
    const input = editor.querySelector('.ex-tags-input');
    type(input, '中文');
    input.dispatchEvent(new window.CompositionEvent('compositionstart', { bubbles: true }));
    input.dispatchEvent(new window.KeyboardEvent('keydown',
      { key: 'Enter', ctrlKey: true, isComposing: true, bubbles: true, cancelable: true }));
    assert.equal(editor.querySelectorAll('.ex-tag-chip').length, 0);
    assert.equal((await f.repo.list(f.workspace))[0].tags.length, 0);
    input.dispatchEvent(new window.CompositionEvent('compositionend', { bubbles: true }));
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal(editor.querySelectorAll('.ex-tag-chip').length, 1);
    assert.equal((await f.repo.list(f.workspace))[0].tags.length, 0);
  } finally { await f.close(); }
});

test('opening another card does not silently discard a dirty editor', async () => {
  const f = await fixture();
  try {
    const a = await f.repo.create(f.workspace, '第一条');
    const b = await f.repo.create(f.workspace, '第二条');
    await f.renderer.reload();
    const cards = [...f.container.querySelectorAll('.ex-card')];
    const active = cards.find(x => x.dataset.entryId === b.id);
    click(active, '编辑');
    type(f.container.querySelector('.ex-entry-editor textarea'), '第二条未保存');
    const other = [...f.container.querySelectorAll('.ex-card')].find(x => x.dataset.entryId === a.id);
    click(other, '编辑');
    assert.equal(f.container.querySelector('.ex-entry-editor textarea').value, '第二条未保存');
    assert.match(Notice.last, /先保存或取消/);
  } finally { await f.close(); }
});
