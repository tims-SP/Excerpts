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
class Menu {constructor(){this.items=[];}addItem(fn){const item={setTitle(title){this.title=title;return this;},onClick(handler){this.handler=handler;return this;}};fn(item);this.items.push(item);}showAtPosition(){Menu.last=this;}}
const renders=[];
const mocks={TAbstractFile,TFile,TFolder,MarkdownRenderChild,FileView,Plugin,PluginSettingTab,Setting,Notice,Menu,
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
    async process(file,update){const entry=files.get(file.path);entry.data=update(entry.data);file.stat.mtime++;file.stat.size=entry.data.length;return entry.data;},async createFolder(path){files.set(path,{file:new TFolder(path)});},async create(path,content){const f=new TFile(path);files.set(path,{file:f,data:content});return f;},on(){return {};}};
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
  assert.deepEqual(Object.keys(t.plugin.settings).sort(),['defaultHome','recursive']);
  assert.equal(t.pane.getDisplayText(),'首页');
  assert.ok(root.querySelector('.ex-composer .ex-compose-text'));
  assert.ok(root.querySelector('.ex-list-heading').textContent.includes('最近摘录'));
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
  root.querySelector('.ex-tags-input').value='哲学, 札记';
  [...root.querySelectorAll('.ex-compose-actions button')].find(x=>x.textContent==='保存').click();
  await wait();
  const entries=[...t.files].filter(([path])=>path.includes('摘录-')&&path.endsWith('.md'));
  assert.equal(entries.length,1);
  assert.match(entries[0][1].data,/直接写入普通 Markdown/);
  assert.match(entries[0][1].data,/  - "哲学"/);
  assert.equal(textarea.value,'');
  await t.close();
});
test('H2 groups, filtering and editing without redundant card actions',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  const source=[...root.querySelectorAll('.ex-group-trigger')].find(x=>x.textContent==='来源');
  assert.ok(source);source.click();await wait();
  assert.ok(renders.some(r=>r.content==='《某书》'));
  assert.equal(root.querySelectorAll('.ex-group-body').length,1);
  assert.ok(root.querySelector('.ex-chips button.ex-tag').textContent.includes('#哲学'));
  for(const label of ['随机回顾','珍藏','取消珍藏','添加内容','更多摘录操作'])
    assert.equal(root.querySelector('button[aria-label="'+label+'"]'),null,label);
  assert.equal(root.querySelectorAll('.ex-card-actions button').length,1);
  clickByLabel(root,'编辑摘录');await wait();
  const editor=root.querySelector('.ex-editor-text');
  assert.ok(editor);
  assert.match(editor.value,/## 来源/);
  assert.equal(t.leaf.lastFile,null);
  editor.value += '\n新内容';
  editor.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  [...root.querySelectorAll('.ex-edit-actions button')].find(x=>x.textContent==='保存').click();
  await wait();
  assert.match(t.files.get(t.md.path).data,/新内容/);
  const filter=clickByLabel(root,'筛选标签');
  assert.equal(filter.getAttribute('aria-expanded'),'true');
  assert.equal(root.querySelector('.ex-filter-tags').hidden,false);
  clickByLabel(root,'筛选标签');
  assert.equal(root.querySelector('.ex-filter-tags').hidden,true);
  await t.close();
});

test('inline edit cancellation preserves original and conflict keeps draft',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  clickByLabel(root,'编辑摘录');await wait();
  let editor=root.querySelector('.ex-editor-text');
  editor.value='discard';editor.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  [...root.querySelectorAll('.ex-edit-actions button')].find(x=>x.textContent==='取消').click();
  await wait();
  assert.doesNotMatch(t.files.get(t.md.path).data,/discard/);
  clickByLabel(root,'编辑摘录');await wait();
  editor=root.querySelector('.ex-editor-text');editor.value='overwrite';
  editor.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  t.files.get(t.md.path).data='externally edited';
  [...root.querySelectorAll('.ex-edit-actions button')].find(x=>x.textContent==='保存').click();
  await wait();
  assert.equal(t.files.get(t.md.path).data,'externally edited');
  assert.equal(root.querySelector('.ex-editor-text').value,'overwrite');
  await t.close();
});
test('tag changes preserve expanded selection panel',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  root.querySelector('.ex-add-tag').click();
  const input=root.querySelector('.ex-tag-custom');
  input.value='札记';input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  await wait();
  assert.equal(root.querySelector('.ex-tag-editor').hidden,false);
  assert.equal(root.querySelector('.ex-add-tag').getAttribute('aria-expanded'),'true');
  await t.close();
});
