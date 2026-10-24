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
class MarkdownView {constructor(){this.mode='preview';this.editor={cursor:null,scrolled:null,focused:false,setCursor(pos){this.cursor=pos;},scrollIntoView(range,center){this.scrolled={range,center};},focus(){this.focused=true;}};}getMode(){return this.mode;}}
class Plugin {async loadData(){return null;}async saveData(){}registerView(kind,factory){this.factory=factory;}registerExtensions(exts,type){this.extensions={exts,type};}addSettingTab(){}addCommand(){}registerEvent(){}addRibbonIcon(icon,title,action){this.ribbon={icon,title,action};}}
class PluginSettingTab {constructor(){}}
class Setting {}
class Notice {constructor(message){Notice.last=message;}}
class Menu {constructor(){this.items=[];}addItem(fn){const item={setTitle(title){this.title=title;return this;},onClick(handler){this.handler=handler;return this;}};fn(item);this.items.push(item);}showAtPosition(){Menu.last=this;}}
const renders=[];
const mocks={TAbstractFile,TFile,TFolder,MarkdownRenderChild,FileView,MarkdownView,Plugin,PluginSettingTab,Setting,Notice,Menu,
  setIcon(el,name){el.setAttribute('data-icon',name);},
  getAllTags(cache){return [...(cache.tags||[]).map(t=>t.tag),...(cache.frontmatter?.tags||[]).map(t=>'#'+t)];},
  MarkdownRenderer:{async render(app,content,target,path){renders.push({content,path});target.append(document.createTextNode(content));}}
};
const old=Module._load;Module._load=function(request,parent,isMain){if(request==='obsidian')return mocks;return old.apply(this,arguments);};
const Excerpts=require('../main.js');Module._load=old;
const wait=()=>new Promise(resolve=>setTimeout(resolve,70));
function clickByLabel(container,label){const el=container.querySelector(`button[aria-label="${label}"]`);assert.ok(el,'Missing button: '+label);el.click();return el;}

async function fixture(noTags=false,markdown='# 测试标题\n\n![[图片.png]]\n\n## 来源\n\n《某书》\n\n## 批注\n\n摘录笔记',inlineTags=[]){
  const files=new Map();
  const dir=new TFolder('摘录'); files.set('摘录',{file:dir});
  const home=new TFile('摘录/首页.excerpts'); files.set(home.path,{file:home,data:''});
  const md=new TFile('摘录/测试.md'); files.set(md.path,{file:md,data:markdown});
  const tagState=new Map([[md.path,noTags?[]:['哲学']]]);
  let tagWrites=0;
  const vault={getAbstractFileByPath(path){return files.get(path)?.file??null;},getFiles(){return [...files.values()].filter(x=>x.file instanceof TFile).map(x=>x.file);},getAllLoadedFiles(){return [...files.values()].map(x=>x.file);},getMarkdownFiles(){return this.getFiles().filter(x=>x.extension==='md');},
    async cachedRead(file){return files.get(file.path).data;},
    async process(file,update){const entry=files.get(file.path);entry.data=update(entry.data);file.stat.mtime++;file.stat.size=entry.data.length;return entry.data;},async createFolder(path){files.set(path,{file:new TFolder(path)});},async create(path,content){if(files.has(path))throw Error('exists');const f=new TFile(path);files.set(path,{file:f,data:content});return f;},on(){return {};}};
  const plugin=new Excerpts();
  const leaf={lastFile:null,view:null,async openFile(file){this.lastFile=file;this.view=new MarkdownView();},async setViewState(state){this.state=state;if(this.view)this.view.mode=state.state.mode;}};
  plugin.app={vault,metadataCache:{getFileCache(f){return {
    tags:f.path===md.path?inlineTags.map(tag=>({tag:'#'+tag})):[],
    frontmatter:{tags:tagState.get(f.path)||[]}
  };},on(){return {};}}
    ,fileManager:{async processFrontMatter(f,fn){
      const fm={tags:[...(tagState.get(f.path)||[])]};
      fn(fm);
      tagState.set(f.path,fm.tags||[]);
      tagWrites++;
    }},workspace:{getLeaf(){return leaf;},async revealLeaf(){}}};
  await plugin.onload();
  const pane=plugin.factory({});document.body.append(pane.contentEl);
  await pane.openFile(home);await wait();
  return {files,plugin,pane,leaf,md,home,tagState,getTagWrites:()=>tagWrites,async close(){await pane.onUnloadFile(home);pane.contentEl.remove();}};
}

test('opening .excerpts displays an editorial date-group feed and always-visible composer',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  assert.equal(t.plugin.extensions.type,'excerpts-home-file');
  assert.deepEqual(Object.keys(t.plugin.settings).sort(),['defaultHome','recursive']);
  assert.equal(t.pane.getDisplayText(),'首页');
  assert.ok(root.querySelector('.ex-composer .ex-compose-text'));
  assert.ok(root.querySelector('.ex-list-heading').textContent.includes('最近摘录'));
  assert.equal(root.querySelector('.ex-search-wrap').hidden,true);
  assert.equal(root.querySelector('.ex-filter-tags').hidden,true);
  assert.equal(root.querySelectorAll('.ex-card').length,1);
  assert.equal(root.querySelector('.ex-card').classList.contains('ex-card-loading'),false);
  assert.equal(root.querySelectorAll('.ex-day-group').length,1);
  assert.ok(root.querySelector('.ex-day-rail .ex-day-title'));
  assert.ok(root.querySelector('.ex-card-footer .ex-chips'));
  assert.equal(root.querySelector('.ex-card').lastElementChild.classList.contains('ex-card-footer'),true);
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
  const textarea=root.querySelector('.ex-compose-text');textarea.value='直接写入普通 Markdown';textarea.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  clickByLabel(root,'添加标签');assert.equal(root.querySelector('.ex-capture-tags').hidden,false);
  const choice=[...root.querySelectorAll('.ex-capture-tags .ex-tag-choice')].find(x=>x.textContent.includes('哲学'));
  assert.ok(choice);choice.click();
  const tagSearch=root.querySelector('.ex-tags-input');
  tagSearch.value='札记';tagSearch.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  const create=[...root.querySelectorAll('.ex-capture-tags .ex-tag-choice')].find(x=>x.textContent.includes('创建 #札记'));
  assert.ok(create);create.click();
  assert.equal(root.querySelectorAll('.ex-capture-selected .ex-tag-remove').length,2);
  [...root.querySelectorAll('.ex-compose-actions button')].find(x=>x.textContent==='保存').click();
  await wait();
  const entries=[...t.files].filter(([path])=>path==='摘录/直接写入普通 Markdown.md');
  assert.equal(entries.length,1);
  assert.match(entries[0][1].data,/直接写入普通 Markdown/);
  assert.match(entries[0][1].data,/  - "哲学"/);
  assert.match(entries[0][1].data,/  - "札记"/);
  assert.equal(textarea.value,'');
  await t.close();
});
test('card options open the native Markdown editor and preserve the homepage',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  const source=[...root.querySelectorAll('.ex-group-trigger')].find(x=>x.textContent==='来源');
  assert.ok(source);source.click();await wait();
  assert.ok(renders.some(r=>r.content==='《某书》'));
  assert.equal(root.querySelectorAll('.ex-group-body').length,2);
  assert.equal(root.querySelectorAll('.ex-group-body:not([hidden])').length,1);
  assert.ok(root.querySelector('.ex-chips button.ex-tag').textContent.includes('#哲学'));
  for(const label of ['随机回顾','珍藏','取消珍藏','添加内容','编辑摘录'])
    assert.equal(root.querySelector('button[aria-label="'+label+'"]'),null,label);
  assert.equal(root.querySelectorAll('.ex-card-options').length,1);
  assert.equal(root.querySelector('.ex-entry-editor'),null);
  clickByLabel(root,'卡片选项');await wait();
  const menu=Menu.last;
  assert.deepEqual(menu.items.map(x=>x.title),['编辑原文','编辑分组：来源','编辑分组：批注']);
  menu.items[0].handler();await wait();
  assert.equal(t.leaf.lastFile,t.md);
  assert.equal(t.leaf.view.mode,'source');
  assert.equal(t.leaf.view.editor.focused,true);
  assert.equal(t.pane.file,t.home);
  assert.equal(root.querySelectorAll('.ex-card').length,1);
  const filter=clickByLabel(root,'筛选标签');
  assert.equal(filter.getAttribute('aria-expanded'),'true');
  clickByLabel(root,'筛选标签');
  assert.equal(root.querySelector('.ex-filter-tags').hidden,true);
  await t.close();
});

test('H2 menu targets the correct source line including repeated section names',async()=>{
  const source='---\ntags: [文学]\n---\n\n# 标题\n\n```md\n## 不是分组\n```\n\n## 来源\n甲\n\n## 来源\n乙';
  const t=await fixture(false,source);const root=t.pane.contentEl;
  clickByLabel(root,'卡片选项');await wait();
  const menu=Menu.last;
  assert.deepEqual(menu.items.map(x=>x.title),
    ['编辑原文','编辑分组：来源（第 1 个）','编辑分组：来源（第 2 个）']);
  menu.items[2].handler();await wait();
  assert.equal(t.leaf.lastFile,t.md);
  assert.equal(t.leaf.view.editor.cursor.line,13);
  assert.equal(t.leaf.view.editor.cursor.ch,0);
  assert.equal(t.leaf.view.editor.scrolled.range.from.line,13);
  assert.equal(t.leaf.view.mode,'source');
  assert.equal(t.files.get(t.md.path).data,source);
  await t.close();
});
test('card tag edit stays open and preserves the SAME input when selecting several options',async()=>{
  const t=await fixture();const card=t.pane.contentEl.querySelector('.ex-card');
  card.querySelector('.ex-add-tag').click();
  const input=card.querySelector('.ex-tag-custom');
  input.value='札记';input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  assert.equal(card.querySelector('.ex-tag-custom'),input);
  assert.equal(card.querySelector('.ex-tag-editor').hidden,false);
  assert.equal(t.getTagWrites(),0,'selection must not write the file');
  assert.equal(card.querySelector('.ex-tag-editor-count').textContent,'已选 2');
  card.querySelector('.ex-tag-cancel').click();
  assert.equal(card.querySelector('.ex-tag-editor').hidden,true);
  assert.deepEqual(t.tagState.get(t.md.path),['哲学']);
  await t.close();
});

test('cards without tags use a single compact footer add action, then expand editor',async()=>{
  const t=await fixture(true);const root=t.pane.contentEl;
  const card=root.querySelector('.ex-card');
  assert.equal(card.querySelectorAll('.ex-chips .ex-tag').length,0);
  const add=card.querySelector('.ex-card-footer .ex-add-tag');
  assert.ok(add);assert.equal(add.getAttribute('aria-label'),'添加标签');
  add.click();
  assert.equal(card.querySelector('.ex-tag-editor').hidden,false);
  assert.equal(card.querySelector('.ex-add-tag').getAttribute('aria-expanded'),'true');
  card.querySelector('.ex-tag-custom').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(card.querySelector('.ex-tag-editor').hidden,true);
  assert.equal(card.querySelector('.ex-card-footer .ex-add-tag').textContent,'＋ 标签');
  await t.close();
});

test('quick tags toggle without comma parsing and persist only the selected chips',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  clickByLabel(root,'添加标签');
  const tag=root.querySelector('.ex-capture-tags .ex-tag-choice');
  assert.ok(tag);tag.click();
  assert.equal(root.querySelectorAll('.ex-capture-selected .ex-tag-remove').length,1);
  clickByLabel(root,'移除标签：哲学');
  assert.equal(root.querySelectorAll('.ex-capture-selected .ex-tag-remove').length,0);
  const input=root.querySelector('.ex-tags-input');
  input.value='灵感';input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  assert.equal(root.querySelectorAll('.ex-capture-selected .ex-tag-remove').length,1);
  root.querySelector('.ex-compose-text').value='一段新摘录';root.querySelector('.ex-compose-text').dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  [...root.querySelectorAll('.ex-compose-actions button')].find(x=>x.textContent==='保存').click();
  await wait();
  const entry=t.files.get('摘录/一段新摘录.md');
  assert.ok(entry);assert.match(entry.data,/  - "灵感"/);
  assert.doesNotMatch(entry.data,/  - "哲学"/);
  await t.close();
});
test('card picker stages removals and saves all YAML tag changes only on Done',async()=>{
  const t=await fixture();const card=t.pane.contentEl.querySelector('.ex-card');
  card.querySelector('.ex-add-tag').click();
  const picker=card.querySelector('.ex-tag-custom');
  const selectedRow=[...card.querySelectorAll('.ex-tag-choice')].find(row=>row.textContent==='哲学');
  assert.ok(selectedRow);selectedRow.click();
  assert.deepEqual(t.tagState.get(t.md.path),['哲学']);
  assert.equal(t.getTagWrites(),0);
  picker.value='札记';picker.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  const create=[...card.querySelectorAll('.ex-tag-choice')].find(row=>row.textContent.includes('创建 #札记'));
  assert.ok(create);create.click();
  assert.equal(card.querySelector('.ex-tag-custom'),picker);
  card.querySelector('.ex-tag-done').click();await wait();
  assert.equal(t.getTagWrites(),1,'only one frontmatter write is expected');
  assert.deepEqual(t.tagState.get(t.md.path),['札记']);
  assert.equal(card.querySelector('.ex-tag-editor').hidden,true);
  assert.ok(card.querySelector('.ex-chips').textContent.includes('#札记'));
  await t.close();
});

test('Escape cancels card tag edits while capture tag panel keeps its draft and toggles shut',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  const card=root.querySelector('.ex-card');
  card.querySelector('.ex-add-tag').click();
  card.querySelector('.ex-tag-custom').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(card.querySelector('.ex-tag-editor').hidden,true);
  assert.equal(t.getTagWrites(),0);
  const top=clickByLabel(root,'添加标签');
  assert.equal(root.querySelector('.ex-capture-tags').hidden,false);
  [...root.querySelectorAll('.ex-capture-tags .ex-tag-choice')].find(row=>row.textContent.includes('哲学')).click();
  top.click();
  assert.equal(root.querySelector('.ex-capture-tags').hidden,true);
  assert.equal(root.querySelectorAll('.ex-capture-selected .ex-tag').length,1);
  top.click();
  root.querySelector('.ex-tags-input').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(root.querySelector('.ex-capture-tags').hidden,true);
  assert.equal(root.querySelectorAll('.ex-capture-selected .ex-tag').length,1);
  await t.close();
});

test('inline Markdown tags remain visible but cannot be removed from frontmatter picker',async()=>{
  const t=await fixture(false,'普通正文 #正文', ['正文']);
  const card=t.pane.contentEl.querySelector('.ex-card');
  card.querySelector('.ex-add-tag').click();
  const protectedRow=[...card.querySelectorAll('.ex-tag-choice')].find(row=>row.textContent.includes('正文'));
  assert.ok(protectedRow);
  assert.equal(protectedRow.disabled,true);
  assert.ok(card.querySelector('.ex-tag-inline-hint').textContent.includes('Markdown'));
  card.querySelector('.ex-tag-cancel').click();
  assert.equal(t.getTagWrites(),0);
  await t.close();
});

test('IME composition does not create a tag on Enter',async()=>{
  const t=await fixture();const card=t.pane.contentEl.querySelector('.ex-card');
  card.querySelector('.ex-add-tag').click();
  const input=card.querySelector('.ex-tag-custom');
  input.value='新标签';
  input.dispatchEvent(new dom.window.CompositionEvent('compositionstart',{bubbles:true}));
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  assert.equal(card.querySelector('.ex-tag-editor-count').textContent,'已选 1');
  input.dispatchEvent(new dom.window.CompositionEvent('compositionend',{bubbles:true}));
  assert.equal(card.querySelector('.ex-tag-editor-count').textContent,'已选 1');
  await t.close();
});

test('date groups keep cards in date order and load-more appends without replacing existing cards',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  for(let i=0;i<84;i++){
    const file=new TFile('摘录/样例-'+String(i).padStart(3,'0')+'.md');
    file.stat.ctime=100-i*86400000;
    t.files.set(file.path,{file,data:'第 '+i+' 段文字'});
  }
  t.pane.renderer.requestRefresh(true);
  await wait();
  assert.equal(root.querySelectorAll('.ex-card').length,40);
  assert.equal(root.querySelectorAll('.ex-day-group').length,39); // fixture's original and first generated excerpt share the same date
  const first=root.querySelector('.ex-card');
  const buttons=[...root.querySelectorAll('.ex-loadmore')];
  assert.equal(buttons.length,1);
  buttons[0].click();await wait();
  assert.equal(root.querySelectorAll('.ex-card').length,80);
  assert.equal(root.querySelector('.ex-card'),first,'existing card element was replaced during pagination');
  assert.equal(root.querySelectorAll('.ex-loadmore').length,1);
  root.querySelector('.ex-loadmore').click();await wait();
  assert.equal(root.querySelectorAll('.ex-card').length,85);
  assert.equal(root.querySelectorAll('.ex-loadmore').length,0);
  await t.close();
});

test('H2 disclosure toggles its own region without rebuilding the main Markdown',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  const card=root.querySelector('.ex-card');
  const source=[...card.querySelectorAll('.ex-group-trigger')].find(x=>x.textContent==='来源');
  const count=()=>renders.filter(x=>x.path===t.md.path&&x.content.includes('![[图片.png]]')).length;
  const initial=count();
  source.click();await wait();
  assert.equal(source.getAttribute('aria-expanded'),'true');
  assert.equal(card.querySelectorAll('.ex-group-body:not([hidden])').length,1);
  assert.equal(count(),initial);
  source.click();
  assert.equal(source.getAttribute('aria-expanded'),'false');
  assert.equal(card.querySelectorAll('.ex-group-body:not([hidden])').length,0);
  await t.close();
});

test('card tags are the last content group and not duplicated above H2 sections',async()=>{
  const t=await fixture();const card=t.pane.contentEl.querySelector('.ex-card');
  assert.equal(card.children[0].classList.contains('ex-quote'),true);
  assert.equal(card.children[1].classList.contains('ex-extras'),true);
  assert.equal(card.children[2].classList.contains('ex-tag-editor'),true);
  assert.equal(card.lastElementChild.classList.contains('ex-card-footer'),true);
  assert.equal(card.querySelectorAll('.ex-chips').length,1);
  assert.equal(card.querySelectorAll('.ex-card-options').length,1);
  await t.close();
});

test('standalone leading Markdown media receives wider card treatment only without H1',async()=>{
  const media=await fixture(false,'![[图片.png]]\n\n旅途中收集的风景\n\n## 来源\n相册');
  assert.equal(media.pane.contentEl.querySelector('.ex-card').classList.contains('ex-media-first'),true);
  await media.close();
  const titled=await fixture();
  assert.equal(titled.pane.contentEl.querySelector('.ex-card').classList.contains('ex-media-first'),false);
  await titled.close();
});

test('empty capture is disabled and an unsaved draft survives reopening the home view',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  const composer=root.querySelector('.ex-compose-text');
  const save=[...root.querySelectorAll('.ex-compose-actions button')].find(x=>x.textContent==='保存');
  assert.equal(save.disabled,true);
  composer.value='重新打开后仍然存在的摘录';
  composer.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  assert.equal(save.disabled,false);
  await t.pane.onUnloadFile(t.home);
  await t.pane.openFile(t.home);
  await wait();
  assert.equal(t.pane.contentEl.querySelector('.ex-compose-text').value,'重新打开后仍然存在的摘录');
  await t.close();
});

test('unchanged Done closes card editor without writing YAML',async()=>{
  const t=await fixture();const card=t.pane.contentEl.querySelector('.ex-card');
  card.querySelector('.ex-add-tag').click();
  card.querySelector('.ex-tag-done').click();
  assert.equal(card.querySelector('.ex-tag-editor').hidden,true);
  assert.equal(t.getTagWrites(),0);
  await t.close();
});
test('stale frontmatter refuses save and retains draft picker for retry or cancel',async()=>{
  const t=await fixture();const card=t.pane.contentEl.querySelector('.ex-card');
  card.querySelector('.ex-add-tag').click();
  const input=card.querySelector('.ex-tag-custom');
  input.value='新词';input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  [...card.querySelectorAll('.ex-tag-choice')].find(b=>b.textContent.includes('创建 #新词')).click();
  t.tagState.set(t.md.path,['另一个编辑器']);
  card.querySelector('.ex-tag-done').click();await wait();
  assert.equal(card.querySelector('.ex-tag-editor').hidden,false);
  assert.equal(card.querySelector('.ex-tag-custom'),input);
  assert.deepEqual(t.tagState.get(t.md.path),['另一个编辑器']);
  assert.ok(card.querySelector('.ex-tag-choice'));
  card.querySelector('.ex-tag-cancel').click();
  assert.equal(card.querySelector('.ex-tag-editor').hidden,true);
  await t.close();
});
test('tag search clear only clears the query, not the picker or selected tags',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  clickByLabel(root,'添加标签');
  const input=root.querySelector('.ex-tags-input');
  input.value='文学';input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  clickByLabel(root,'清空标签搜索');
  assert.equal(input.value,'');
  assert.equal(root.querySelector('.ex-capture-tags').hidden,false);
  const selected=[...root.querySelectorAll('.ex-tag-choice')].find(b=>b.textContent==='哲学');
  selected.click();
  assert.equal(root.querySelectorAll('.ex-capture-selected .ex-tag').length,1);
  await t.close();
});
