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

async function fixture(options={}){
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
  let lastSaved=null;
  plugin.loadData=async()=>options.data||null;
  plugin.saveData=async data=>{lastSaved=JSON.parse(JSON.stringify(data));};
  const leaf={lastFile:null,async openFile(file){this.lastFile=file;},async setViewState(){}};
  plugin.app={vault,metadataCache:{getFileCache(){return {tags:[],frontmatter:{tags:['哲学']}};},on(){return {};}}
    ,fileManager:{async processFrontMatter(f,fn){fn({tags:['哲学']});}},workspace:{getLeaf(){return leaf;},async revealLeaf(){}}};
  await plugin.onload();
  const pane=plugin.factory({});document.body.append(pane.contentEl);
  await pane.openFile(home);await wait();
  return {files,plugin,pane,leaf,md,home,getSaved:()=>lastSaved,async close(){await pane.onUnloadFile(home);pane.contentEl.remove();}};
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

test('list refresh keeps unsaved inline content, tag selection and text caret',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  try {
    clickByLabel(root,'编辑摘录');await wait();
    const editor=root.querySelector('.ex-entry-editor');
    const textarea=editor.querySelector('.ex-editor-text');
    textarea.value+='\n正在编辑';textarea.focus();textarea.setSelectionRange(4,8);
    textarea.dispatchEvent(new window.Event('input',{bubbles:true}));
    await t.pane.renderer.reload();await wait();
    const restored=root.querySelector('.ex-editor-text');
    assert.equal(restored.value.endsWith('正在编辑'),true);
    assert.equal(document.activeElement,restored);
    assert.equal(restored.selectionStart,4);
    assert.equal(restored.selectionEnd,8);
    assert.equal(t.files.get(t.md.path).data.includes('正在编辑'),false);
  } finally {await t.close();}
});

test('switching between clean editors leaves only the second card editable',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  try {
    const second=await t.plugin.repo.create(t.plugin.workspaceForHome(t.home),'另一个摘录',[]);
    await t.pane.renderer.reload();await wait();
    const cards=[...root.querySelectorAll('.ex-card')];
    cards.find(c=>c.dataset.path===t.md.path).querySelector('button[aria-label="编辑摘录"]').click();
    await wait();
    assert.equal(root.querySelectorAll('.ex-entry-editor').length,1);
    cards.find(c=>c.dataset.path===second.path).querySelector('button[aria-label="编辑摘录"]').click();
    await wait();
    assert.equal(root.querySelectorAll('.ex-entry-editor').length,1);
    assert.equal(root.querySelector('.ex-card.ex-is-editing').dataset.path,second.path);
  } finally {await t.close();}
});

test('editing only YAML tags preserves other frontmatter properties and body',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  try {
    const original='---\nfavorite: true\n\ntags:\n  - "哲学"\nother: keep\n---\n\n原样正文\n\n## 来源\n\n《某书》';
    t.files.get(t.md.path).data=original;t.plugin.repo.invalidate(t.md.path);
    await t.pane.renderer.reload();await wait();
    clickByLabel(root,'编辑摘录');await wait();
    const edit=root.querySelector('.ex-entry-editor');
    clickByLabel(edit,'移除标签：哲学');
    [...edit.querySelectorAll('button')].find(b=>b.textContent.includes('添加标签')).click();
    const input=edit.querySelector('.ex-tags-input');
    input.value='散文';input.dispatchEvent(new window.Event('input',{bubbles:true}));
    input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    [...edit.querySelectorAll('button')].find(b=>b.textContent==='保存修改').click();
    await wait();
    const raw=t.files.get(t.md.path).data;
    assert.match(raw,/favorite: true/);
    assert.match(raw,/other: keep/);
    assert.match(raw,/  - "散文"/);
    assert.doesNotMatch(raw,/  - "哲学"/);
    assert.match(raw,/原样正文\n\n## 来源\n\n《某书》/);
  } finally {await t.close();}
});

test('saved property tag changes appear in the card before metadata cache reindexes',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  try{
    clickByLabel(root,'编辑摘录');await wait();
    const editor=root.querySelector('.ex-entry-editor');
    clickByLabel(editor,'移除标签：哲学');
    [...editor.querySelectorAll('button')].find(b=>b.textContent.includes('添加标签')).click();
    const input=editor.querySelector('.ex-tags-input');
    input.value='立即显示';input.dispatchEvent(new window.Event('input',{bubbles:true}));
    input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    [...editor.querySelectorAll('button')].find(b=>b.textContent==='保存修改').click();
    await wait();
    assert.ok(root.querySelector('.ex-chips').textContent.includes('#立即显示'));
    assert.ok(!root.querySelector('.ex-chips').textContent.includes('#哲学'));
  }finally{await t.close();}
});

test('v4 quick capture remains collapsed until focus and persists an unsaved draft',async()=>{
  const t=await fixture(),root=t.pane.contentEl;
  try{
    const composer=root.querySelector('.ex-composer');
    const text=root.querySelector('.ex-compose-text');
    assert.equal(composer.classList.contains('ex-is-composing'),false);
    assert.equal(root.querySelector('.ex-compose-actions button.mod-cta').disabled,true);
    text.value='没写完的句子';text.dispatchEvent(new window.Event('input',{bubbles:true}));
    assert.equal(root.querySelector('.ex-compose-actions button.mod-cta').disabled,false);
    await new Promise(resolve=>setTimeout(resolve,450));
    const saved=t.getSaved();
    assert.equal(saved.drafts['摘录/首页.excerpts:capture'].body,'没写完的句子');
    await t.close();
    const restored=await fixture({data:saved});
    try{
      assert.equal(restored.pane.contentEl.querySelector('.ex-compose-text').value,'没写完的句子');
      assert.equal(restored.pane.contentEl.querySelector('.ex-composer').classList.contains('ex-is-composing'),true);
    }finally{await restored.close();}
  }finally{if(t.pane.contentEl.isConnected)await t.close();}
});

test('v4 persists a dirty inline editor and restores it on reopen',async()=>{
  const t=await fixture(),root=t.pane.contentEl;
  try{
    clickByLabel(root,'编辑摘录');await wait();
    const area=root.querySelector('.ex-editor-text');
    area.value='未保存正文\n\n## 来源\n\n书';
    area.dispatchEvent(new window.Event('input',{bubbles:true}));
    await new Promise(resolve=>setTimeout(resolve,450));
    const saved=t.getSaved();
    assert.equal(saved.drafts['摘录/首页.excerpts:edit'].body,area.value);
    await t.close();
    const restored=await fixture({data:saved});
    try{
      const text=restored.pane.contentEl.querySelector('.ex-editor-text');
      assert.ok(text,'dirty edit should auto-restore');
      assert.equal(text.value,'未保存正文\n\n## 来源\n\n书');
    }finally{await restored.close();}
  }finally{if(t.pane.contentEl.isConnected)await t.close();}
});

test('v4 searching an unrelated note keeps the dirty editor mounted and focused',async()=>{
  const t=await fixture(),root=t.pane.contentEl;
  try{
    clickByLabel(root,'编辑摘录');await wait();
    const area=root.querySelector('.ex-editor-text');
    area.value='保留我的未保存内容';
    area.dispatchEvent(new window.Event('input',{bubbles:true}));
    area.focus();
    clickByLabel(root,'搜索');
    const search=root.querySelector('.ex-search');
    search.value='完全没有匹配的搜索短语';
    search.dispatchEvent(new window.Event('input',{bubbles:true}));
    await new Promise(resolve=>setTimeout(resolve,550));
    const actual=root.querySelector('.ex-editor-text');
    assert.equal(actual,area,'must not rebuild active textarea');
    assert.equal(actual.value,'保留我的未保存内容');
    assert.ok(actual.isConnected);
    assert.equal(root.querySelectorAll('.ex-card.ex-is-editing').length,1);
  }finally{await t.close();}
});

test('v4 H2 toggle changes only the section region, not the main Markdown mount',async()=>{
  const t=await fixture(),root=t.pane.contentEl;
  try{
    const quote=root.querySelector('.ex-quote .ex-native-markdown');
    assert.ok(quote);
    const before=renders.filter(entry=>entry.path===t.md.path&&entry.content.includes('![[图片.png]]')).length;
    const trigger=root.querySelector('.ex-group-trigger');
    trigger.click();await wait();
    assert.equal(root.querySelector('.ex-quote .ex-native-markdown'),quote);
    assert.equal(root.querySelector('.ex-group-title'),null,'expanded H2 must not duplicate its heading');
    assert.equal(renders.filter(entry=>entry.path===t.md.path&&entry.content.includes('![[图片.png]]')).length,before);
  }finally{await t.close();}
});

test('v4 invalid custom tag is rejected visibly without adding a chip',async()=>{
  const t=await fixture(),root=t.pane.contentEl;
  try{
    clickByLabel(root,'编辑摘录');await wait();
    const editor=root.querySelector('.ex-entry-editor');
    [...editor.querySelectorAll('button')].find(b=>b.textContent.includes('添加标签')).click();
    const input=editor.querySelector('.ex-tags-input');
    input.value='不 合法';
    input.dispatchEvent(new window.Event('input',{bubbles:true}));
    assert.match(editor.querySelector('.ex-tag-feedback').textContent,/空格/);
    input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    assert.doesNotMatch(editor.querySelector('.ex-tag-pills').textContent,/不 合法/);
  }finally{await t.close();}
});
