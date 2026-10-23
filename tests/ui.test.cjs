const {test}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const {JSDOM}=require('jsdom');
const dom=new JSDOM('<!doctype html><html><body></body></html>');
global.window=dom.window;global.document=dom.window.document;
global.HTMLElement=dom.window.HTMLElement;
HTMLElement.prototype.empty=function(){this.replaceChildren();};
HTMLElement.prototype.addClass=function(name){this.classList.add(name);};
HTMLElement.prototype.createDiv=function(){const el=document.createElement('div');this.append(el);return el;};
class TAbstractFile {constructor(path){this.path=path;}}
class TFile extends TAbstractFile {constructor(path){super(path);const leaf=path.split('/').pop();this.basename=leaf.replace(/\.[^.]+$/,'');this.extension=leaf.split('.').pop();this.stat={mtime:200,ctime:100,size:128};this.parent={path:path.split('/').slice(0,-1).join('/') || '/'};}}
class TFolder extends TAbstractFile{}
class MarkdownRenderChild {constructor(el){this.containerEl=el;this.children=[];}addChild(c){this.children.push(c);}removeChild(c){this.children=this.children.filter(x=>x!==c);}load(){this.onload?.();}unload(){this.onunload?.();}}
class FileView {constructor(){this.contentEl=document.createElement('div');this.file=null;}async openFile(f){this.file=f;await this.onLoadFile?.(f);}}
class Plugin {async loadData(){return null;}async saveData(){}registerView(kind,factory){this.factory=factory;}registerExtensions(exts,type){this.extensions={exts,type};}addSettingTab(){}addCommand(){}registerEvent(){}addRibbonIcon(icon,title,action){this.ribbon={icon,title,action};}}
class PluginSettingTab {constructor(){}}
class Setting {}
class Notice {constructor(message){Notice.last=message;}}
class Modal {constructor(){this.contentEl=document.createElement('div');Modal.last=this;}open(){this.isOpen=true;}close(){this.isOpen=false;}}
class Menu {constructor(){this.items=[];}addItem(fn){const item={setTitle(title){this.title=title;return this;},onClick(handler){this.handler=handler;return this;}};fn(item);this.items.push(item);}showAtPosition(){Menu.last=this;}}
const renders=[];
const mocks={TAbstractFile,TFile,TFolder,MarkdownRenderChild,FileView,Plugin,PluginSettingTab,Setting,Notice,Menu,Modal,
  setIcon(el,name){el.setAttribute('data-icon',name);},
  getAllTags(cache){return [...(cache.tags||[]).map(t=>t.tag),...(cache.frontmatter?.tags||[]).map(t=>'#'+t)];},
  MarkdownRenderer:{async render(app,content,target,path){renders.push({content,path});target.append(document.createTextNode(content));}}
};
const old=Module._load;Module._load=function(request,parent,isMain){if(request==='obsidian')return mocks;return old.apply(this,arguments);};
const Excerpts=require('../main.js');Module._load=old;
const wait=()=>new Promise(resolve=>setTimeout(resolve,70));
function clickByLabel(container,label){const el=container.querySelector(`button[aria-label="${label}"]`);assert.ok(el,'Missing button: '+label);el.click();return el;}

async function fixture(){
  const files=new Map();
  const dir=new TFolder('摘录'); files.set('摘录',{file:dir});
  const home=new TFile('摘录/首页.excerpts'); files.set(home.path,{file:home,data:''});
  const md=new TFile('摘录/测试.md'); files.set(md.path,{file:md,data:'# 测试标题\n\n![[图片.png]]\n\n## 来源\n\n《某书》\n\n## 批注\n\n摘录笔记'});
  const vault={getAbstractFileByPath(path){return files.get(path)?.file??null;},getFiles(){return [...files.values()].filter(x=>x.file instanceof TFile).map(x=>x.file);},getMarkdownFiles(){return this.getFiles().filter(x=>x.extension==='md');},
    async cachedRead(file){return files.get(file.path).data;},
    async read(file){return files.get(file.path).data;},
    async process(file, transform){const x=files.get(file.path); const next=transform(x.data); x.data=next; file.stat.mtime+=1; file.stat.size=next.length;},
    async createFolder(path){files.set(path,{file:new TFolder(path)});},async create(path,content){const f=new TFile(path);files.set(path,{file:f,data:content});return f;},on(){return {};}};
  const plugin=new Excerpts();
  const leaf={lastFile:null,async openFile(file){this.lastFile=file;},async setViewState(){}};
  plugin.app={vault,metadataCache:{getFileCache(){return {tags:[],frontmatter:{tags:['哲学']}};},on(){return {};}}
    ,fileManager:{async processFrontMatter(f,fn){fn({tags:['哲学']});}},workspace:{getLeaf(){return leaf;},async revealLeaf(){}}};
  await plugin.onload();
  const pane=plugin.factory({});document.body.append(pane.contentEl);
  await pane.openFile(home);await wait();
  return {files,plugin,pane,leaf,md,home,async close(){await pane.onUnloadFile(home);pane.contentEl.remove();}};
}

test('opening a .excerpts file displays beta.6-style direct feed without a selector page',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  assert.equal(t.plugin.extensions.type,'excerpts-home-file');
  assert.equal(t.pane.getDisplayText(),'首页');
  assert.ok(root.querySelector('.ex-composer .ex-compose-text'));
  assert.ok(root.querySelector('.ex-list-heading').textContent.includes('最近收藏'));
  assert.equal(root.querySelector('.ex-search-wrap').hidden,true);
  assert.equal(root.querySelector('.ex-filter-tags').hidden,true);
  assert.equal(root.querySelectorAll('.ex-card').length,1);
  assert.ok(root.querySelector('.ex-note-heading').textContent.includes('测试标题'));
  assert.ok(renders.some(r=>r.content.includes('![[图片.png]]') && r.path===t.md.path));
  assert.ok(!root.textContent.includes('我的摘录'));
  assert.ok(!root.querySelector('.ex-home-list'));
  clickByLabel(root,'搜索');assert.equal(root.querySelector('.ex-search-wrap').hidden,false);
  clickByLabel(root,'搜索');assert.equal(root.querySelector('.ex-search-wrap').hidden,true);
  await t.close();
});
test('quick composer saves normal Markdown with native tags and restores continuous writing',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  const textarea=root.querySelector('.ex-compose-text');textarea.value='直接写入普通 Markdown';
  clickByLabel(root,'添加标签');assert.equal(root.querySelector('.ex-capture-tags').hidden,false);
  clickByLabel(root,'添加已有标签：哲学');
  const tagInput=root.querySelector('.ex-tags-input');
  tagInput.value='札记';
  tagInput.dispatchEvent(new window.Event('input',{bubbles:true}));
  tagInput.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  [...root.querySelectorAll('.ex-compose-actions button')].find(x=>x.textContent==='保存').click();
  await wait();
  const entries=[...t.files].filter(([path])=>path.includes('摘录-')&&path.endsWith('.md'));
  assert.equal(entries.length,1);
  assert.match(entries[0][1].data,/直接写入普通 Markdown/);
  assert.match(entries[0][1].data,/  - "哲学"/);
  assert.equal(textarea.value,'');
  await t.close();
});
test('source groups, tag filter, random recall and edit use native components',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  const source=[...root.querySelectorAll('.ex-group-trigger')].find(x=>x.textContent==='来源');
  assert.ok(source);source.click();await wait();
  assert.ok(renders.some(r=>r.content==='《某书》'));
  assert.equal(root.querySelectorAll('.ex-group-body').length,1);
  assert.ok(root.querySelector('.ex-chips button.ex-tag').textContent.includes('#哲学'));
  clickByLabel(root,'随机回顾');await wait();
  assert.ok(root.querySelector('.ex-recalled'));
  clickByLabel(root,'编辑摘录');await wait();
  assert.ok(root.querySelector('.ex-entry-editor .ex-editor-text'));
  assert.equal(t.leaf.lastFile,null,'Inline edit must not open another Obsidian tab');
  assert.equal(root.querySelector('.ex-card').classList.contains('ex-is-editing'),true);
  clickByLabel(root,'列表选项');
  const toggle=Menu.last.items.find(i=>i.title==='标签筛选');assert.ok(toggle);toggle.handler();
  assert.equal(root.querySelector('.ex-filter-tags').hidden,false);
  await t.close();
});

test('inline Markdown and YAML tags save together without a second editor pane',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  try{
    clickByLabel(root,'编辑摘录'); await wait();
    const editor=root.querySelector('.ex-entry-editor');
    assert.ok(editor);
    const body=editor.querySelector('.ex-editor-text');
    body.value='# 测试标题\n\n重写 Markdown\n\n## 来源\n\n《某书》\n\n## 来源\n\n第二次来源';
    body.dispatchEvent(new window.Event('input',{bubbles:true}));
    assert.equal(editor.querySelector('.ex-tag-picker').hidden,true);
    [...editor.querySelectorAll('button')].find(b=>b.textContent.includes('添加标签')).click();
    assert.equal(editor.querySelector('.ex-tag-picker').hidden,false);
    clickByLabel(editor,'移除标签：哲学');
    clickByLabel(editor,'添加已有标签：哲学');
    const input=editor.querySelector('.ex-tags-input');
    input.value='随想';input.dispatchEvent(new window.Event('input',{bubbles:true}));
    input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    assert.ok(editor.querySelector('.ex-tag-pills').textContent.includes('#随想'));
    assert.equal(editor.querySelector('.ex-tag-picker').hidden,false);
    [...editor.querySelectorAll('button')].find(b=>b.textContent==='完成').click();
    assert.equal(editor.querySelector('.ex-tag-picker').hidden,true);
    assert.match(editor.querySelector('.ex-editor-status').textContent,/未保存/);
    assert.equal(t.files.get(t.md.path).data.includes('重写 Markdown'),false);
    [...editor.querySelectorAll('button')].find(b=>b.textContent==='保存修改').click();
    await wait();
    assert.equal(root.querySelector('.ex-entry-editor'),null);
    const raw=t.files.get(t.md.path).data;
    assert.match(raw,/重写 Markdown/);
    assert.match(raw,/## 来源[\s\S]*## 来源/);
    assert.match(raw,/  - "随想"/);
  } finally {await t.close();}
});

test('dirty edit requires explicit discard confirmation',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  try{
    const original=t.files.get(t.md.path).data;
    clickByLabel(root,'编辑摘录');await wait();
    const edit=root.querySelector('.ex-entry-editor');
    const textarea=edit.querySelector('textarea');
    textarea.value+='\n变更';textarea.dispatchEvent(new window.Event('input',{bubbles:true}));
    [...edit.querySelectorAll('button')].find(x=>x.textContent==='取消').click();
    assert.equal(Modal.last.isOpen,true);
    assert.ok(root.querySelector('.ex-entry-editor'));
    [...Modal.last.contentEl.querySelectorAll('button')].find(x=>x.textContent==='继续编辑').click();
    assert.ok(root.querySelector('.ex-entry-editor'));
    [...edit.querySelectorAll('button')].find(x=>x.textContent==='取消').click();
    [...Modal.last.contentEl.querySelectorAll('button')].find(x=>x.textContent==='放弃更改').click();
    await wait();
    assert.equal(root.querySelector('.ex-entry-editor'),null);
    assert.equal(t.files.get(t.md.path).data,original);
  } finally {await t.close();}
});

test('concurrent Markdown modification is never overwritten by an inline save',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  try{
    clickByLabel(root,'编辑摘录'); await wait();
    const editor=root.querySelector('.ex-entry-editor');
    const textarea=editor.querySelector('textarea');
    textarea.value='本地未保存';textarea.dispatchEvent(new window.Event('input',{bubbles:true}));
    t.files.get(t.md.path).data+='\n外部修改';
    [...editor.querySelectorAll('button')].find(x=>x.textContent==='保存修改').click();
    await wait();
    assert.ok(root.querySelector('.ex-entry-editor'));
    assert.match(t.files.get(t.md.path).data,/外部修改/);
    assert.doesNotMatch(t.files.get(t.md.path).data,/本地未保存/);
    assert.match(Notice.last,/未覆盖原文件/);
  } finally {await t.close();}
});

test('H2 groups retain independent occurrence state and default to collapsed',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  try{
    t.files.get(t.md.path).data='## 来源\n\n第一条\n\n## 来源\n\n第二条';
    t.plugin.repo.invalidate(t.md.path);
    await t.pane.renderer.reload();await wait();
    const sections=[...root.querySelectorAll('.ex-group-trigger')];
    assert.equal(sections.length,2);
    assert.equal(root.querySelector('.ex-group-body'),null);
    sections[0].click();await wait();
    assert.equal(root.querySelectorAll('.ex-group-body').length,1);
    root.querySelectorAll('.ex-group-trigger')[1].click();await wait();
    assert.equal(root.querySelectorAll('.ex-group-body').length,2);
    assert.equal(root.querySelector('.ex-empty-card'),null);
  }finally{await t.close();}
});
