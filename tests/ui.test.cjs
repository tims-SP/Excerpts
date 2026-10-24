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
class MarkdownView {constructor(){this.mode='preview';this.editor={cursor:null,scrolled:null,focused:false,lastLine(){return 0;},getLine(){return '';},setCursor(pos){this.cursor=pos;},scrollIntoView(range,center){this.scrolled={range,center};},focus(){this.focused=true;}};}getMode(){return this.mode;}}
class Plugin {async loadData(){return null;}async saveData(){}registerView(kind,factory){this.factory=factory;}registerExtensions(exts,type){this.extensions={exts,type};}addSettingTab(){}addCommand(){}registerEvent(){}addRibbonIcon(icon,title,action){this.ribbon={icon,title,action};}}
class PluginSettingTab {constructor(){}}
class Setting {}
class Notice {constructor(message){Notice.last=message;}}
class Menu {constructor(){this.items=[];}addItem(fn){const item={setTitle(title){this.title=title;return this;},setIcon(icon){this.icon=icon;return this;},setDisabled(value){this.disabled=value;return this;},setWarning(){this.warning=true;return this;},onClick(handler){this.handler=handler;return this;}};fn(item);this.items.push(item);}addSeparator(){}showAtPosition(){Menu.last=this;}}
class Modal {
  constructor(){this.modalEl=document.createElement('section');this.contentEl=document.createElement('div');this.modalEl.append(this.contentEl);}
  open(){document.body.append(this.modalEl);this.onOpen?.();Modal.last=this;return this;}
  close(){this.onClose?.();this.modalEl.remove();}
}
const renders=[];
const mocks={TAbstractFile,TFile,TFolder,MarkdownRenderChild,FileView,MarkdownView,Plugin,PluginSettingTab,Setting,Notice,Menu,Modal,
  parseYaml(raw){
    const version=raw.match(/^version:\s*(\d+)$/m);
    const tag=raw.match(/^\s*tag:\s*(.+)$/m);
    const query=raw.match(/^\s*query:\s*(.+)$/m);
    return {version:version?Number(version[1]):null,
      filter:{tag:tag?JSON.parse(tag[1]):null,query:query?JSON.parse(query[1]):null}};
  },
  setIcon(el,name){el.setAttribute('data-icon',name);},
  getAllTags(cache){return [...(cache.tags||[]).map(t=>t.tag),...(cache.frontmatter?.tags||[]).map(t=>'#'+t)];},
  MarkdownRenderer:{async render(app,content,target,path){renders.push({content,path});target.append(document.createTextNode(content));}}
};
const old=Module._load;Module._load=function(request,parent,isMain){if(request==='obsidian')return mocks;return old.apply(this,arguments);};
const Excerpts=require('../main.js');Module._load=old;
const wait=()=>new Promise(resolve=>setTimeout(resolve,70));
async function waitFor(check, label='UI state', timeout=4000){
  const started=Date.now();
  while(!check()){
    if(Date.now()-started>=timeout) assert.fail('Timed out waiting for '+label);
    await new Promise(resolve=>setTimeout(resolve,10));
  }
}
function waitForIndex(t, total=t.plugin.app.vault.getMarkdownFiles().length){
  return waitFor(()=>t.pane.contentEl.querySelector('.ex-scan-text')?.textContent===
    '已扫描 · '+total+' 条', 'index count '+total);
}
function clickByLabel(container,label){const el=container.querySelector(`button[aria-label="${label}"]`);assert.ok(el,'Missing button: '+label);el.click();return el;}

async function fixture(noTags=false,markdown='# 测试标题\n\n![[图片.png]]\n\n## 来源\n\n《某书》\n\n## 批注\n\n摘录笔记',inlineTags=[]){
  const files=new Map();
  const dir=new TFolder('摘录'); files.set('摘录',{file:dir});
  const home=new TFile('摘录/首页.excerpts'); files.set(home.path,{file:home,data:''});
  const md=new TFile('摘录/测试.md'); files.set(md.path,{file:md,data:markdown});
  const tagState=new Map([[md.path,noTags?[]:['哲学']]]);
  let tagWrites=0;
  const vaultEvents=new Map();
  const vault={getAbstractFileByPath(path){return files.get(path)?.file??null;},getFiles(){return [...files.values()].filter(x=>x.file instanceof TFile).map(x=>x.file);},getAllLoadedFiles(){return [...files.values()].map(x=>x.file);},getMarkdownFiles(){return this.getFiles().filter(x=>x.extension==='md');},
    async cachedRead(file){return files.get(file.path).data;},async read(file){return files.get(file.path).data;},
    async process(file,update){const entry=files.get(file.path);entry.data=update(entry.data);file.stat.mtime++;file.stat.size=entry.data.length;return entry.data;},async createFolder(path){files.set(path,{file:new TFolder(path)});},async create(path,content){if(files.has(path))throw Error('exists');const f=new TFile(path);files.set(path,{file:f,data:content});return f;},on(name,handler){vaultEvents.set(name,handler);return {};}};
  const plugin=new Excerpts();
  const leaf={lastFile:null,view:null,async openFile(file){this.lastFile=file;this.view=new MarkdownView();this.view.file=file;},async setViewState(state){this.state=state;if(this.view)this.view.mode=state.state.mode;}};
  plugin.app={vault,metadataCache:{getFileCache(f){return {
    tags:f.path===md.path?inlineTags.map(tag=>({tag:'#'+tag})):[],
    frontmatter:{tags:tagState.get(f.path)||[]}
  };},on(){return {};}}
    ,fileManager:{async trashFile(f){files.delete(f.path);},async processFrontMatter(f,fn){
      const fm={tags:[...(tagState.get(f.path)||[])]};
      fn(fm);
      tagState.set(f.path,fm.tags||[]);
      tagWrites++;
    }},workspace:{getLeaf(){return leaf;},getLeavesOfType(){return leaf.view instanceof MarkdownView?[leaf]:[];},on(){return {};},async revealLeaf(){}}};
  await plugin.onload();
  const pane=plugin.factory({});document.body.append(pane.contentEl);
  await pane.openFile(home);
  await waitFor(()=>pane.contentEl.querySelector('.ex-scan-text')?.textContent==='已扫描 · 1 条' &&
    pane.contentEl.querySelectorAll('.ex-card').length===1 &&
    !pane.contentEl.querySelector('.ex-card-loading'),'initial index and card hydration');
  return {files,plugin,pane,leaf,md,home,tagState,vaultEvents,getTagWrites:()=>tagWrites,async close(){
    await pane.onUnloadFile(home);pane.contentEl.remove();
    document.querySelectorAll('.ex-delete-modal,.ex-save-page-modal').forEach(el=>el.remove());
  }};
}

test('opening .excerpts displays an editorial date-group feed and always-visible composer',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  assert.equal(t.plugin.extensions.type,'excerpts-home-file');
  assert.deepEqual(Object.keys(t.plugin.settings).sort(),['defaultHome','recursive','scanBatchSize']);
  assert.equal(t.plugin.settings.scanBatchSize,64);
  assert.equal(root.querySelector('.ex-scan-status').dataset.state,'done');
  assert.equal(root.querySelector('.ex-scan-text').textContent,'已扫描 · 1 条');
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
test('capture composer has a separate writing body, a single stable footer and flomo-oriented placeholder',async()=>{
  const t=await fixture();
  const root=t.pane.contentEl;
  const composer=root.querySelector('.ex-composer');
  assert.ok(composer.querySelector('.ex-compose-body > .ex-compose-text'));
  assert.equal(root.querySelector('.ex-compose-text').rows,3);
  assert.equal(root.querySelector('.ex-compose-text').placeholder,'现在想记录的是…');
  assert.equal(composer.children.length,3);
  assert.equal(composer.children[0].className,'ex-compose-body');
  assert.equal(composer.children[1].className,'ex-capture-tags');
  assert.equal(composer.children[2].className,'ex-compose-actions');
  const actions=composer.querySelector('.ex-compose-actions');
  assert.equal(actions.children.length,3);
  assert.equal(actions.children[0].className,'ex-capture-options');
  assert.ok(actions.children[1].classList.contains('ex-open-editor'));
  assert.equal(actions.children[1].getAttribute('aria-label'),'编辑文档');
  assert.ok(actions.children[2].classList.contains('ex-btn-primary'));
  const toggle=actions.querySelector('.ex-capture-tag-toggle');
  assert.equal(toggle.textContent,'标签');
  assert.equal(toggle.getAttribute('aria-expanded'),'false');
  await t.close();
});

test('capture chip opens picker to edit instead of deleting, and returning to body closes only panel',async()=>{
  const t=await fixture();
  const root=t.pane.contentEl;
  clickByLabel(root,'添加标签');
  const row=[...root.querySelectorAll('.ex-capture-tags .ex-tag-choice')].find(x=>x.textContent==='哲学');
  row.click();
  const chip=root.querySelector('.ex-capture-selected .ex-capture-chip');
  assert.ok(chip);assert.equal(chip.textContent,'#哲学');
  assert.equal(chip.getAttribute('aria-label'),'编辑标签：哲学');
  assert.equal(root.querySelector('.ex-capture-tag-toggle').textContent,'');
  const priorChips=root.querySelectorAll('.ex-capture-selected .ex-capture-chip').length;
  clickByLabel(root,'添加标签');
  assert.equal(root.querySelector('.ex-capture-tags').hidden,true);
  chip.click();
  assert.equal(root.querySelector('.ex-capture-tags').hidden,false);
  root.querySelector('.ex-compose-text').dispatchEvent(new dom.window.Event('focus'));
  assert.equal(root.querySelector('.ex-capture-tags').hidden,true);
  assert.equal(root.querySelectorAll('.ex-capture-selected .ex-capture-chip').length,priorChips);
  // Leave the session-scoped draft clean for following tests.
  clickByLabel(root,'添加标签');
  [...root.querySelectorAll('.ex-capture-tags .ex-tag-choice')].find(x=>x.textContent==='哲学').click();
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
  assert.equal(root.querySelectorAll('.ex-capture-selected .ex-capture-chip').length,2);
  assert.ok(!root.querySelector('.ex-capture-selected').textContent.includes('×'));
  [...root.querySelectorAll('.ex-compose-actions button')].find(x=>x.textContent==='保存').click();
  await wait();
  const entries=[...t.files].filter(([path])=>path.startsWith('摘录/摘录 ') && path.endsWith('.md'));
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
  assert.deepEqual(menu.items.map(x=>x.title),['编辑原文','编辑分组：来源','编辑分组：批注','删除摘录']);
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
    ['编辑原文','编辑分组：来源（第 1 个）','编辑分组：来源（第 2 个）','删除摘录']);
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
  assert.equal(root.querySelectorAll('.ex-capture-selected .ex-capture-chip').length,1);
  [...root.querySelectorAll('.ex-capture-tags .ex-tag-choice')].find(x=>x.textContent==='哲学').click();
  assert.equal(root.querySelectorAll('.ex-capture-selected .ex-capture-chip').length,0);
  const input=root.querySelector('.ex-tags-input');
  input.value='灵感';input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  assert.equal(root.querySelectorAll('.ex-capture-selected .ex-capture-chip').length,1);
  root.querySelector('.ex-compose-text').value='一段新摘录';root.querySelector('.ex-compose-text').dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  [...root.querySelectorAll('.ex-compose-actions button')].find(x=>x.textContent==='保存').click();
  await wait();
  const entry=[...t.files].find(([path])=>path.startsWith('摘录/摘录 ') && path.endsWith('.md'))?.[1];
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
  clickByLabel(root,'添加标签');
  [...root.querySelectorAll('.ex-capture-tags .ex-tag-choice')].find(row=>row.textContent==='哲学').click();
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
  await waitForIndex(t,85);
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
  const before=root.querySelectorAll('.ex-capture-selected .ex-tag').length;
  const selected=[...root.querySelectorAll('.ex-tag-choice')].find(b=>b.textContent==='哲学');
  const active=selected.getAttribute('aria-selected')==='true';
  selected.click();
  assert.equal(root.querySelectorAll('.ex-capture-selected .ex-tag').length,before+(active?-1:1));
  assert.equal(root.querySelector('.ex-capture-tags').hidden,false);
  if(!active) [...root.querySelectorAll('.ex-capture-tags .ex-tag-choice')].find(row=>row.textContent==='哲学').click();
  await t.close();
});


test('page actions appear only in the timeline toolbar and disabled actions have no filter',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  const more=clickByLabel(root,'页面选项');
  assert.ok(more.closest('.ex-toolbar-actions'));
  assert.equal(root.querySelectorAll('.ex-page-options').length,1);
  assert.equal(root.querySelectorAll('.ex-card-options').length,1);
  assert.deepEqual(Menu.last.items.map(item=>item.title),
    ['刷新摘录','批量选择','保存当前筛选…','清除筛选']);
  assert.equal(Menu.last.items.find(item=>item.title==='刷新摘录').disabled,false);
  assert.equal(Menu.last.items.find(item=>item.title==='批量选择').disabled,false);
  assert.equal(Menu.last.items.find(item=>item.title==='保存当前筛选…').disabled,true);
  assert.equal(Menu.last.items.find(item=>item.title==='清除筛选').disabled,true);
  await t.close();
});

test('save current filter creates a reusable .excerpts file without replacing the default home',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  clickByLabel(root,'筛选标签');
  [...root.querySelectorAll('.ex-filter-tags button')].find(x=>x.textContent==='#哲学').click();
  clickByLabel(root,'页面选项');
  const save=Menu.last.items.find(item=>item.title==='保存当前筛选…');
  assert.equal(save.disabled,false);
  save.handler();
  const dialog=document.querySelector('.ex-save-page-modal');
  assert.ok(dialog);
  assert.equal(dialog.querySelector('.ex-save-page-input').value,'哲学摘录');
  assert.match(dialog.querySelector('.ex-save-page-hint').textContent,/哲学摘录.excerpts/);
  dialog.querySelector('.ex-save-page-submit').click();
  await wait();
  const saved=t.files.get('摘录/哲学摘录.excerpts');
  assert.ok(saved);
  assert.match(saved.data,/version: 1/);
  assert.match(saved.data,/tag: "哲学"/);
  assert.equal(t.plugin.settings.defaultHome,t.home.path);
  assert.equal(t.leaf.lastFile,saved.file);
  assert.equal(document.querySelector('.ex-save-page-modal'),null);
  await t.close();
});

test('saved page restores filters and can update only after explicit confirmation',async()=>{
  const t=await fixture();
  const saved=await t.plugin.createSavedPage(t.home.path,'文学摘录',{tag:'哲学',query:''});
  const initial=t.files.get(saved.path).data;
  await t.pane.openFile(saved);await wait();
  const root=t.pane.contentEl;
  assert.equal(root.querySelector('.ex-title').textContent,'文学摘录');
  assert.equal(root.querySelector('.ex-filter-tags').hidden,false);
  assert.equal(root.querySelector('.ex-selected').textContent,'#哲学');
  assert.equal(root.querySelectorAll('.ex-card').length,1);
  assert.equal(t.plugin.settings.defaultHome,t.home.path,'opening a saved page must not become default');
  [...root.querySelectorAll('.ex-filter-tags button')].find(x=>x.textContent==='全部').click();
  assert.equal(t.files.get(saved.path).data,initial,'temporary filter changes must not rewrite file');
  clickByLabel(root,'页面选项');
  assert.deepEqual(Menu.last.items.map(item=>item.title),
    ['刷新摘录','批量选择','更新当前页面','另存为摘录页…','恢复已保存的筛选','清除筛选']);
  Menu.last.items.find(item=>item.title==='恢复已保存的筛选').handler();
  assert.equal(root.querySelector('.ex-selected').textContent,'#哲学');
  [...root.querySelectorAll('.ex-filter-tags button')].find(x=>x.textContent==='全部').click();
  clickByLabel(root,'页面选项');
  Menu.last.items.find(item=>item.title==='更新当前页面').handler();await wait();
  assert.match(t.files.get(saved.path).data,/tag: ""/);
  assert.equal(root.querySelector('.ex-title').textContent,'文学摘录');
  await t.pane.openFile(t.home);await wait();
  assert.equal(t.pane.contentEl.querySelector('.ex-title').textContent,'摘录');
  await t.close();
});

test('saved query restores search UI; invalid or duplicate save names are blocked',async()=>{
  const t=await fixture();
  const saved=await t.plugin.createSavedPage(t.home.path,'检索摘录',{tag:'',query:'测试标题'});
  await t.pane.openFile(saved);
  await waitFor(()=>t.pane.contentEl.querySelector('.ex-search')?.value==='测试标题' &&
    t.pane.contentEl.querySelectorAll('.ex-card').length===1 &&
    t.pane.contentEl.querySelector('.ex-count')?.textContent==='1 / 1','saved query results');
  const root=t.pane.contentEl;
  assert.equal(root.querySelector('.ex-search').value,'测试标题');
  assert.equal(root.querySelector('.ex-search-wrap').hidden,false);
  assert.equal(root.querySelectorAll('.ex-card').length,1);
  assert.equal(t.plugin.savedPageNameIssue(saved.path,'首页')!==null,true);
  assert.equal(t.plugin.savedPageNameIssue(saved.path,'检索摘录')!==null,true);
  assert.equal(t.plugin.savedPageNameIssue(saved.path,'异常/名称')!==null,true);
  clickByLabel(root,'页面选项');
  Menu.last.items.find(item=>item.title==='另存为摘录页…').handler();
  const dialog=document.querySelector('.ex-save-page-modal');
  assert.ok(dialog);
  const input=dialog.querySelector('.ex-save-page-input');
  input.value='首页';input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  assert.equal(dialog.querySelector('.ex-save-page-submit').disabled,true);
  dialog.querySelector('.ex-save-page-cancel').click();
  assert.equal(document.querySelector('.ex-save-page-modal'),null);
  await t.close();
});


test('empty composer enters native Markdown and safely trashes an unchanged blank note after closing',async()=>{
  const t=await fixture();
  const root=t.pane.contentEl;
  // Previous tests can leave a session draft; explicitly clear it for the blank-note case.
  const textarea=root.querySelector('.ex-compose-text');
  textarea.value='';
  textarea.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  clickByLabel(root,'编辑文档');
  await wait();
  const created=[...t.files].find(([path])=>path.startsWith('摘录/摘录 ') && path.endsWith('.md'));
  assert.ok(created,'timestamp note created');
  assert.equal(t.leaf.lastFile,created[1].file);
  assert.equal(t.leaf.view.mode,'source');
  assert.equal(t.leaf.view.editor.focused,true);
  t.leaf.view=null;
  await t.plugin.cleanupClosedEditors();
  assert.equal(t.files.has(created[0]),false,'blank new file moved to trash');
  await t.close();
});

test('composer editor preserves Markdown and inherited tags when closing the native tab',async()=>{
  const t=await fixture();
  const root=t.pane.contentEl;
  const input=root.querySelector('.ex-compose-text');
  input.value='# 时间与生活\n\n正文'; input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  clickByLabel(root,'添加标签');
  [...root.querySelectorAll('.ex-capture-tags .ex-tag-choice')].find(e=>e.textContent==='哲学').click();
  clickByLabel(root,'编辑文档');
  await wait();
  const saved=t.files.get('摘录/时间与生活.md');
  assert.ok(saved);
  assert.match(saved.data,/# 时间与生活\n\n正文/);
  assert.match(saved.data,/  - "哲学"/);
  t.leaf.view=null;
  await t.plugin.cleanupClosedEditors();
  assert.equal(t.files.has('摘录/时间与生活.md'),true);
  assert.equal(input.value,'');
  await t.close();
});

test('empty editor with inherited tags is cleaned only when frontmatter stays unchanged',async()=>{
  const t=await fixture();
  const root=t.pane.contentEl;
  clickByLabel(root,'添加标签');
  [...root.querySelectorAll('.ex-capture-tags .ex-tag-choice')].find(e=>e.textContent==='哲学').click();
  clickByLabel(root,'编辑文档'); await wait();
  const item=[...t.files].find(([path])=>path.startsWith('摘录/摘录 ') && path.endsWith('.md'));
  assert.ok(item);
  assert.match(item[1].data,/tags:/);
  t.leaf.view=null;
  await t.plugin.cleanupClosedEditors();
  assert.equal(t.files.has(item[0]),false);
  await t.close();
});

test('modified native properties protect otherwise empty files from cleanup',async()=>{
  const t=await fixture();
  clickByLabel(t.pane.contentEl,'编辑文档');
  await wait();
  const item=[...t.files].find(([path])=>path.startsWith('摘录/摘录 ') && path.endsWith('.md'));
  item[1].data='---\naliases: [重要笔记]\n---\n\n';
  item[1].file.stat.mtime++;
  t.leaf.view=null;
  await t.plugin.cleanupClosedEditors();
  assert.equal(t.files.has(item[0]),true);
  await t.close();
});

test('switching away without closing native Markdown keeps an empty editor document',async()=>{
  const t=await fixture();
  clickByLabel(t.pane.contentEl,'编辑文档');
  await wait();
  const item=[...t.files].find(([path])=>path.startsWith('摘录/摘录 ') && path.endsWith('.md'));
  await t.plugin.cleanupClosedEditors();
  assert.equal(t.files.has(item[0]),true);
  await t.close();
});


test('double clicking editor action does not create duplicate Markdown documents',async()=>{
  const t=await fixture();
  const button=clickByLabel(t.pane.contentEl,'编辑文档');
  button.click();
  await wait();
  const created=[...t.files].filter(([path])=>path.startsWith('摘录/摘录 ') && path.endsWith('.md'));
  assert.equal(created.length,1);
  t.leaf.view=null;
  await t.plugin.cleanupClosedEditors();
  await t.close();
});

test('failed native open retries the already saved file instead of creating another',async()=>{
  const t=await fixture();
  const original=t.leaf.openFile;
  t.leaf.openFile=async()=>{throw Error('editor temporarily unavailable');};
  clickByLabel(t.pane.contentEl,'编辑文档');
  await wait();
  const created=[...t.files].filter(([path])=>path.startsWith('摘录/摘录 ') && path.endsWith('.md'));
  assert.equal(created.length,1);
  t.leaf.openFile=original;
  clickByLabel(t.pane.contentEl,'编辑文档');
  await wait();
  assert.equal([...t.files].filter(([path])=>path.startsWith('摘录/摘录 ') && path.endsWith('.md')).length,1);
  assert.equal(t.leaf.lastFile,created[0][1].file);
  t.leaf.view=null;
  await t.plugin.cleanupClosedEditors();
  await t.close();
});

test('manual file renaming disables blank-note auto cleanup',async()=>{
  const t=await fixture();
  clickByLabel(t.pane.contentEl,'编辑文档'); await wait();
  const item=[...t.files].find(([path])=>path.startsWith('摘录/摘录 ') && path.endsWith('.md'));
  t.files.delete(item[0]);
  item[1].file.path='摘录/用户手动命名.md';
  t.files.set(item[1].file.path,item[1]);
  t.leaf.view=null;
  await t.plugin.cleanupClosedEditors();
  assert.equal(t.files.has('摘录/用户手动命名.md'),true);
  await t.close();
});


test('single-card deletion requires native confirmation and uses the vault trash behavior',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  clickByLabel(root,'卡片选项');await wait();
  assert.equal(Menu.last.items.at(-1).title,'删除摘录');
  Menu.last.items.at(-1).handler();
  let modal=document.querySelector('.ex-delete-modal');
  assert.ok(modal);assert.equal(t.files.has(t.md.path),true);
  modal.querySelector('.ex-delete-cancel').click();
  assert.equal(document.querySelector('.ex-delete-modal'),null);
  assert.equal(t.files.has(t.md.path),true);
  clickByLabel(root,'卡片选项');await wait();
  Menu.last.items.at(-1).handler();
  modal=document.querySelector('.ex-delete-modal');
  modal.querySelector('.ex-delete-submit').click();
  await waitFor(()=>!t.files.has(t.md.path) && root.querySelectorAll('.ex-card').length===0,
    'single deletion and card removal');
  assert.equal(t.files.has(t.md.path),false);
  assert.equal(root.querySelectorAll('.ex-card').length,0);
  assert.ok(t.files.has(t.home.path),'the .excerpts file is never deleted');
  await t.close();
});

test('selection mode toggles cards without reopening Markdown or changing tags',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  clickByLabel(root,'页面选项');
  Menu.last.items.find(item=>item.title==='批量选择').handler();
  assert.ok(root.querySelector('.excerpts-root').classList.contains('ex-is-selecting'));
  assert.equal(root.querySelector('.ex-composer').isConnected,true);
  const card=root.querySelector('.ex-card');
  assert.equal(card.getAttribute('role'),'checkbox');
  assert.equal(card.getAttribute('aria-checked'),'false');
  card.click();
  assert.equal(card.getAttribute('aria-checked'),'true');
  assert.match(root.querySelector('.ex-selection-count').textContent,/已选 1 \/ 1/);
  card.querySelector('.ex-add-tag').click();
  assert.equal(card.getAttribute('aria-checked'),'true','disabled tag action cannot alter selection');
  assert.equal(card.querySelector('.ex-tag-editor').hidden,true);
  root.querySelector('.ex-select-done').click();
  assert.equal(root.querySelector('.excerpts-root').classList.contains('ex-is-selecting'),false);
  assert.equal(t.files.has(t.md.path),true);
  await t.close();
});

test('bulk select-all includes unloaded cards while cancel preserves every Markdown file',async()=>{
  const t=await fixture();
  for(let i=0;i<85;i++) await t.plugin.app.vault.create('摘录/批量-'+String(i).padStart(3,'0')+'.md','例子 '+i);
  t.plugin.refreshViews(true);await waitForIndex(t);
  const root=t.pane.contentEl;
  assert.equal(root.querySelectorAll('.ex-card').length,40);
  clickByLabel(root,'页面选项');Menu.last.items.find(item=>item.title==='批量选择').handler();
  root.querySelector('.ex-select-all').click();
  assert.match(root.querySelector('.ex-selection-count').textContent,/已选 86 \/ 86/);
  assert.equal(root.querySelectorAll('.ex-card').length,40,'must not hydrate all matching files');
  root.querySelector('.ex-delete-selected').click();
  const modal=document.querySelector('.ex-delete-modal');
  assert.ok(modal);
  assert.match(modal.querySelector('.ex-delete-title').textContent,/86 条/);
  modal.querySelector('.ex-delete-cancel').click();
  root.querySelector('.ex-select-done').click();
  assert.equal(t.plugin.app.vault.getMarkdownFiles().length,86);
  await t.close();
});

test('bulk delete keeps modified snapshots and open editors safe; failed files remain selectable',async()=>{
  const t=await fixture();
  const second=await t.plugin.app.vault.create('摘录/其他.md','其他摘录');
  t.plugin.refreshViews(true);await waitForIndex(t);
  const root=t.pane.contentEl;
  clickByLabel(root,'页面选项');Menu.last.items.find(item=>item.title==='批量选择').handler();
  root.querySelector('.ex-select-all').click();
  t.md.stat.mtime++;
  root.querySelector('.ex-delete-selected').click();
  document.querySelector('.ex-delete-modal .ex-delete-submit').click();
  await waitFor(()=>document.querySelector('.ex-delete-modal .ex-delete-submit')?.textContent==='完成',
    'partial deletion summary');
  assert.ok(t.files.has(t.md.path),'modified original remains intact');
  assert.equal(t.files.has(second.path),false,'unmodified peer is trashed');
  assert.ok(root.querySelector('.excerpts-root').classList.contains('ex-is-selecting'));
  assert.match(root.querySelector('.ex-selection-count').textContent,/已选 0/);
  assert.match(document.querySelector('.ex-delete-modal .ex-delete-progress-summary').textContent,/2 \/ 2/);
  document.querySelector('.ex-delete-modal .ex-delete-submit').click();
  root.querySelector('.ex-select-done').click();
  assert.equal(root.querySelector('.ex-scan-status').dataset.state,'stale');
  await t.plugin.openMarkdown(t.md.path);await wait();
  clickByLabel(root,'卡片选项');await wait();
  assert.equal(Menu.last.items.at(-1).disabled,true,'stale index prohibits another deletion');
  assert.ok(t.files.has(t.md.path),'open Markdown editors are protected');
  await t.close();
});

test('select all respects a tag filter and never includes out-of-scope Markdown',async()=>{
  const t=await fixture();
  const unrelated=await t.plugin.app.vault.create('摘录/无标签.md','无标签的正文');
  t.plugin.refreshViews(true);await waitForIndex(t);
  const root=t.pane.contentEl;
  clickByLabel(root,'筛选标签');
  const tag=[...root.querySelectorAll('.ex-filter-tags button')].find(el=>el.textContent==='#哲学');
  assert.ok(tag);tag.click();
  assert.equal(root.querySelectorAll('.ex-card').length,1);
  clickByLabel(root,'页面选项');Menu.last.items.find(item=>item.title==='批量选择').handler();
  root.querySelector('.ex-select-all').click();
  assert.match(root.querySelector('.ex-selection-count').textContent,/已选 1 \/ 1/);
  root.querySelector('.ex-delete-selected').click();
  const modal=document.querySelector('.ex-delete-modal');
  modal.querySelector('.ex-delete-submit').click();
  await waitFor(()=>!t.files.has(t.md.path),'filtered deletion');
  assert.equal(t.files.has(t.md.path),false);
  assert.equal(t.files.has(unrelated.path),true);
  assert.equal(t.files.has(t.home.path),true);
  await t.close();
});

test('single deletion shows a spinner and blocks native modal close while file trash is pending',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  let finishTrash;
  t.plugin.app.fileManager.trashFile=file=>new Promise(resolve=>{
    finishTrash=()=>{t.files.delete(file.path);resolve();};
  });
  clickByLabel(root,'卡片选项');await wait();
  Menu.last.items.at(-1).handler();
  const modal=Modal.last;
  modal.modalEl.querySelector('.ex-delete-submit').click();
  assert.equal(modal.modalEl.querySelector('.ex-delete-submit').textContent,'删除中…');
  assert.ok(modal.modalEl.querySelector('.ex-delete-spinner'));
  modal.close();
  assert.ok(modal.modalEl.isConnected,'the native close action must be ignored while busy');
  assert.equal(modal.modalEl.querySelector('.ex-delete-submit').disabled,true);
  finishTrash();
  await waitFor(()=>!modal.modalEl.isConnected && !t.files.has(t.md.path),'single deletion completed');
  assert.equal(t.files.has(t.md.path),false);
  assert.equal(modal.modalEl.isConnected,false);
  await t.close();
});

test('bulk deletion reports actual processed counts and requires Done after completion',async()=>{
  const t=await fixture();
  const other=await t.plugin.app.vault.create('摘录/其他.md','其他正文');
  t.plugin.refreshViews(true);await waitForIndex(t);
  const root=t.pane.contentEl;
  const original=t.plugin.app.fileManager.trashFile;
  t.plugin.app.fileManager.trashFile=async file=>{
    await new Promise(resolve=>setTimeout(resolve,2));
    await original(file);
  };
  clickByLabel(root,'页面选项');Menu.last.items.find(item=>item.title==='批量选择').handler();
  root.querySelector('.ex-select-all').click();
  root.querySelector('.ex-delete-selected').click();
  const modal=Modal.last;
  modal.modalEl.querySelector('.ex-delete-submit').click();
  assert.equal(modal.modalEl.querySelector('.ex-delete-progress').hidden,false);
  assert.equal(modal.modalEl.querySelector('progress').max,2);
  modal.close();
  assert.equal(modal.modalEl.isConnected,true,'bulk deletion modal must remain open while working');
  await waitFor(()=>modal.modalEl.querySelector('.ex-delete-submit').textContent==='完成',
    'bulk deletion completed');
  assert.equal(modal.modalEl.querySelector('progress').value,2);
  assert.equal(modal.modalEl.querySelector('.ex-delete-progress-summary').textContent,'2 / 2');
  assert.equal(modal.modalEl.querySelector('.ex-delete-submit').textContent,'完成');
  assert.equal(t.files.has(t.md.path),false);
  assert.equal(t.files.has(other.path),false);
  modal.modalEl.querySelector('.ex-delete-submit').click();
  assert.equal(modal.modalEl.isConnected,false);
  await t.close();
});

test('select-all over 200 entries yields to UI and disables destructive actions until complete',async()=>{
  const t=await fixture();
  for(let i=0;i<425;i++) await t.plugin.app.vault.create('摘录/测试批量-'+i+'.md','摘录');
  t.plugin.refreshViews(true);await waitForIndex(t);
  const root=t.pane.contentEl;
  clickByLabel(root,'页面选项');Menu.last.items.find(item=>item.title==='批量选择').handler();
  root.querySelector('.ex-select-all').click();
  assert.match(root.querySelector('.ex-selection-count').textContent,/正在选择 200 \/ 426/);
  assert.equal(root.querySelector('.ex-select-all').disabled,true);
  assert.equal(root.querySelector('.ex-delete-selected').disabled,true);
  await waitFor(()=>root.querySelector('.ex-selection-count').textContent==='已选 426 / 426',
    'large selection completed');
  assert.match(root.querySelector('.ex-selection-count').textContent,/已选 426 \/ 426/);
  assert.equal(root.querySelector('.ex-delete-selected').disabled,false);
  assert.equal(root.querySelectorAll('.ex-card').length,40);
  root.querySelector('.ex-select-done').click();
  assert.equal(root.querySelector('.excerpts-root').classList.contains('ex-is-selecting'),false);
  await t.close();
});

test('clear filter during a canceled search restores bulk selection availability',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  clickByLabel(root,'搜索');
  const search=root.querySelector('.ex-search');
  search.value='不存在的搜索条件';
  search.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  clickByLabel(root,'页面选项');
  assert.equal(Menu.last.items.find(item=>item.title==='批量选择').disabled,true);
  clickByLabel(root,'搜索'); // Explicitly clear a running query; no hidden recovery.
  clickByLabel(root,'页面选项');
  assert.equal(Menu.last.items.find(item=>item.title==='批量选择').disabled,false);
  Menu.last.items.find(item=>item.title==='批量选择').handler();
  assert.ok(root.querySelector('.excerpts-root').classList.contains('ex-is-selecting'));
  root.querySelector('.ex-select-done').click();
  await t.close();
});

test('select all excludes externally missing files, and a second click cancels selection',async()=>{
  const t=await fixture();
  const missing=await t.plugin.app.vault.create('摘录/已不存在.md','外部删除的内容');
  t.plugin.refreshViews(true);await waitForIndex(t);
  const root=t.pane.contentEl;
  clickByLabel(root,'页面选项');
  Menu.last.items.find(item=>item.title==='批量选择').handler();
  t.files.delete(missing.path); // A vault change after entering selection mode.
  root.querySelector('.ex-select-all').click();
  assert.match(root.querySelector('.ex-selection-count').textContent,/已选 1 \/ 1/);
  assert.equal(root.querySelector('.ex-select-all').textContent,'取消全选');
  assert.equal(root.querySelectorAll('.ex-card').length,1,'stale card is removed once');
  root.querySelector('.ex-select-all').click();
  assert.match(root.querySelector('.ex-selection-count').textContent,/已选 0 \/ 1/);
  assert.equal(root.querySelector('.ex-delete-selected').disabled,true);
  root.querySelector('.ex-select-done').click();
  assert.equal(root.querySelectorAll('.ex-card').length,1,
    'missing files must not reappear after leaving selection mode');
  assert.equal(t.files.has(t.md.path),true);
  await t.close();
});

test('clicking an externally removed card prunes it from the current selection',async()=>{
  const t=await fixture();
  const stale=await t.plugin.app.vault.create('摘录/失效.md','已不存在');
  t.plugin.refreshViews(true);await waitForIndex(t);
  const root=t.pane.contentEl;
  clickByLabel(root,'页面选项');
  Menu.last.items.find(item=>item.title==='批量选择').handler();
  const card=Array.from(root.querySelectorAll('.ex-card')).find(el=>el.dataset.path===stale.path);
  assert.ok(card);
  t.files.delete(stale.path);
  card.click();
  assert.match(root.querySelector('.ex-selection-count').textContent,/已选 0 \/ 1/);
  assert.equal(root.querySelectorAll('.ex-card').length,1);
  assert.equal(root.querySelector('.ex-delete-selected').disabled,true);
  root.querySelector('.ex-select-done').click();
  assert.equal(root.querySelectorAll('.ex-card').length,1,
    'stale card stays removed in normal feed');
  await t.close();
});

test('batched selection keeps its original progress denominator when a file disappears',async()=>{
  const t=await fixture();
  for(let i=0;i<201;i++) await t.plugin.app.vault.create('摘录/候选-'+i+'.md','内容');
  t.plugin.refreshViews(true);await waitForIndex(t);
  const root=t.pane.contentEl;
  clickByLabel(root,'页面选项');
  Menu.last.items.find(item=>item.title==='批量选择').handler();
  t.files.delete(t.md.path);
  root.querySelector('.ex-select-all').click();
  assert.match(root.querySelector('.ex-selection-count').textContent,/正在选择 200 \/ 202/);
  assert.equal(root.querySelector('.ex-delete-selected').disabled,true);
  await waitFor(()=>root.querySelector('.ex-selection-count').textContent==='已选 201 / 201',
    'filtered selection with stale file completed');
  assert.match(root.querySelector('.ex-selection-count').textContent,/已选 201 \/ 201/);
  assert.equal(root.querySelector('.ex-select-all').textContent,'取消全选');
  root.querySelector('.ex-select-all').click();
  assert.match(root.querySelector('.ex-selection-count').textContent,/已选 0 \/ 201/);
  root.querySelector('.ex-select-done').click();
  assert.equal(root.querySelectorAll('.ex-card').length,40,
    'normal feed retains the page size after removing missing items');
  await t.close();
});

test('deletion completes without automatic indexing and marks the feed stale',async()=>{
  const t=await fixture();
  const root=t.pane.contentEl, renderer=[...t.plugin.rendered][0];
  let scans=0;
  const scan=t.plugin.repo.scan.bind(t.plugin.repo);
  t.plugin.repo.scan=async(...args)=>{scans++;return scan(...args);};
  let release;
  t.plugin.app.fileManager.trashFile=()=>new Promise(resolve=>{release=resolve;});
  clickByLabel(root,'卡片选项');await waitFor(()=>Menu.last?.items?.at(-1)?.title==='删除摘录');
  Menu.last.items.at(-1).handler();
  const modal=Modal.last;
  modal.modalEl.querySelector('.ex-delete-submit').click();
  assert.equal(renderer.deleteBusy,true);
  t.plugin.refreshViews(true); // Explicit refresh is refused during deletion.
  assert.equal(scans,0);
  release();await waitFor(()=>!renderer.deleteBusy,'delete finishes');
  assert.equal(scans,0,'no index scan is launched by deletion');
  assert.equal(renderer.scanStatus,'stale');
  await t.close();
});

test('manual refresh is refused during selection and is never queued',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  const renderer=[...t.plugin.rendered][0];
  let scans=0;const scan=t.plugin.repo.scan.bind(t.plugin.repo);
  t.plugin.repo.scan=async(...args)=>{scans++;return scan(...args);};
  clickByLabel(root,'页面选项');
  Menu.last.items.find(item=>item.title==='批量选择').handler();
  t.plugin.refreshViews(true);
  assert.equal(scans,0,'blocked refresh starts no scan');
  root.querySelector('.ex-select-done').click();
  await wait();
  assert.equal(scans,0,'exiting selection does not replay blocked refresh');
  t.plugin.refreshViews(true);await waitFor(()=>scans===1,'explicit manual refresh');
  await t.close();
});

test('partial bulk deletion retains failures and requires explicit refresh',async()=>{
  const t=await fixture();
  await t.plugin.app.vault.create('摘录/第二条.md','文本');
  t.plugin.refreshViews(true);await waitForIndex(t,2);
  const root=t.pane.contentEl, renderer=[...t.plugin.rendered][0];
  let scans=0;const scan=t.plugin.repo.scan.bind(t.plugin.repo);
  t.plugin.repo.scan=async(...args)=>{scans++;return scan(...args);};
  clickByLabel(root,'页面选项');Menu.last.items.find(item=>item.title==='批量选择').handler();
  root.querySelector('.ex-select-all').click();
  t.md.stat.mtime++;
  root.querySelector('.ex-delete-selected').click();
  document.querySelector('.ex-delete-modal .ex-delete-submit').click();
  await waitFor(()=>renderer.scanStatus==='stale' && !renderer.deleteBusy,'partial delete completed');
  assert.equal(scans,0,'partial deletion never automatically reindexes');
  document.querySelector('.ex-delete-modal .ex-delete-submit').click();
  root.querySelector('.ex-select-done').click();
  assert.equal(renderer.scanStatus,'stale');
  t.plugin.refreshViews(true);await waitFor(()=>scans===1 && renderer.scanStatus==='done','manual refresh completed');
  assert.ok(t.files.has(t.md.path),'modified file protected');
  await t.close();
});

test('rapid bulk deletion yields between early progress and subsequent chunks',async()=>{
  const t=await fixture();
  for(let i=0;i<17;i++) await t.plugin.app.vault.create('摘录/快速删除-'+i+'.md','待删除');
  const workspace=t.plugin.workspaceForHome(t.home);
  const candidates=t.plugin.app.vault.getMarkdownFiles().map(file=>
    t.plugin.repo.snapshotForDelete(file.path,workspace));
  assert.equal(candidates.length,18);
  const progress=[];
  let firstYielded=false, chunkYielded=false;
  const result=await t.plugin.repo.deleteEntries(workspace,candidates,state=>{
    progress.push(state);
    if(state.processed===1) setTimeout(()=>{firstYielded=true;},0);
    if(state.processed===2)
      assert.equal(firstYielded,true,'the first progress update must reach another UI task');
    if(state.processed===16) setTimeout(()=>{chunkYielded=true;},0);
    if(state.processed===17)
      assert.equal(chunkYielded,true,'a long batch must yield after every 16 entries');
  });
  assert.equal(result.deleted.length,18);
  assert.equal(result.failed.length,0);
  assert.deepEqual(progress.map(state=>state.processed),Array.from({length:18},(_,i)=>i+1));
  assert.equal(progress.at(-1).total,18);
  assert.equal(progress.at(-1).deleted,18);
  assert.ok(t.files.has(t.home.path),'home configuration file must not be touched');
  await t.close();
});

test('an old selection menu cannot enter selection after a new index scan starts',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  clickByLabel(root,'页面选项');
  const staleSelect=Menu.last.items.find(item=>item.title==='批量选择');
  assert.ok(staleSelect && !staleSelect.disabled);
  const realScan=t.plugin.repo.scan.bind(t.plugin.repo);
  let releaseScan, finished=false;
  t.plugin.repo.scan=async(...args)=>{
    await new Promise(resolve=>{releaseScan=resolve;});
    const cards=await realScan(...args);
    finished=true;
    return cards;
  };
  t.plugin.refreshViews(true);
  assert.equal(typeof releaseScan,'function','manual refresh must start an async scan');
  staleSelect.handler();
  assert.equal(root.querySelector('.excerpts-root').classList.contains('ex-is-selecting'),false,
    'previously enabled menu handlers must recheck scan state');
  clickByLabel(root,'页面选项');
  assert.equal(Menu.last.items.find(item=>item.title==='批量选择').disabled,true);
  releaseScan();
  await waitFor(()=>finished && root.querySelector('.ex-scan-status').dataset.state==='done',
    'the active scan has fully completed');
  clickByLabel(root,'页面选项');
  const freshSelect=Menu.last.items.find(item=>item.title==='批量选择');
  assert.equal(freshSelect.disabled,false);
  freshSelect.handler();
  assert.equal(root.querySelector('.excerpts-root').classList.contains('ex-is-selecting'),true);
  root.querySelector('.ex-select-done').click();
  await t.close();
});

test('manual refresh updates stale index without external auto-rescan',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  const next=await t.plugin.app.vault.create('摘录/新增.md','新内容');
  t.plugin.onFileChange(next.path);
  await wait();
  assert.equal(root.querySelector('.ex-scan-text').textContent,'待刷新 · 1 条');
  clickByLabel(root,'页面选项');
  const refresh=Menu.last.items.find(item=>item.title==='刷新摘录');
  assert.ok(refresh);
  assert.equal(refresh.disabled,false);
  refresh.handler();await waitForIndex(t,2);
  assert.equal(root.querySelector('.ex-scan-text').textContent,'已扫描 · 2 条');
  assert.equal(root.querySelectorAll('.ex-card').length,2);
  await t.close();
});

test('batch scan reports real progress and cancels before the next batch',async()=>{
  const t=await fixture();
  for(let i=0;i<90;i++)await t.plugin.app.vault.create('摘录/扫描-'+i+'.md','正文');
  let stop=false;const history=[];
  const result=await t.plugin.repo.scan(t.plugin.workspaceForHome(t.home),32,(done,total)=>{
    history.push([done,total]);if(done>=32)stop=true;
  },()=>stop);
  assert.equal(result,null);
  assert.deepEqual(history.slice(0,2),[[0,91],[32,91]]);
  const steps=[];
  const all=await t.plugin.repo.scan(t.plugin.workspaceForHome(t.home),32,
    (done,total)=>steps.push([done,total]),()=>false);
  assert.equal(all.length,91);
  assert.deepEqual(steps,[[0,91],[32,91],[64,91],[91,91]]);
  await t.close();
});

test('scan indicator shows real running state and settles without progress',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  const original=t.plugin.repo.scan.bind(t.plugin.repo);
  t.plugin.repo.scan=async(ws,batch,onProgress,cancelled)=>{
    onProgress(0,100);
    await new Promise(resolve=>setTimeout(resolve,320));
    return cancelled()?null:original(ws,batch,onProgress,cancelled);
  };
  t.plugin.refreshViews(true);
  const status=root.querySelector('.ex-scan-status');
  await waitFor(()=>status.dataset.state==='scanning','visible scanning state');
  assert.equal(status.dataset.state,'scanning');
  assert.equal(root.querySelector('.ex-scan-progress').hidden,false);
  assert.match(root.querySelector('.ex-scan-text').textContent,/扫描中/);
  assert.equal(root.querySelector('.ex-scan-progress').getAttribute('aria-valuenow'),'0');
  clickByLabel(root,'页面选项');
  assert.equal(Menu.last.items.find(item=>item.title==='刷新摘录').disabled,true);
  await waitFor(()=>status.dataset.state==='done','scan completion');
  assert.equal(status.dataset.state,'done');
  assert.equal(root.querySelector('.ex-scan-progress').hidden,true);
  await t.close();
});

test('scan failure leaves previous cards visible and enables retry',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  t.plugin.repo.scan=async()=>{throw Error('test scan error');};
  t.plugin.refreshViews(true);
  await waitFor(()=>root.querySelector('.ex-scan-status').dataset.state==='error','scan failure');
  assert.equal(root.querySelector('.ex-scan-status').dataset.state,'error');
  assert.equal(root.querySelector('.ex-scan-text').textContent,'扫描失败');
  assert.equal(root.querySelectorAll('.ex-card').length,1);
  clickByLabel(root,'页面选项');
  assert.equal(Menu.last.items.find(item=>item.title==='刷新摘录').disabled,false);
  await t.close();
});

test('search blocks refresh until the user explicitly clears the query',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  let scans=0;const scan=t.plugin.repo.scan.bind(t.plugin.repo);
  t.plugin.repo.scan=async(...args)=>{scans++;return scan(...args);};
  clickByLabel(root,'搜索');
  const input=root.querySelector('.ex-search');
  input.value='测试';
  input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  t.plugin.refreshViews(true);
  assert.equal(scans,0,'refresh is refused while search is active');
  assert.equal(root.querySelector('.ex-search').disabled,true);
  clickByLabel(root,'搜索');
  assert.equal(root.querySelector('.ex-search').value,'');
  t.plugin.refreshViews(true);
  await waitFor(()=>scans===1,'user explicitly refreshes after clearing query');
  await t.close();
});

test('moving a homepage folder invalidates the old view and preserves a copyable draft',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  const renderer=[...t.plugin.rendered][0];
  const text=root.querySelector('.ex-compose-text');
  text.value='尚未保存的草稿';
  text.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  let scans=0;const original=t.plugin.repo.scan.bind(t.plugin.repo);
  t.plugin.repo.scan=async(...args)=>{scans++;return original(...args);};
  const oldWorkspace={...renderer.workspace};
  clickByLabel(root,'页面选项');
  const previousRefresh=Menu.last.items.find(item=>item.title==='刷新摘录');
  assert.equal(previousRefresh.disabled,false);

  // Obsidian mutates paths in place before emitting a folder rename.
  const folder=t.files.get('摘录').file;
  t.files.delete('摘录');folder.path='收藏';t.files.set('收藏',{file:folder});
  for (const oldPath of ['摘录/首页.excerpts','摘录/测试.md']){
    const record=t.files.get(oldPath),newPath=oldPath.replace('摘录/','收藏/');
    t.files.delete(oldPath);
    record.file.path=newPath;record.file.parent={path:'收藏'};
    t.files.set(newPath,record);
  }
  t.vaultEvents.get('rename')(folder,'摘录');
  assert.equal(renderer.homeInvalid,true);
  assert.deepEqual(renderer.workspace,oldWorkspace,'runtime path must not silently migrate');
  assert.equal(root.querySelector('.ex-scan-status').dataset.state,'invalid');
  assert.equal(root.querySelector('.ex-scan-text').textContent,'页面已失效 · 请重新打开');
  assert.match(root.querySelector('.ex-scan-status').title,/复制未保存的草稿/);
  assert.equal(text.value,'尚未保存的草稿');
  assert.equal(text.disabled,false,'allow draft selection and copy');
  assert.equal(root.querySelector('.ex-compose-actions .ex-btn-primary').disabled,true);
  assert.equal(root.querySelector('.ex-open-editor').disabled,true);
  assert.equal(root.querySelector('.ex-search').disabled,true);
  previousRefresh.handler();
  t.plugin.refreshViews(true);
  assert.equal(scans,0,'neither stale menus nor commands can scan an invalid page');
  clickByLabel(root,'页面选项');
  assert.equal(Menu.last.items.find(item=>item.title==='刷新摘录').disabled,true);
  assert.equal(Menu.last.items.find(item=>item.title==='批量选择').disabled,true);
  root.querySelector('.ex-compose-actions .ex-btn-primary').click();
  assert.equal(t.files.has('摘录/尚未保存的草稿.md'),false);
  assert.equal(t.files.has('收藏/尚未保存的草稿.md'),false);
  assert.match(Notice.last,/重新打开/);

  // Only explicitly reopening the relocated file creates a valid new renderer.
  await t.pane.openFile(t.files.get('收藏/首页.excerpts').file);
  await waitFor(()=>t.pane.contentEl.querySelector('.ex-scan-status')?.dataset.state==='done',
    'new home view indexed');
  assert.equal([...t.plugin.rendered][0].homeInvalid,false);
  assert.equal([...t.plugin.rendered][0].workspace.homePath,'收藏/首页.excerpts');
  await t.close();
});

test('renamed saved excerpt pages become read-only until explicitly reopened',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  const saved=await t.plugin.createSavedPage(t.home.path,'文学摘录',{tag:'哲学',query:''});
  await t.pane.openFile(saved);
  await waitFor(()=>root.querySelector('.ex-title')?.textContent==='文学摘录','saved page opened');
  const composer=root.querySelector('.ex-compose-text');
  composer.value='保留的草稿';
  composer.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  const renderer=[...t.plugin.rendered][0],oldPath=saved.path;
  t.files.delete(oldPath);saved.path='摘录/句子摘录.excerpts';saved.basename='句子摘录';
  t.files.set(saved.path,{file:saved,data:'version: 1\nfilter:\n  tag: "哲学"\n  query: ""'});
  t.vaultEvents.get('rename')(saved,oldPath);
  assert.equal(renderer.homeInvalid,true);
  assert.equal(renderer.workspace.homePath,oldPath,'do not migrate old view scope');
  assert.equal(root.querySelector('.ex-title').textContent,'文学摘录','old title remains');
  assert.equal(root.querySelector('.ex-compose-text'),composer);
  assert.equal(composer.value,'保留的草稿');
  assert.equal(root.querySelector('.ex-scan-status').dataset.state,'invalid');
  assert.equal(root.querySelector('.ex-open-editor').disabled,true);
  await t.pane.openFile(saved);
  await waitFor(()=>t.pane.contentEl.querySelector('.ex-title')?.textContent==='句子摘录',
    'explicitly reopened renamed view');
  assert.equal([...t.plugin.rendered][0].homeInvalid,false);
  await t.close();
});

test('a save-filter dialog opened before home relocation cannot write after invalidation',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  clickByLabel(root,'筛选标签');
  [...root.querySelectorAll('.ex-filter-tags button')].find(el=>el.textContent==='#哲学').click();
  clickByLabel(root,'页面选项');
  Menu.last.items.find(el=>el.title==='保存当前筛选…').handler();
  const dialog=document.querySelector('.ex-save-page-modal');
  assert.ok(dialog);
  assert.equal(dialog.querySelector('.ex-save-page-submit').disabled,false);
  const originalPath=t.home.path;
  t.files.delete(originalPath);
  t.home.path='摘录/改名首页.excerpts';t.home.basename='改名首页';
  t.files.set(t.home.path,{file:t.home,data:''});
  t.vaultEvents.get('rename')(t.home,originalPath);
  dialog.querySelector('.ex-save-page-submit').click();
  assert.match(dialog.querySelector('.ex-save-page-hint').textContent,/重新打开/);
  assert.equal(dialog.querySelector('.ex-save-page-submit').disabled,true);
  assert.equal(t.files.has('摘录/哲学摘录.excerpts'),false,
    'a stale modal must not write a new saved page');
  await t.close();
});

test('an in-flight scan is cancelled when its source .excerpts page is moved',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  const renderer=[...t.plugin.rendered][0];
  const realScan=t.plugin.repo.scan.bind(t.plugin.repo);
  let release,checkedCancel;
  t.plugin.repo.scan=async(ws,batch,onProgress,cancel)=>{
    checkedCancel=cancel;
    await new Promise(resolve=>{release=resolve;});
    return realScan(ws,batch,onProgress,cancel);
  };
  t.plugin.refreshViews(true);
  await waitFor(()=>typeof release==='function','scan started');
  assert.equal(renderer.scanStatus,'scanning');
  const prior=t.home.path;
  t.files.delete(prior);t.home.path='摘录/另一首页.excerpts';
  t.files.set(t.home.path,{file:t.home,data:''});
  t.vaultEvents.get('rename')(t.home,prior);
  assert.equal(checkedCancel(),true);
  release();
  await waitFor(()=>renderer.homeInvalid && root.querySelector('.ex-scan-status').dataset.state==='invalid',
    'invalid view stays blocked');
  assert.equal(root.querySelectorAll('.ex-card').length,1,'old cards remain readable');
  t.plugin.refreshViews(true);
  assert.equal(renderer.scanStatus,'stale','cancelled scan cannot revive the old view');
  await t.close();
});

test('deleting a homepage or its parent invalidates the open view and clears its default pointer',async()=>{
  for(const deleted of ['home','parent']){
    const t=await fixture();
    const renderer=[...t.plugin.rendered][0];
    t.plugin.settings.defaultHome=t.home.path;
    const removed=deleted==='home' ? t.home : t.files.get('摘录').file;
    t.files.delete(removed.path);
    t.vaultEvents.get('delete')(removed);
    assert.equal(renderer.homeInvalid,true);
    assert.equal(renderer.workspace.homePath,'摘录/首页.excerpts');
    assert.equal(t.plugin.settings.defaultHome,'');
    assert.equal(t.pane.contentEl.querySelector('.ex-scan-status').dataset.state,'invalid');
    await t.close();
  }
});

test('saving and native editor opening do not trigger an index scan',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  let scans=0;const scan=t.plugin.repo.scan.bind(t.plugin.repo);
  t.plugin.repo.scan=async(...args)=>{scans++;return scan(...args);};
  const textarea=root.querySelector('.ex-compose-text');
  textarea.value='# 立即编辑';
  textarea.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  clickByLabel(root,'编辑文档');
  await waitFor(()=>t.leaf.lastFile?.basename==='立即编辑','native editor opens without scan');
  assert.equal(textarea.disabled,false);
  assert.equal(textarea.value,'');
  assert.equal(scans,0);
  assert.equal(root.querySelector('.ex-scan-status').dataset.state,'stale');
  await t.close();
});

test('selection denies configuration-triggered refresh rather than deferring it',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  const renderer=[...t.plugin.rendered][0];
  clickByLabel(root,'页面选项');Menu.last.items.find(item=>item.title==='批量选择').handler();
  const before=renderer.workspace.recursive;
  t.plugin.refreshViews(true);
  assert.equal(renderer.workspace.recursive,before);
  assert.equal(renderer.scanStatus,'done');
  root.querySelector('.ex-select-done').click();
  assert.equal(renderer.scanStatus,'done');
  await t.close();
});

test('scan yields to the main thread across ten thousand metadata entries',async()=>{
  const t=await fixture();
  for(let i=0;i<10000;i++){
    const path='摘录/压力-'+i+'.md';
    const file=new TFile(path);
    t.files.set(path,{file,data:'x'});
  }
  let progressed=0, yielded=false;
  const scan=t.plugin.repo.scan(t.plugin.workspaceForHome(t.home),64,(done,total)=>{
    progressed=done;
    assert.equal(total,10001);
    if(done===64)setTimeout(()=>{yielded=true;},0);
    if(done>=128)assert.equal(yielded,true,'the first 64-file batch must yield');
  },()=>false);
  const result=await scan;
  assert.equal(result.length,10001);
  assert.equal(progressed,10001);
  await t.close();
});

test('tag edits reject refresh and save once, without deferred work',async()=>{
  const t=await fixture();const root=t.pane.contentEl, card=root.querySelector('.ex-card');
  card.querySelector('.ex-add-tag').click();
  const input=card.querySelector('.ex-tag-custom');
  input.value='暂存标签';
  input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  let scans=0;const scan=t.plugin.repo.scan.bind(t.plugin.repo);
  t.plugin.repo.scan=async(...args)=>{scans++;return scan(...args);};
  t.plugin.refreshViews(true);
  assert.equal(scans,0);
  card.querySelector('.ex-tag-done').click();
  await waitFor(()=>t.getTagWrites()===1 &&
    root.querySelector('.ex-scan-status').dataset.state==='stale','single tag write and stale state');
  assert.equal(scans,0);
  assert.equal(root.querySelector('.ex-scan-status').dataset.state,'stale');
  assert.deepEqual(t.tagState.get(t.md.path),['哲学','暂存标签']);
  await t.close();
});


test('scan locks save and search inputs without discarding the composer draft',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  const scan=t.plugin.repo.scan.bind(t.plugin.repo);
  let release, scans=0;
  t.plugin.repo.scan=async(...args)=>{
    scans++;
    await new Promise(resolve=>{release=resolve;});
    return scan(...args);
  };
  const textarea=root.querySelector('.ex-compose-text');
  textarea.value='尚未保存的草稿';
  textarea.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  t.plugin.refreshViews(true);
  assert.equal(root.querySelector('.ex-search').disabled,true);
  assert.equal(root.querySelector('.ex-compose-actions .ex-btn-primary').disabled,true);
  assert.equal(root.querySelector('.ex-filter-tags').hidden,true);
  assert.equal(root.querySelector('.ex-compose-text').disabled,false);
  t.plugin.refreshViews(true);
  assert.equal(scans,1,'repeat scan is rejected, not queued');
  root.querySelector('.ex-compose-actions .ex-btn-primary').click();
  assert.equal(t.files.size,3,'disabled save cannot create Markdown');
  assert.equal(textarea.value,'尚未保存的草稿');
  release();
  const renderer=[...t.plugin.rendered][0];
  const button=root.querySelector('.ex-compose-actions .ex-btn-primary');
  await waitFor(()=>renderer.scanStatus==='done' && !button.disabled,
    'actual scan finishes and save re-enables');
  assert.equal(button.disabled,false);
  assert.equal(scans,1);
  await t.close();
});

test('external file change marks stale but never auto scans',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  const next=await t.plugin.app.vault.create('摘录/新卡片.md','内容');
  const scan=t.plugin.repo.scan.bind(t.plugin.repo);
  let scans=0;t.plugin.repo.scan=async(...args)=>{scans++;return scan(...args);};
  t.plugin.onFileChange(next.path);
  assert.equal(root.querySelector('.ex-scan-status').dataset.state,'stale');
  assert.equal(root.querySelector('.ex-scan-text').textContent,'待刷新 · 1 条');
  assert.equal(root.querySelectorAll('.ex-card').length,1);
  clickByLabel(root,'页面选项');
  assert.equal(Menu.last.items.find(item=>item.title==='批量选择').disabled,true);
  assert.equal(root.querySelector('.ex-search').disabled,true);
  assert.equal(scans,0);
  Menu.last.items.find(item=>item.title==='刷新摘录').handler();
  await waitForIndex(t,2);
  assert.equal(scans,1);
  await t.close();
});

test('only one card can edit its tags and a blocked refresh never replays',async()=>{
  const t=await fixture();
  await t.plugin.app.vault.create('摘录/第二.md','第二条');
  t.plugin.refreshViews(true);await waitForIndex(t,2);
  const root=t.pane.contentEl;
  const cards=[...root.querySelectorAll('.ex-card')];
  cards[0].querySelector('.ex-add-tag').click();
  assert.equal(cards[1].querySelector('.ex-add-tag').disabled,true);
  const renderer=[...t.plugin.rendered][0];
  let scans=0;const scan=t.plugin.repo.scan.bind(t.plugin.repo);
  t.plugin.repo.scan=async(...args)=>{scans++;return scan(...args);};
  t.plugin.refreshViews(true);
  assert.equal(scans,0);
  cards[0].querySelector('.ex-tag-cancel').click();
  assert.equal(cards[1].querySelector('.ex-add-tag').disabled,false);
  assert.equal(scans,0,'no delayed refresh after closing tag editor');
  assert.equal(renderer.scanStatus,'done');
  await t.close();
});

test('moving an entire nested folder marks the index stale without rescanning',async()=>{
  const t=await fixture();
  await t.plugin.app.vault.createFolder('摘录/子目录');
  const nested=await t.plugin.app.vault.create('摘录/子目录/笔记.md','子目录内容');
  t.plugin.refreshViews(true);await waitForIndex(t,2);
  const folder=t.files.get('摘录/子目录').file;
  t.files.delete('摘录/子目录');folder.path='摘录/重命名';t.files.set(folder.path,{file:folder});
  t.files.delete(nested.path);
  nested.path='摘录/重命名/笔记.md';
  nested.parent={path:'摘录/重命名'};
  t.files.set(nested.path,{file:nested,data:'子目录内容'});
  let scans=0;const original=t.plugin.repo.scan.bind(t.plugin.repo);
  t.plugin.repo.scan=async(...args)=>{scans++;return original(...args);};
  t.vaultEvents.get('rename')(folder,'摘录/子目录');
  const root=t.pane.contentEl;
  assert.equal(root.querySelector('.ex-scan-status').dataset.state,'stale');
  assert.equal(scans,0,'folder rename may not launch a scan');
  t.plugin.refreshViews(true);
  await waitFor(()=>[...root.querySelectorAll('.ex-card')].some(el=>el.dataset.path===nested.path),
    'renamed child appears after the manual scan completes');
  assert.equal(scans,1);
  await t.close();
});
