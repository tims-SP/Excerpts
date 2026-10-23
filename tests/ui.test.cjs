const {test}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const {JSDOM}=require('jsdom');
const dom=new JSDOM('<!doctype html><html><body></body></html>');
global.window=dom.window;global.document=dom.window.document;
global.HTMLElement=dom.window.HTMLElement;
HTMLElement.prototype.empty=function(){this.replaceChildren();};
HTMLElement.prototype.addClass=function(name){this.classList.add(name);};
HTMLElement.prototype.createDiv=function(){const d=document.createElement('div');this.append(d);return d;};
HTMLElement.prototype.createEl=function(tag,options){const d=document.createElement(tag);d.textContent=options?.text||'';this.append(d);return d;};
class TAbstractFile {constructor(path){this.path=path;}}
class TFile extends TAbstractFile {constructor(path){super(path);this.basename=path.split('/').pop().replace(/\.md$/,'');this.stat={mtime:200,ctime:100,size:123};}}
class TFolder extends TAbstractFile{}
class MarkdownRenderChild {
  constructor(el){this.containerEl=el;this.children=[];}
  addChild(child){this.children.push(child);}
  removeChild(child){this.children=this.children.filter(x=>x!==child);}
  load(){this.onload?.();}
  unload(){this.onunload?.();}
}
class ItemView {constructor(){this.contentEl=document.createElement('div');} async setState(){}}
class Plugin {
  async loadData(){return null;} async saveData(){}
  registerView(kind,factory){this.viewFactory=factory;} addSettingTab(){} addCommand(){} registerEvent(){}
}
class PluginSettingTab {constructor(){}}
class Setting {}
class Notice {constructor(text){Notice.last=text;}}
const renders=[];
const mocks={
 TAbstractFile,TFile,TFolder,MarkdownRenderChild,ItemView,Plugin,PluginSettingTab,Setting,Notice,
 getAllTags(cache){return [...(cache.tags||[]).map(t=>t.tag),...(cache.frontmatter?.tags||[]).map(t=>'#'+t)];},
 setIcon(el,name){el.setAttribute('data-icon',name);},
 MarkdownRenderer:{async render(app,text,container,path){
   renders.push({text,path});container.append(document.createTextNode(text));
 }}
};
const previous=Module._load;
Module._load=function(request,parent,isMain){if(request==='obsidian')return mocks;return previous.apply(this,arguments);};
const Excerpts=require('../main.js');
Module._load=previous;
const wait=()=>new Promise(resolve=>setTimeout(resolve,50));

test('native Markdown cards show arbitrary H2 sections and independent tags',async()=>{
  const files=new Map();
  const file=new TFile('摘录/测试.md');
  files.set('摘录',{file:new TFolder('摘录')});
  files.set(file.path,{file,data:'# 测试标题\n\n![[图片.png]]\n\n## 来源\n\n《某书》\n\n## 批注\n\n摘录笔记'});
  const vault={
    getAbstractFileByPath(p){return files.get(p)?.file||null;},
    getMarkdownFiles(){return [file];},
    async cachedRead(f){return files.get(f.path).data;},
    async createFolder(p){files.set(p,{file:new TFolder(p)});},
    async create(p,body){const f=new TFile(p);files.set(p,{file:f,data:body});return f;},
    on(){return {};}
  };
  const plugin=new Excerpts();
  plugin.app={
    vault,
    metadataCache:{getFileCache(){return {tags:[],frontmatter:{tags:['哲学']}};},on(){return {};}},
    fileManager:{async processFrontMatter(f,fn){const fm={tags:['哲学']};fn(fm);}},
    workspace:{getLeaf(){return {async openFile(){},async setViewState(){}};},async revealLeaf(){}}
  };
  await plugin.onload();
  const workspace=await plugin.createWorkspace('测试收藏集','摘录');
  const pane=plugin.viewFactory({});
  document.body.append(pane.contentEl);
  await pane.setState({workspaceId:workspace.id},{});
  await wait();
  assert.equal(pane.contentEl.querySelector('.ex-card-title').textContent,'测试标题');
  assert.ok(renders.some(r=>r.text.includes('![[图片.png]]')&&r.path==='摘录/测试.md'));
  assert.equal(pane.contentEl.querySelectorAll('.ex-group').length,0);
  const select=[...pane.contentEl.querySelectorAll('button')].find(b=>b.textContent.includes('选择章节'));
  assert.ok(select);select.click();
  const source=[...pane.contentEl.querySelectorAll('.ex-section-option')].find(b=>b.textContent.includes('来源'));
  source.click();await wait();
  assert.ok(renders.some(r=>r.text==='《某书》'));
  assert.equal(pane.contentEl.querySelectorAll('.ex-group').length,1);
  assert.ok([...pane.contentEl.querySelectorAll('.ex-tag')].some(b=>b.textContent.includes('#哲学')));
  assert.ok(pane.contentEl.querySelector('.ex-edit-file'));
  await pane.onClose();pane.contentEl.remove();
});
