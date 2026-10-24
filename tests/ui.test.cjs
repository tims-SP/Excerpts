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
HTMLElement.prototype.createEl=function(tag,{text}={}){const el=document.createElement(tag);if(text)el.textContent=text;this.append(el);return el;};
class TAbstractFile {constructor(path){this.path=path;}}
class TFile extends TAbstractFile {constructor(path){super(path);const leaf=path.split('/').pop();this.basename=leaf.replace(/\.[^.]+$/,'');this.extension=leaf.split('.').pop();this.stat={mtime:200,ctime:100,size:128};this.parent={path:path.split('/').slice(0,-1).join('/') || '/'};}}
class TFolder extends TAbstractFile{}
class MarkdownRenderChild {constructor(el){this.containerEl=el;this.children=[];}addChild(c){this.children.push(c);}removeChild(c){this.children=this.children.filter(x=>x!==c);}load(){this.onload?.();}unload(){this.onunload?.();}}
class ItemView {constructor(){this.contentEl=document.createElement('div');}async setState(){}}
class FileView extends ItemView {constructor(){super();this.file=null;}async openFile(f){this.file=f;await this.onLoadFile?.(f);}}
class MarkdownView {constructor(){this.mode='preview';this.editor={cursor:null,scrolled:null,focused:false,lastLine(){return 0;},getLine(){return '';},setCursor(pos){this.cursor=pos;},scrollIntoView(range,center){this.scrolled={range,center};},focus(){this.focused=true;}};}getMode(){return this.mode;}}
class Plugin {async loadData(){return null;}async saveData(){}registerView(kind,factory){(this.factories??={})[kind]=factory;if(kind==='excerpts-home-file')this.factory=factory;}registerExtensions(exts,type){this.extensions={exts,type};}addSettingTab(){}addCommand(command){(this.commands??=[]).push(command);}registerEvent(){}addRibbonIcon(icon,title,action){this.ribbon={icon,title,action};}}
class PluginSettingTab {constructor(){this.containerEl=document.createElement('div');}}
class Setting {
  static instances=[];
  constructor(root){this.root=root;Setting.instances.push(this);}
  setName(name){this.name=name;return this;}
  setDesc(desc){this.desc=desc;return this;}
  addText(fn){const item={setPlaceholder(value){this.placeholder=value;return this;},onChange(handler){this.handler=handler;return this;}};fn(item);this.text=item;return this;}
  addButton(fn){const item={disabled:false,setCta(){return this;},setButtonText(value){this.text=value;return this;},setDisabled(value){this.disabled=value;return this;},onClick(handler){this.handler=handler;return this;}};fn(item);this.button=item;return this;}
  addToggle(fn){const item={disabled:false,setValue(value){this.value=value;return this;},setDisabled(value){this.disabled=value;return this;},onChange(handler){this.handler=handler;return this;}};fn(item);this.toggle=item;return this;}
  addDropdown(fn){const item={disabled:false,options:{},addOption(key,value){this.options[key]=value;return this;},setValue(value){this.value=value;return this;},setDisabled(value){this.disabled=value;return this;},onChange(handler){this.handler=handler;return this;}};fn(item);this.dropdown=item;return this;}
}
class Notice {constructor(message){Notice.last=message;}}
class Menu {constructor(){this.items=[];}addItem(fn){const item={setTitle(title){this.title=title;return this;},setIcon(icon){this.icon=icon;return this;},setDisabled(value){this.disabled=value;return this;},setWarning(){this.warning=true;return this;},onClick(handler){this.handler=handler;return this;}};fn(item);this.items.push(item);}addSeparator(){}showAtPosition(){Menu.last=this;}}
class Modal {
  constructor(){this.modalEl=document.createElement('section');this.contentEl=document.createElement('div');this.modalEl.append(this.contentEl);}
  open(){document.body.append(this.modalEl);this.onOpen?.();Modal.last=this;return this;}
  close(){this.onClose?.();this.modalEl.remove();}
}
const renders=[];
const mocks={TAbstractFile,TFile,TFolder,MarkdownRenderChild,ItemView,FileView,MarkdownView,Plugin,PluginSettingTab,Setting,Notice,Menu,Modal,
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
  const workspaceEvents=new Map();
  const folderLeaves=[];
  const vault={getAbstractFileByPath(path){return files.get(path)?.file??null;},getFiles(){return [...files.values()].filter(x=>x.file instanceof TFile).map(x=>x.file);},getAllLoadedFiles(){return [...files.values()].map(x=>x.file);},getMarkdownFiles(){return this.getFiles().filter(x=>x.extension==='md');},
    async cachedRead(file){return files.get(file.path).data;},async read(file){return files.get(file.path).data;},
    async process(file,update){const entry=files.get(file.path);entry.data=update(entry.data);file.stat.mtime++;file.stat.size=entry.data.length;return entry.data;},async createFolder(path){files.set(path,{file:new TFolder(path)});},async create(path,content){if(files.has(path))throw Error('exists');const f=new TFile(path);files.set(path,{file:f,data:content});return f;},on(name,handler){vaultEvents.set(name,handler);return {};}};
  const plugin=new Excerpts();
  const leaf={lastFile:null,view:null,async openFile(file){this.lastFile=file;this.view=new MarkdownView();this.view.file=file;},async setViewState(state){
    this.state=state;
    if(!this.view)this.view=new MarkdownView();
    this.view.mode=state.state.mode;
    this.view.file=vault.getAbstractFileByPath(state.state.file);
  }};
  plugin.app={vault,metadataCache:{getFileCache(f){return {
    tags:f.path===md.path?inlineTags.map(tag=>({tag:'#'+tag})):[],
    frontmatter:{tags:tagState.get(f.path)||[]}
  };},on(){return {};}}
    ,fileManager:{async trashFile(f){files.delete(f.path);},async processFrontMatter(f,fn){
      const fm={tags:[...(tagState.get(f.path)||[])]};
      fn(fm);
      tagState.set(f.path,fm.tags||[]);
      tagWrites++;
    }},workspace:{getLeaf(){return leaf;},getLeavesOfType(type){return type==='excerpts-folder'?folderLeaves:leaf.view instanceof MarkdownView?[leaf]:[];},
      on(name,handler){workspaceEvents.set(name,handler);return {};},async revealLeaf(){}}};
  await plugin.onload();
  const pane=plugin.factory({});document.body.append(pane.contentEl);
  await pane.openFile(home);
  await waitFor(()=>pane.contentEl.querySelector('.ex-scan-text')?.textContent==='已扫描 · 1 条' &&
    pane.contentEl.querySelectorAll('.ex-card').length===1 &&
    !pane.contentEl.querySelector('.ex-card-loading'),'initial index and card hydration');
  return {files,plugin,pane,leaf,md,home,tagState,vaultEvents,workspaceEvents,folderLeaves,
    getTagWrites:()=>tagWrites,async close(){
    await pane.onUnloadFile(home);pane.contentEl.remove();
    document.querySelectorAll('.ex-delete-modal,.ex-save-page-modal').forEach(el=>el.remove());
  }};
}

test('opening .excerpts displays an editorial date-group feed and always-visible composer',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  assert.equal(t.plugin.extensions.type,'excerpts-home-file');
  assert.deepEqual(Object.keys(t.plugin.settings).sort(),['defaultHome','listBatchMode','listBatchSize','recursive','scanBatchSize']);
  assert.equal(t.plugin.settings.scanBatchSize,64);
  assert.equal(t.plugin.settings.listBatchMode,'auto');
  assert.equal(t.plugin.settings.listBatchSize,32);
  assert.equal(root.querySelector('.ex-scan-status').dataset.state,'done');
  assert.equal(root.querySelector('.ex-scan-text').textContent,'已扫描 · 1 条');
  assert.equal(t.pane.getDisplayText(),'首页');
  assert.ok(root.querySelector('.ex-composer .ex-compose-text'));
  assert.ok(root.querySelector('.ex-list-heading').textContent.includes('最近摘录'));
  assert.equal(root.querySelector('.ex-search-wrap').hidden,true);
  assert.equal(root.querySelector('.ex-filter-tags').hidden,true);
  assert.equal(root.querySelectorAll('.ex-card').length,1);
  assert.equal(root.querySelector('.ex-card').classList.contains('ex-card-loading'),false);
  assert.equal(root.querySelectorAll('.ex-virtual-row').length,1);
  assert.equal(root.querySelectorAll('.ex-day-rail .ex-day-title').length,1);
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
  assert.deepEqual(menu.items.map(x=>x.title),['阅读原文','编辑原文','编辑分组：来源','编辑分组：批注','删除摘录']);
  menu.items.find(item=>item.title==='编辑原文').handler();await wait();
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

test('reading original opens native Markdown preview without focusing editor',async()=>{
  const t=await fixture();
  clickByLabel(t.pane.contentEl,'卡片选项');await wait();
  const read=Menu.last.items.find(item=>item.title==='阅读原文');
  assert.ok(read);
  read.handler();await wait();
  assert.equal(t.leaf.state.state.mode,'preview');
  assert.equal(t.leaf.state.state.file,t.md.path);
  assert.equal(t.leaf.view.getMode(),'preview');
  assert.equal(t.leaf.view.editor.focused,false,'preview must not open the soft keyboard');
  await t.close();
});



test('list prefetch settings switch between viewport auto and fixed batches',async()=>{
  const t=await fixture();
  const tab=t.plugin.settingsTab;
  const before=Setting.instances.length;
  tab.display();
  const settings=Setting.instances.slice(before);
  const mode=settings.find(setting=>setting.name==='预取批次');
  const fixed=settings.find(setting=>setting.name==='固定批次大小');
  assert.ok(mode?.dropdown);
  assert.ok(fixed?.dropdown);
  assert.equal(fixed.root.hidden,true);
  await mode.dropdown.handler('fixed');
  assert.equal(t.plugin.settings.listBatchMode,'fixed');
  assert.equal(fixed.root.hidden,false);
  await fixed.dropdown.handler('96');
  assert.equal(t.plugin.settings.listBatchSize,96);
  await mode.dropdown.handler('auto');
  assert.equal(t.plugin.settings.listBatchMode,'auto');
  assert.equal(fixed.root.hidden,true);
  await t.close();
});

test('large native Markdown and excessive H2 groups require the reading view',async()=>{
  const huge=await fixture(false,'长文'.repeat(30000));
  const card=huge.pane.contentEl.querySelector('.ex-card');
  assert.equal(card.querySelector('.ex-expand-body').dataset.action,'read');
  assert.match(card.textContent,/正文过长/);
  assert.equal(renders.some(x=>x.path===huge.md.path&&x.content.length>50000),false,
    'oversized Markdown is never rendered into the scrolling feed');
  card.querySelector('.ex-expand-body').click();
  await wait();
  assert.equal(huge.leaf.state.state.mode,'preview');
  await huge.close();
  const groups=Array.from({length:25},(_,i)=>'## 分组'+i+'\\n内容').join('\\n\\n').replace(/\\n/g,'\n');
  const many=await fixture(false,groups);
  const section=many.pane.contentEl.querySelector('.ex-extras');
  assert.equal(section.querySelectorAll('.ex-group-trigger').length,0);
  assert.match(section.textContent,/25 个分组/);
  assert.equal(section.querySelector('.ex-group-read').hidden,false);
  await many.close();
});

test('unfinished tag edits block virtual-row recycling instead of losing the input',async()=>{
  const t=await fixture();
  for(let i=0;i<100;i++) await t.plugin.app.vault.create('摘录/卡片-'+i+'.md','短摘录');
  t.plugin.refreshViews(true);await waitForIndex(t);
  const root=t.pane.contentEl,list=root.querySelector('.ex-card-list');
  list.getBoundingClientRect=()=>({top:-root.scrollTop,left:0,width:700,height:0});
  Object.defineProperty(root,'clientHeight',{configurable:true,value:800});
  const card=root.querySelector('.ex-card'),start=root.scrollTop;
  card.querySelector('.ex-add-tag').click();
  const input=card.querySelector('.ex-tag-custom');
  assert.ok(input);
  root.scrollTop=12000;
  root.dispatchEvent(new dom.window.Event('scroll'));
  await waitFor(()=>root.scrollTop===start,'edited card stays anchored');
  assert.equal(card.isConnected,true);
  assert.equal(card.querySelector('.ex-tag-custom'),input);
  card.querySelector('.ex-tag-cancel').click();
  await t.close();
});

test('bounded full-text search cache avoids rereading older excerpts',async()=>{
  const t=await fixture();
  for(let i=0;i<75;i++)await t.plugin.app.vault.create('摘录/全文-'+i+'.md','单独的正文 '+i);
  const cards=await t.plugin.repo.scan(t.plugin.workspaceForHome(t.home),64,()=>{},()=>false);
  const original=t.plugin.app.vault.cachedRead.bind(t.plugin.app.vault);
  let reads=0;
  t.plugin.app.vault.cachedRead=async file=>{reads++;return original(file);};
  await t.plugin.repo.search(cards,'不存在的短语',()=>false);
  const first=reads;
  assert.ok(first>=75);
  await t.plugin.repo.search(cards,'另一个不存在的短语',()=>false);
  assert.equal(reads,first,'second search uses the bounded normalized text cache');
  t.plugin.repo.invalidate(t.md.path);
  await t.plugin.repo.search(cards,'第三个不存在的短语',()=>false);
  assert.equal(reads,first+1,'a modified file invalidates only its own cached search text');
  await t.close();
});


test('oversized H2 files never create hundreds of per-section menu actions',async()=>{
  for(const count of [24,25,300]){
    const markdown='# 标题\n\n正文\n\n'+Array.from({length:count},(_,i)=>
      '## 分组'+i+'\n\n第'+i+'段内容').join('\n\n');
    const t=await fixture(false,markdown);
    clickByLabel(t.pane.contentEl,'卡片选项');
    await waitFor(()=>Menu.last?.items?.some(item=>item.title==='删除摘录'),
      'H2 options menu '+count);
    const names=Menu.last.items.map(item=>item.title);
    const sectionOptions=names.filter(name=>name.startsWith('编辑分组：'));
    assert.equal(sectionOptions.length,count<=24?count:0,
      'per-section menu matches the card disclosure limit');
    assert.deepEqual(names.slice(0,2),['阅读原文','编辑原文']);
    assert.equal(names.at(-1),'删除摘录');
    await t.close();
  }
});

test('H2 menu targets the correct source line including repeated section names',async()=>{
  const source='---\ntags: [文学]\n---\n\n# 标题\n\n```md\n## 不是分组\n```\n\n## 来源\n甲\n\n## 来源\n乙';
  const t=await fixture(false,source);const root=t.pane.contentEl;
  clickByLabel(root,'卡片选项');await wait();
  const menu=Menu.last;
  assert.deepEqual(menu.items.map(x=>x.title),
    ['阅读原文','编辑原文','编辑分组：来源（第 1 个）','编辑分组：来源（第 2 个）','删除摘录']);
  menu.items.find(item=>item.title==='编辑分组：来源（第 2 个）').handler();await wait();
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
  assert.match(card.querySelector('.ex-tag-inline-hint').textContent,/先结束标签编辑/);
  assert.equal(card.querySelector('.ex-tag-source'),null,'no unusable edit link inside staged tag editing');
  card.querySelector('.ex-tag-cancel').click();
  assert.equal(t.getTagWrites(),0);
  Menu.last=null;
  clickByLabel(t.pane.contentEl,'卡片选项');
  await waitFor(()=>Menu.last?.items?.some(item=>item.title==='编辑原文'),'native edit from card options');
  Menu.last.items.find(item=>item.title==='编辑原文').handler();
  await waitFor(()=>t.leaf.lastFile===t.md,'source opens after tag editor closes');
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

test('virtual timeline keeps a single date rail and recycles offscreen cards',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  for(let i=0;i<84;i++){
    const file=new TFile('摘录/样例-'+String(i).padStart(3,'0')+'.md');
    file.stat.ctime=100-i*86400000;
    t.files.set(file.path,{file,data:'第 '+i+' 段文字'});
  }
  const list=root.querySelector('.ex-card-list');
  list.getBoundingClientRect=()=>({top:-t.pane.contentEl.scrollTop,left:0,bottom:0,right:0,width:720,height:0});
  Object.defineProperty(t.pane.contentEl,'clientHeight',{configurable:true,value:800});
  t.pane.renderer.requestRefresh(true);
  await waitForIndex(t,85);
  const initial=root.querySelectorAll('.ex-card').length;
  assert.ok(initial>0&&initial<=96,'initial virtual DOM count is bounded');
  assert.equal(root.querySelectorAll('.ex-loadmore').length,0);
  assert.ok(root.querySelector('.ex-virtual-top-spacer'));
  assert.ok(root.querySelector('.ex-virtual-bottom-spacer'));
  const first=root.querySelector('.ex-card');
  t.pane.contentEl.scrollTop=9500;
  t.pane.contentEl.dispatchEvent(new dom.window.Event('scroll'));
  await waitFor(()=>!first.isConnected,'first card recycled');
  assert.ok(root.querySelectorAll('.ex-card').length<=96);
  assert.ok(parseFloat(root.querySelector('.ex-virtual-top-spacer').style.height)>0);
  t.pane.contentEl.scrollTop=0;
  t.pane.contentEl.dispatchEvent(new dom.window.Event('scroll'));
  await waitFor(()=>root.querySelector('.ex-card')?.dataset.path===first.dataset.path,'first card restored');
  const rails=[...root.querySelectorAll('.ex-day-rail .ex-day-title')];
  assert.equal(rails.length,new Set(rails.map(x=>x.textContent)).size,'no duplicate visible day rails');
  await t.close();
});


test('render failures offer native reading without inventing truncated Markdown',async()=>{
  const original=mocks.MarkdownRenderer.render;
  mocks.MarkdownRenderer.render=async (app,content,target,path)=>{
    if(content.includes('故障'))throw new Error('synthetic render failure');
    return original(app,content,target,path);
  };
  try{
    const t=await fixture(false,'# 标题\n\n故障');
    const card=t.pane.contentEl.querySelector('.ex-card');
    await waitFor(()=>card.querySelector('.ex-expand-body')?.dataset.action==='read','failure reading action');
    assert.match(card.textContent,/内容预览失败/);
    assert.equal(card.querySelectorAll('.ex-native-markdown').length,0,
      'partial renderer output is removed');
    card.querySelector('.ex-expand-body').click();await wait();
    assert.equal(t.leaf.state.state.mode,'preview');
    await t.close();
    const sec=await fixture(false,'# 标题\n\n正文\n\n## 来源\n\n故障分组');
    const card2=sec.pane.contentEl.querySelector('.ex-card');
    card2.querySelector('.ex-group-trigger').click();
    await waitFor(()=>card2.querySelector('.ex-preview-error')!==null,'section error');
    assert.match(card2.textContent,/分组预览失败/);
    assert.equal(card2.querySelector('.ex-group-read').hidden,false);
    await sec.close();
  }finally{mocks.MarkdownRenderer.render=original;}
});

test('mounted previews recalculate safety rules after switching viewport width',async()=>{
  const t=await fixture(false,'正文'.repeat(185));
  const card=t.pane.contentEl.querySelector('.ex-card');
  const action=card.querySelector('.ex-expand-body');
  assert.equal(action.hidden,true,'desktop 200px cap covers estimated 185px');
  Object.defineProperty(t.pane.contentEl,'clientWidth',{configurable:true,value:390});
  t.pane.renderer.previewUpdates.get(t.md.path)();
  assert.equal(action.dataset.action,'expand','mobile 160px cap requires expansion');
  assert.equal(action.hidden,false);
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
  assert.equal(root.querySelector('.ex-scan-status').dataset.state,'invalid');
  assert.match(root.querySelector('.ex-page-hint').textContent,/筛选配置已变化.*重新打开/);
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
  assert.ok(root.querySelectorAll('.ex-card').length>0 && root.querySelectorAll('.ex-card').length<=96,'virtual DOM is bounded');
  clickByLabel(root,'页面选项');Menu.last.items.find(item=>item.title==='批量选择').handler();
  root.querySelector('.ex-select-all').click();
  assert.match(root.querySelector('.ex-selection-count').textContent,/已选 86 \/ 86/);
  assert.ok(root.querySelectorAll('.ex-card').length>0 && root.querySelectorAll('.ex-card').length<=96,'virtual DOM is bounded');
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
  assert.ok(root.querySelectorAll('.ex-card').length>0 && root.querySelectorAll('.ex-card').length<=96,'virtual DOM is bounded');
  root.querySelector('.ex-select-done').click();
  assert.equal(root.querySelector('.excerpts-root').classList.contains('ex-is-selecting'),false);
  await t.close();
});

test('rapid successive search typing retains focus and only commits the latest query',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  clickByLabel(root,'搜索');
  const input=root.querySelector('.ex-search');
  let finishInitialSearch;
  const original=t.plugin.repo.search.bind(t.plugin.repo);
  const calls=[];
  t.plugin.repo.search=async(files,query,shouldCancel,progress)=>{
    calls.push(query);
    if(query==='测') await new Promise(resolve=>{finishInitialSearch=resolve;});
    return original(files,query,shouldCancel,progress);
  };
  function type(query){
    input.value=query;
    input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
    assert.equal(input.disabled,false,'each keystroke must remain available');
    assert.equal(input.value,query,'typed text must never be reverted');
  }
  type('测');
  await waitFor(()=>typeof finishInitialSearch==='function','first search started');
  type('测试');
  type('测试标');
  type('测试标题');
  assert.equal(root.querySelector('.ex-search'),input,'do not replace the input DOM');
  assert.equal(root.querySelector('.ex-filter-tags').hidden,true);
  await waitFor(()=>calls.includes('测试标题'),'latest search started');
  finishInitialSearch();
  await waitFor(()=>t.pane.contentEl.querySelector('.ex-count')?.textContent==='1 / 1',
    'latest search committed');
  assert.equal(input.value,'测试标题');
  assert.equal(input.disabled,false);
  assert.ok(root.querySelector('.ex-card'));
  await t.close();
});

test('search typing stays locked by scanning and selection, not by its own search task',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  clickByLabel(root,'搜索');
  const input=root.querySelector('.ex-search');
  input.value='测试';
  input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  assert.equal(input.disabled,false);
  assert.equal(t.plugin.rendered.size,1);
  // Search itself still prohibits destructive or scanning operations.
  clickByLabel(root,'页面选项');
  assert.equal(Menu.last.items.find(item=>item.title==='刷新摘录').disabled,true);
  assert.equal(Menu.last.items.find(item=>item.title==='批量选择').disabled,true);
  clickByLabel(root,'搜索');
  assert.equal(input.value,'');
  clickByLabel(root,'页面选项');
  Menu.last.items.find(item=>item.title==='批量选择').handler();
  assert.equal(input.disabled,true,'selection must still block searching');
  root.querySelector('.ex-select-done').click();
  assert.equal(input.disabled,false);
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
  assert.ok(root.querySelectorAll('.ex-card').length>0 &&
    root.querySelectorAll('.ex-card').length<=96,
    'normal feed stays virtualized after removing missing items');
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
  assert.equal(root.querySelector('.ex-search').disabled,false,
    'running searches must not disable the query input');
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
  const hint=root.querySelector('.ex-page-hint');
  assert.ok(hint && !hint.hidden,'invalid page warning must be readable on touch screens');
  assert.match(hint.textContent,/未保存的草稿.*先复制.*重新打开/);
  assert.equal(hint.dataset.state,'invalid');
  assert.match(root.querySelector('.ex-scan-status').title,/复制未保存的草稿|未保存的草稿.*先复制/);
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

test('opening another excerpt page during scanning requires explicit manual refresh',async()=>{
  const t=await fixture();
  const original=t.plugin.repo.scan.bind(t.plugin.repo);
  let release, scans=0;
  t.plugin.repo.scan=async(...args)=>{
    scans++;
    if(scans===1) await new Promise(resolve=>{release=resolve;});
    return original(...args);
  };
  t.plugin.refreshViews(true);
  await waitFor(()=>typeof release==='function','first page scan started');
  const first=[...t.plugin.rendered][0];
  assert.equal(first.scanStatus,'scanning');

  const secondPane=t.plugin.factory({});
  document.body.append(secondPane.contentEl);
  await secondPane.openFile(t.home);
  const second=[...t.plugin.rendered].find(renderer=>renderer!==first);
  assert.ok(second);
  const root=secondPane.contentEl;
  assert.equal(second.scanStatus,'blocked');
  assert.equal(root.querySelector('.ex-scan-status').dataset.state,'blocked');
  assert.equal(root.querySelector('.ex-scan-text').textContent,'未扫描 · 请手动刷新');
  assert.match(root.querySelector('.ex-page-hint').textContent,/其他摘录页.*手动刷新/);
  assert.equal(root.querySelector('.ex-page-hint').hidden,false);
  assert.equal(root.querySelector('.ex-page-hint').dataset.state,'blocked');
  assert.equal(root.querySelector('.ex-search').disabled,true);
  assert.equal(root.querySelector('.ex-compose-actions .ex-btn-primary').disabled,true);
  assert.equal(scans,1,'the second initial scan is rejected, never queued');

  release();
  await waitFor(()=>first.scanStatus==='done','first scan completes');
  assert.equal(scans,1,'finishing another page never replays a blocked scan');
  assert.equal(second.scanStatus,'blocked','the refusal and manual guidance persist');

  clickByLabel(root,'页面选项');
  const refresh=Menu.last.items.find(item=>item.title==='刷新摘录');
  assert.equal(refresh.disabled,false);
  assert.equal(Menu.last.items.find(item=>item.title==='批量选择').disabled,true);
  refresh.handler();
  await waitFor(()=>second.scanStatus==='done' && scans===2,'explicit second page refresh');
  assert.equal(root.querySelector('.ex-page-hint').hidden,true);
  assert.equal(root.querySelector('.ex-scan-status').dataset.state,'done');
  await secondPane.onUnloadFile(t.home);secondPane.contentEl.remove();
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

test('a blocked saved-query page can manually scan then apply its persisted search',async()=>{
  const t=await fixture();
  const saved=await t.plugin.createSavedPage(t.home.path,'检索页',{tag:'',query:'测试标题'});
  const realScan=t.plugin.repo.scan.bind(t.plugin.repo);
  let release,scans=0;
  t.plugin.repo.scan=async(...args)=>{
    scans++;
    if(scans===1)await new Promise(resolve=>{release=resolve;});
    return realScan(...args);
  };
  t.plugin.refreshViews(true);
  await waitFor(()=>typeof release==='function','first page scanning');
  const second=t.plugin.factory({});
  document.body.append(second.contentEl);
  await second.openFile(saved);
  const secondRenderer=[...t.plugin.rendered].find(c=>c.workspace.homePath===saved.path);
  assert.equal(secondRenderer.scanStatus,'blocked');
  assert.equal(second.contentEl.querySelector('.ex-search').value,'测试标题');
  release();
  await waitFor(()=>[...t.plugin.rendered].find(c=>c.workspace.homePath===t.home.path)?.scanStatus==='done',
    'first page completed');
  clickByLabel(second.contentEl,'页面选项');
  const refresh=Menu.last.items.find(i=>i.title==='刷新摘录');
  assert.equal(refresh.disabled,false,'blocked page may refresh despite persisted query');
  refresh.handler();
  await waitFor(()=>secondRenderer.scanStatus==='done' &&
    second.contentEl.querySelector('.ex-count')?.textContent==='1 / 1' &&
    second.contentEl.querySelector('.ex-card')?.dataset.path===t.md.path,'saved query resumed after manual scan');
  assert.equal(scans,2,'no background or queued scan');
  await second.onUnloadFile(saved);second.contentEl.remove();await t.close();
});

test('stale bulk selection disables deletion immediately and denies old callbacks',async()=>{
  const t=await fixture(),root=t.pane.contentEl;
  clickByLabel(root,'页面选项');Menu.last.items.find(i=>i.title==='批量选择').handler();
  root.querySelector('.ex-select-all').click();
  const renderer=[...t.plugin.rendered][0];
  assert.equal(root.querySelector('.ex-delete-selected').disabled,false);
  t.plugin.onFileChange(t.md.path);
  assert.equal(renderer.scanStatus,'stale');
  assert.equal(root.querySelector('.ex-delete-selected').disabled,true);
  assert.match(Notice.last,/退出批量选择后刷新/);
  renderer.confirmBulkDelete();
  assert.match(Notice.last,/退出批量选择后刷新/);
  assert.equal(document.querySelector('.ex-delete-modal'),null);
  root.querySelector('.ex-select-done').click();
  assert.equal(renderer.selectionMode,'normal');
  assert.equal(t.files.has(t.md.path),true);
  await t.close();
});

test('external edits to the current .excerpts invalidate the page, metadata events do not',async()=>{
  const t=await fixture();
  const saved=await t.plugin.createSavedPage(t.home.path,'独立筛选',{tag:'哲学',query:''});
  await t.pane.openFile(saved);
  const root=t.pane.contentEl,renderer=[...t.plugin.rendered][0];
  t.plugin.onFileChange(saved.path); // A metadata notification is not a content change.
  assert.equal(renderer.homeInvalid,false);
  assert.equal(renderer.scanStatus,'done');
  t.files.get(saved.path).data='version: 1\nfilter:\n  tag: ""\n  query: ""\n';
  t.vaultEvents.get('modify')(saved);
  assert.equal(renderer.homeInvalid,true);
  assert.equal(root.querySelector('.ex-scan-status').dataset.state,'invalid');
  assert.match(root.querySelector('.ex-page-hint').textContent,/筛选配置已变化/);
  assert.equal(root.querySelector('.ex-compose-actions .ex-btn-primary').disabled,true);
  assert.equal(root.querySelector('.ex-search').disabled,true);
  clickByLabel(root,'页面选项');
  assert.equal(Menu.last.items.find(i=>i.title==='刷新摘录').disabled,true);
  await t.pane.openFile(saved);
  assert.equal([...t.plugin.rendered][0].homeInvalid,false,'reopening reads the new configuration');
  await t.close();
});

test('settings and ribbon reject new page creation and navigation while busy',async()=>{
  const t=await fixture();
  Setting.instances=[];
  const tab=t.plugin.settingsTab;
  tab.display();
  const created=Setting.instances.find(x=>x.name==='创建首页文件').button;
  const opened=Setting.instances.find(x=>x.name===t.home.path).button;
  const scope=Setting.instances.find(x=>x.name==='包含子文件夹').toggle;
  assert.equal(created.disabled,false);
  let release;
  const scan=t.plugin.repo.scan.bind(t.plugin.repo);
  t.plugin.repo.scan=async(...args)=>{await new Promise(resolve=>{release=resolve;});return scan(...args);};
  t.plugin.refreshViews(true);
  assert.equal(created.disabled,true);
  assert.equal(opened.disabled,true);
  assert.equal(scope.disabled,true);
  const count=t.files.size;
  await created.handler();
  opened.handler();
  t.plugin.ribbon.action();
  assert.equal(t.files.size,count,'old handlers and ribbon cannot create files while busy');
  assert.match(Notice.last,/操作尚未完成/);
  release();
  await waitFor(()=>[...t.plugin.rendered][0].scanStatus==='done','scan completes');
  assert.equal(created.disabled,false);
  assert.equal(opened.disabled,false);
  await t.close();
});

test('refresh command targets only the active .excerpts view',async()=>{
  const t=await fixture();
  const second=t.plugin.factory({});
  document.body.append(second.contentEl);
  await second.openFile(t.home);
  await waitFor(()=>[...t.plugin.rendered].every(c=>c.scanStatus==='done'),'both pages ready');
  const firstRenderer=[...t.plugin.rendered][0];
  const secondRenderer=[...t.plugin.rendered][1];
  const real=t.plugin.repo.scan.bind(t.plugin.repo);
  let scans=0;
  t.plugin.repo.scan=async(...args)=>{scans++;return real(...args);};
  const cmd=t.plugin.commands.find(c=>c.id==='refresh-home');
  assert.ok(cmd);
  t.plugin.app.workspace.activeLeaf={view:second};
  cmd.callback();
  await waitFor(()=>scans===1 && secondRenderer.scanStatus==='done','second active page refreshed');
  assert.equal(firstRenderer.scanStatus,'done');
  t.plugin.app.workspace.activeLeaf={view:{getViewType(){return 'markdown';}}};
  cmd.callback();
  assert.equal(scans,1,'non-excerpts active views do not refresh other excerpts');
  assert.match(Notice.last,/选中一个摘录页/);
  await second.onUnloadFile(t.home);second.contentEl.remove();await t.close();
});


test('global scan ownership survives page unloading until the cancelled promise settles',async()=>{
  const t=await fixture();
  const original=t.plugin.repo.scan.bind(t.plugin.repo);
  let release,oldCancelled;
  let calls=0;
  t.plugin.repo.scan=async(...args)=>{
    calls++;
    if(calls===1){
      oldCancelled=args[3];
      await new Promise(resolve=>{release=resolve;});
      return null;
    }
    return original(...args);
  };
  t.plugin.refreshViews(true);
  await waitFor(()=>typeof release==='function','long scan began');
  const oldRenderer=[...t.plugin.rendered][0];
  assert.equal(oldRenderer.scanStatus,'scanning');
  assert.equal(t.plugin.tryAcquireScan(oldRenderer),false,'an owner cannot reenter its own scan lock');

  const second=t.plugin.factory({});
  document.body.append(second.contentEl);
  await second.openFile(t.home);
  const next=[...t.plugin.rendered].find(v=>v!==oldRenderer);
  assert.ok(next);
  assert.equal(next.scanStatus,'blocked');
  assert.equal(calls,1);

  await t.pane.onUnloadFile(t.home);
  assert.equal(oldCancelled(),true,'unloading requests cancellation');
  assert.equal(t.plugin.isBusy(),true,'untracked cancelled task still owns global scan lock');
  assert.equal(t.plugin.tryAcquireScan(next),false,'non-owner cannot acquire before settlement');
  t.plugin.releaseScan(next);
  assert.equal(t.plugin.isBusy(),true,'non-owner cannot release someone else\'s scan lock');
  next.requestRefresh(true);
  assert.equal(calls,1,'manual retry while old promise is unresolved is rejected');

  release();
  await waitFor(()=>!t.plugin.isBusy(),'cancelled scan actually released its lock');
  assert.equal(next.scanStatus,'blocked','no queued retry or status reset');
  next.requestRefresh(true);
  await waitFor(()=>next.scanStatus==='done' && calls===2,'new scan starts after release');
  await second.onUnloadFile(t.home);second.contentEl.remove();
  await t.close();
});

test('a rejected initial scan stays unscanned after Vault edits until manual refresh',async()=>{
  const t=await fixture();
  const actual=t.plugin.repo.scan.bind(t.plugin.repo);
  let unblock,calls=0;
  t.plugin.repo.scan=async(...args)=>{
    calls++;
    if(calls===1)await new Promise(resolve=>{unblock=resolve;});
    return actual(...args);
  };
  t.plugin.refreshViews(true);
  await waitFor(()=>typeof unblock==='function','first scan underway');
  const next=t.plugin.factory({});
  document.body.append(next.contentEl);
  await next.openFile(t.home);
  const second=[...t.plugin.rendered].find(x=>x.workspace.homePath===t.home.path && x!==[...t.plugin.rendered][0]);
  assert.ok(second);
  assert.equal(second.scanStatus,'blocked');
  t.plugin.onFileChange(t.md.path);
  assert.equal(second.scanStatus,'blocked','file changes must not invent a committed index');
  assert.equal(next.contentEl.querySelector('.ex-scan-status').dataset.state,'blocked');
  assert.equal(next.contentEl.querySelector('.ex-compose-actions .ex-btn-primary').disabled,true);
  assert.equal(calls,1,'no background scan launched');
  unblock();
  await waitFor(()=>[...t.plugin.rendered][0].scanStatus==='stale','original scan was dirtied');
  second.requestRefresh(true);
  await waitFor(()=>second.scanStatus==='done' && calls===2,'explicit refresh after first scan ends');
  await next.onUnloadFile(t.home);next.contentEl.remove();await t.close();
});

test('scan errors release the exclusive lock so another page can scan',async()=>{
  const t=await fixture();
  const original=t.plugin.repo.scan.bind(t.plugin.repo);
  let count=0;
  t.plugin.repo.scan=async(...args)=>{
    count++;
    if(count===1)throw new Error('forced metadata scan failure');
    return original(...args);
  };
  t.plugin.refreshViews(true);
  const current=[...t.plugin.rendered][0];
  await waitFor(()=>current.scanStatus==='error','first scan failed');
  assert.equal(t.plugin.isBusy(),false,'a failed scan must release its lock');
  const next=t.plugin.factory({});
  document.body.append(next.contentEl);
  await next.openFile(t.home);
  await waitFor(()=>[...t.plugin.rendered].some(x=>x!==current && x.scanStatus==='done'),
    'another page can start scanning after failure');
  assert.equal(count,2);
  await next.onUnloadFile(t.home);next.contentEl.remove();await t.close();
});

test('dirty scan with saved query shows unavailable results instead of zero matches',async()=>{
  const t=await fixture();
  const saved=await t.plugin.createSavedPage(t.home.path,'搜索状态',{tag:'',query:'测试标题'});
  const actual=t.plugin.repo.scan.bind(t.plugin.repo);
  let release;
  t.plugin.repo.scan=async(...args)=>{
    await new Promise(resolve=>{release=resolve;});
    return actual(...args);
  };
  await t.pane.openFile(saved);
  const root=t.pane.contentEl;
  await waitFor(()=>typeof release==='function','saved-query scan began');
  const renderer=[...t.plugin.rendered][0];
  t.plugin.onFileChange(t.md.path);
  assert.equal(renderer.scanDirty,true);
  assert.equal(root.querySelector('.ex-empty-title')?.textContent,'搜索结果暂不可用');
  release();
  await waitFor(()=>renderer.scanStatus==='stale','dirty scan completed');
  assert.equal(root.querySelector('.ex-count').textContent,'搜索结果暂不可用');
  assert.equal(root.querySelector('.ex-empty-title')?.textContent,'搜索结果暂不可用');
  assert.match(root.querySelector('.ex-empty-description')?.textContent,/清除搜索词.*手动刷新/);
  assert.equal(root.querySelector('.ex-card'),null);
  const search=root.querySelector('button[aria-label="搜索"]');
  assert.equal(search.disabled,false);
  search.click();
  assert.equal(root.querySelector('.ex-search').value,'');
  assert.equal(root.querySelector('.ex-count').textContent,'1 / 1','clearing shows old index without a scan');
  await t.close();
});

test('completed full-text search with no matches still uses the true empty result',async()=>{
  const t=await fixture(),root=t.pane.contentEl;
  clickByLabel(root,'搜索');
  const input=root.querySelector('.ex-search');
  input.value='不存在的匹配词';
  input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  await waitFor(()=>root.querySelector('.ex-count')?.textContent==='0 / 1','completed no-match search');
  assert.equal(root.querySelector('.ex-empty-title')?.textContent,'没有匹配的摘录');
  assert.equal(root.querySelector('.ex-scan-status').dataset.state,'done');
  await t.close();
});

test('another page scan disables clear-search button and Escape including stale event callbacks',async()=>{
  const t=await fixture();
  const saved=await t.plugin.createSavedPage(t.home.path,'带搜索的页面',{tag:'',query:'测试标题'});
  const second=t.plugin.factory({});
  document.body.append(second.contentEl);
  await second.openFile(saved);
  const renderer=[...t.plugin.rendered].find(c=>c.workspace.homePath===saved.path);
  await waitFor(()=>renderer.scanStatus==='done' && renderer.searchReady,'saved search completed');
  t.plugin.onFileChange(t.md.path);
  assert.equal(renderer.scanStatus,'stale');
  const root=second.contentEl;
  const button=root.querySelector('button[aria-label="搜索"]');
  const input=root.querySelector('.ex-search');
  assert.equal(button.disabled,false,'stale results can be cleared while idle');
  let release;
  const scan=t.plugin.repo.scan.bind(t.plugin.repo);
  t.plugin.repo.scan=async(...args)=>{
    await new Promise(resolve=>{release=resolve;});
    return scan(...args);
  };
  const homeRenderer=[...t.plugin.rendered].find(c=>c.workspace.homePath===t.home.path);
  homeRenderer.requestRefresh(true);
  await waitFor(()=>typeof release==='function','other page scanning');
  assert.equal(button.disabled,true,'global activity disables clearing');
  button.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(input.value,'测试标题','stale button and Escape cannot bypass busy guard');
  release();
  await waitFor(()=>homeRenderer.scanStatus==='done' && !t.plugin.isBusy(),'scan and mutex settled');
  assert.equal(button.disabled,false,'clearing is re-enabled after other page settles');
  button.click();
  assert.equal(input.value,'');
  await second.onUnloadFile(saved);second.contentEl.remove();await t.close();
});

test('settings create action locks synchronously and rejects repeated or concurrent settings actions',async()=>{
  const t=await fixture();
  Setting.instances=[];
  const tab=t.plugin.settingsTab;
  tab.display();
  const setting=Setting.instances.find(x=>x.name==='创建首页文件');
  const button=setting.button;
  const opened=Setting.instances.find(x=>x.name===t.home.path).button;
  const scope=Setting.instances.find(x=>x.name==='包含子文件夹').toggle;
  setting.text.handler('阅读记录');
  const create=t.plugin.createHome.bind(t.plugin);
  let calls=0,release;
  t.plugin.createHome=async(...args)=>{
    calls++;
    await new Promise(resolve=>{release=resolve;});
    return create(...args);
  };
  const first=button.handler();
  assert.equal(calls,1);
  assert.equal(button.disabled,true);
  assert.equal(button.text,'创建中…');
  assert.equal(opened.disabled,true);
  assert.equal(scope.disabled,true);
  await button.handler();
  assert.equal(calls,1,'a second handler invocation is refused without queueing');
  assert.match(Notice.last,/操作尚未完成/);
  assert.equal(t.plugin.homeCreationOwner !== null,true,'the global lock is owned by the plugin');
  assert.equal(t.plugin.isBusy(),true,'creation blocks all other plugin operations');
  assert.equal(t.plugin.canOpenHome(),false);
  const active=[...t.plugin.rendered][0];
  assert.equal(t.plugin.tryAcquireScan(active),false,'scan cannot acquire while home creation is running');
  let scanCalls=0;
  const oldScan=t.plugin.repo.scan.bind(t.plugin.repo);
  t.plugin.repo.scan=async(...args)=>{scanCalls++;return oldScan(...args);};
  active.requestRefresh(true);
  assert.equal(scanCalls,0);
  t.plugin.ribbon.action();
  await wait();
  assert.equal(t.leaf.lastFile,null,'ribbon navigation cannot open during creation');
  assert.equal(scanCalls,0);
  tab.syncBusy();
  assert.equal(button.disabled,true,'other control updates cannot unlock the create button');
  await scope.handler(false);
  assert.equal(t.plugin.settings.recursive,true,'settings remain unchanged while creation is pending');
  const before=t.files.size;
  release();
  await first;
  assert.equal(calls,1);
  assert.equal(t.files.has('阅读记录/首页.excerpts'),true);
  assert.equal(t.files.size,before+2,'the requested folder and homepage were created once');
  assert.equal(t.plugin.homeCreationOwner === null,true);
  assert.equal(button.text,'创建并打开');
  assert.equal(tab.homeButtons.every(b=>!b.disabled),true);
  await t.close();
});

test('failed homepage creation releases the settings lock and preserves the folder entry',async()=>{
  const t=await fixture();
  Setting.instances=[];
  const tab=t.plugin.settingsTab;
  tab.display();
  const setting=Setting.instances.find(x=>x.name==='创建首页文件');
  setting.text.handler('稍后重试');
  const button=setting.button;
  const create=t.plugin.createHome.bind(t.plugin);
  let calls=0;
  t.plugin.createHome=async(...args)=>{
    calls++;
    if(calls===1)throw new Error('模拟创建失败');
    return create(...args);
  };
  await button.handler();
  assert.match(Notice.last,/模拟创建失败/);
  assert.equal(button.disabled,false);
  assert.equal(button.text,'创建并打开');
  assert.equal(t.plugin.homeCreationOwner === null,true);
  await button.handler();
  assert.equal(calls,2);
  assert.equal(t.files.has('稍后重试/首页.excerpts'),true,
    'retry uses the original folder entry rather than discarding it on failure');
  await t.close();
});

test('an expanded empty search can be closed without changing index during stale or cross-page scanning',async()=>{
  const t=await fixture();
  const root=t.pane.contentEl, search=root.querySelector('button[aria-label="搜索"]');
  const input=root.querySelector('.ex-search');
  clickByLabel(root,'搜索');
  assert.equal(root.querySelector('.ex-search-wrap').hidden,false);
  let searches=0;
  const originalSearch=t.plugin.repo.search.bind(t.plugin.repo);
  t.plugin.repo.search=async(...args)=>{searches++;return originalSearch(...args);};
  t.plugin.onFileChange(t.md.path);
  assert.equal(root.querySelector('.ex-scan-status').dataset.state,'stale');
  assert.equal(search.disabled,false,'closing empty search remains available on stale index');
  assert.equal(search.title,'关闭搜索');
  search.click();
  assert.equal(root.querySelector('.ex-search-wrap').hidden,true);
  assert.equal(input.value,'');
  assert.equal(searches,0,'closing an empty input does not start search');
  const renderer=[...t.plugin.rendered][0];
  assert.equal(renderer.scanStatus,'stale');

  // Another page can be scanning while this existing empty search box is expanded.
  renderer.requestRefresh(true);
  await waitFor(()=>renderer.scanStatus==='done','restore current index');
  clickByLabel(root,'搜索');
  const second=t.plugin.factory({});
  document.body.append(second.contentEl);
  const real=t.plugin.repo.scan.bind(t.plugin.repo);
  let release;
  t.plugin.repo.scan=async(...args)=>{await new Promise(resolve=>{release=resolve;});return real(...args);};
  await second.openFile(t.home);
  await waitFor(()=>typeof release==='function','second view scan began');
  assert.equal(search.disabled,false);
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(root.querySelector('.ex-search-wrap').hidden,true,'Escape closes empty input during peer scan');
  assert.equal(searches,0,'Escape closing does not restart full-text search');
  assert.equal(renderer.searchText,'');
  release();
  await waitFor(()=>!t.plugin.isBusy(),'peer scan settles');
  await second.onUnloadFile(t.home);second.contentEl.remove();await t.close();
});

test('invalid excerpt page refuses empty search closing',async()=>{
  const t=await fixture();
  const root=t.pane.contentEl;
  clickByLabel(root,'搜索');
  const search=root.querySelector('button[aria-label="搜索"]');
  const input=root.querySelector('.ex-search');
  const renderer=[...t.plugin.rendered][0];
  renderer.invalidateHome('configuration');
  assert.equal(search.disabled,true);
  search.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(root.querySelector('.ex-search-wrap').hidden,false);
  await t.close();
});

test('settings open buttons handle rejected native navigation with a Notice',async()=>{
  const t=await fixture();
  const page=await t.plugin.createSavedPage(t.home.path,'阅读筛选',{tag:'',query:''});
  Setting.instances=[];
  t.plugin.settingsTab.display();
  const homeButton=Setting.instances.find(x=>x.name===t.home.path).button;
  const pageButton=Setting.instances.find(x=>x.name===page.basename).button;
  t.plugin.openHome=async()=>{throw new Error('打开失败（测试）');};
  homeButton.handler();
  await waitFor(()=>/打开失败（测试）/.test(Notice.last),'home open failure reported');
  Notice.last='';
  pageButton.handler();
  await waitFor(()=>/打开失败（测试）/.test(Notice.last),'saved page failure reported');
  await t.close();
});

test('created homepage is kept and user is told to reopen it when navigation throws',async()=>{
  const t=await fixture();
  Setting.instances=[];
  const tab=t.plugin.settingsTab;
  tab.display();
  const createdSetting=Setting.instances.find(x=>x.name==='创建首页文件');
  createdSetting.text.handler('打开失败案例');
  t.leaf.openFile=async()=>{throw new Error('模拟导航异常');};
  await createdSetting.button.handler();
  assert.equal(t.files.has('打开失败案例/首页.excerpts'),true);
  assert.equal(t.plugin.homeCreationOwner === null,true);
  assert.match(Notice.last,/首页文件已保留，但打开失败.*重新打开.*模拟导航异常/);
  assert.ok(Setting.instances.some(x=>x.name==='打开失败案例/首页.excerpts'),
    'settings list offers the created file for manual reopening');
  await t.close();
});

test('global creation lock is released after creation fails without scanning or auto retries',async()=>{
  const t=await fixture();
  Setting.instances=[];
  const tab=t.plugin.settingsTab;tab.display();
  const entry=Setting.instances.find(x=>x.name==='创建首页文件');
  entry.text.handler('不创建');
  t.plugin.createHome=async()=>{throw new Error('磁盘不可写');};
  await entry.button.handler();
  assert.equal(t.plugin.homeCreationOwner === null,true);
  assert.equal(t.plugin.isBusy(),false);
  assert.match(Notice.last,/磁盘不可写/);
  assert.equal(entry.button.disabled,false);
  await t.close();
});

test('homepage creation owner is exclusive across both native navigation awaits',async()=>{
  const t=await fixture();
  let enterOpen,leaveOpen,enterReveal,leaveReveal;
  t.leaf.openFile=async(file)=>{
    enterOpen=file;
    await new Promise(resolve=>{leaveOpen=resolve;});
  };
  t.plugin.app.workspace.revealLeaf=async()=>{
    enterReveal=true;
    await new Promise(resolve=>{leaveReveal=resolve;});
  };
  const first=t.plugin.createAndOpenHome('长导航');
  await waitFor(()=>typeof leaveOpen==='function','native openFile pending');
  const firstOwner=t.plugin.homeCreationOwner;
  assert.equal(typeof firstOwner,'symbol');
  assert.equal(t.plugin.isBusy(),true);
  assert.equal(enterOpen.path,'长导航/首页.excerpts');
  assert.equal(t.plugin.tryAcquireScan([...t.plugin.rendered][0]),false);
  await assert.rejects(t.plugin.createAndOpenHome('不能并行'),/操作尚未完成/);
  await assert.rejects(t.plugin.openHome(t.home.path),/操作尚未完成/);
  t.plugin.endHomeCreation(Symbol('wrong-owner'));
  assert.equal(t.plugin.homeCreationOwner,firstOwner,'incorrect owner cannot unlock');
  t.plugin.ribbon.action();
  await wait();
  assert.equal(t.plugin.homeCreationOwner,firstOwner);
  assert.equal(t.files.has('不能并行/首页.excerpts'),false);

  leaveOpen();
  await waitFor(()=>typeof leaveReveal==='function','native revealLeaf pending');
  assert.equal(enterReveal,true);
  assert.equal(t.plugin.homeCreationOwner,firstOwner,'lock survives between native awaits');
  assert.equal(t.plugin.tryBeginHomeCreation(),null,'second creation cannot enter during reveal');
  await assert.rejects(t.plugin.openHome(t.home.path),/操作尚未完成/);
  t.plugin.endHomeCreation(Symbol('old-callback'));
  assert.equal(t.plugin.homeCreationOwner,firstOwner);
  leaveReveal();
  const result=await first;
  assert.equal(result.openError,null);
  assert.equal(result.file.path,'长导航/首页.excerpts');
  assert.equal(t.plugin.homeCreationOwner,null,'owner released only after navigation');
  assert.equal(t.plugin.isBusy(),false);
  assert.equal(t.plugin.canOpenHome(),true);
  await t.close();
});

test('opening a freshly created native .excerpts page stays blocked until explicit scan',async()=>{
  const t=await fixture();
  let childPane,renderer,scans=0;
  const originalScan=t.plugin.repo.scan.bind(t.plugin.repo);
  t.plugin.repo.scan=async(...args)=>{scans++;return originalScan(...args);};
  t.leaf.openFile=async file=>{
    childPane=t.plugin.factory({});
    document.body.append(childPane.contentEl);
    await childPane.openFile(file);
    renderer=[...t.plugin.rendered].find(x=>x.workspace.homePath===file.path);
    assert.ok(renderer,'native view initialized');
    assert.equal(renderer.scanStatus,'blocked','initial scan has no special bypass');
    assert.equal(t.plugin.homeCreationOwner!==null,true,'creation lock still held');
  };
  const result=await t.plugin.createAndOpenHome('新首页');
  assert.equal(result.openError,null);
  assert.equal(renderer.scanStatus,'blocked','navigation completes without a queued scan');
  assert.equal(scans,0);
  assert.equal(t.plugin.homeCreationOwner,null);
  assert.match(childPane.contentEl.querySelector('.ex-scan-text').textContent,/请手动刷新/);
  renderer.requestRefresh(true);
  await waitFor(()=>renderer.scanStatus==='done' && scans===1,'manual first scan completes');
  await childPane.onUnloadFile(result.file);
  childPane.contentEl.remove();
  await t.close();
});

test('old creation flow cannot release newer owner, and failed navigation keeps file',async()=>{
  const t=await fixture();
  const former=t.plugin.tryBeginHomeCreation();
  assert.equal(typeof former,'symbol');
  t.plugin.endHomeCreation(former);
  const current=t.plugin.tryBeginHomeCreation();
  assert.equal(typeof current,'symbol');
  assert.notEqual(current,former);
  t.plugin.endHomeCreation(former);
  assert.equal(t.plugin.homeCreationOwner,current,'stale flow must not release newer lock');
  t.plugin.endHomeCreation(current);
  assert.equal(t.plugin.homeCreationOwner,null);

  t.leaf.openFile=async()=>{throw new Error('无法打开文件');};
  const result=await t.plugin.createAndOpenHome('需手动打开');
  assert.equal(result.file.path,'需手动打开/首页.excerpts');
  assert.match(result.openError.message,/无法打开文件/);
  assert.equal(t.files.has(result.file.path),true);
  assert.equal(t.plugin.homeCreationOwner,null);
  assert.equal(t.plugin.isBusy(),false);
  await assert.rejects(t.plugin.openHome('不存在的文件.excerpts'),/摘录页文件不存在/);
  await t.close();
});

test('saved filter file remains saved and modal closes when its native open fails',async()=>{
  const t=await fixture(),root=t.pane.contentEl;
  clickByLabel(root,'筛选标签');
  [...root.querySelectorAll('.ex-filter-tags button')].find(x=>x.textContent==='#哲学').click();
  clickByLabel(root,'页面选项');
  Menu.last.items.find(x=>x.title==='保存当前筛选…').handler();
  const dialog=document.querySelector('.ex-save-page-modal');
  assert.ok(dialog);
  t.leaf.openFile=async()=>{throw new Error('模拟筛选页导航失败');};
  dialog.querySelector('.ex-save-page-submit').click();
  await waitFor(()=>!document.querySelector('.ex-save-page-modal'),'modal closes after the file is saved');
  const path='摘录/哲学摘录.excerpts';
  assert.ok(t.files.has(path),'navigation does not undo a successful file save');
  assert.match(Notice.last,/摘录页已保存，但打开失败.*文件列表.*模拟筛选页导航失败/);
  assert.equal(t.files.get(path).data.includes('tag: "哲学"'),true);
  assert.equal([...t.files.keys()].filter(x=>x===path).length,1);
  assert.equal(t.plugin.homeNavigationBusy,false);
  await t.close();
});

test('invalid .excerpts config is visible and rejects FileView navigation',async()=>{
  const t=await fixture();
  const file=await t.plugin.createSavedPage(t.home.path,'无效配置',{tag:'',query:''});
  t.files.get(file.path).data='version: 999\nfilter:\n  tag: ""\n  query: ""\n';
  const pane=t.plugin.factory({});
  document.body.append(pane.contentEl);
  await assert.rejects(pane.openFile(file),/配置版本或筛选条件无效/);
  assert.match(pane.contentEl.querySelector('.ex-page-error')?.textContent??'',/配置版本或筛选条件无效/);
  assert.equal([...t.plugin.rendered].some(child=>child.workspace.homePath===file.path),false);
  pane.contentEl.remove();

  t.leaf.openFile=async chosen=>{await t.pane.openFile(chosen);};
  await assert.rejects(t.plugin.openHome(file.path),/配置版本或筛选条件无效/);
  assert.equal(t.plugin.homeNavigationBusy,false);
  assert.equal(t.plugin.canOpenHome(),true,'failed native load does not hold the navigation lock');
  assert.match(t.pane.contentEl.querySelector('.ex-page-error')?.textContent??'',/配置版本或筛选条件无效/);
  await t.close();
});

test('normal native open is exclusive until openFile and revealLeaf both settle',async()=>{
  const t=await fixture();
  Setting.instances=[];t.plugin.settingsTab.display();
  const settingsOpen=Setting.instances.find(x=>x.name===t.home.path).button;
  let leaveOpen,leaveReveal,opened=0,revealed=0;
  t.leaf.openFile=async()=>{opened++;await new Promise(resolve=>{leaveOpen=resolve;});};
  t.plugin.app.workspace.revealLeaf=async()=>{revealed++;await new Promise(resolve=>{leaveReveal=resolve;});};
  const first=t.plugin.openHome(t.home.path);
  await waitFor(()=>typeof leaveOpen==='function','first normal openFile pending');
  assert.equal(opened,1);
  assert.equal(t.plugin.homeNavigationBusy,true);
  assert.equal(settingsOpen.disabled,true);
  await assert.rejects(t.plugin.openHome(t.home.path),/操作尚未完成/);
  await assert.rejects(t.plugin.createAndOpenHome('不应创建'),/操作尚未完成/);
  assert.equal(t.files.has('不应创建/首页.excerpts'),false);
  settingsOpen.handler();
  t.plugin.ribbon.action();
  await wait();
  assert.equal(opened,1,'no second navigation starts from old settings or ribbon handlers');
  leaveOpen();
  await waitFor(()=>typeof leaveReveal==='function','native revealLeaf pending');
  assert.equal(revealed,1);
  assert.equal(t.plugin.homeNavigationBusy,true);
  await assert.rejects(t.plugin.openHome(t.home.path),/操作尚未完成/);
  leaveReveal();
  await first;
  assert.equal(t.plugin.homeNavigationBusy,false);
  assert.equal(settingsOpen.disabled,false);
  assert.equal(t.plugin.canOpenHome(),true);
  await t.close();
});

test('normal native navigation failure releases navigation restriction',async()=>{
  const t=await fixture();
  t.leaf.openFile=async()=>{throw new Error('本地导航失败');};
  await assert.rejects(t.plugin.openHome(t.home.path),/本地导航失败/);
  assert.equal(t.plugin.homeNavigationBusy,false);
  assert.equal(t.plugin.canOpenHome(),true);
  const result=await t.plugin.createAndOpenHome('失败后可创建');
  assert.ok(result.file);
  assert.match(result.openError?.message??'',/本地导航失败/);
  assert.equal(t.plugin.homeCreationOwner,null);
  await t.close();
});

test('normal opening does not block the opened excerpt page initial scan',async()=>{
  const t=await fixture();
  const home=t.home;
  let newPane,initial;
  const real=t.plugin.repo.scan.bind(t.plugin.repo);
  let scans=0;
  t.plugin.repo.scan=async(...args)=>{scans++;return real(...args);};
  t.leaf.openFile=async file=>{
    newPane=t.plugin.factory({});
    document.body.append(newPane.contentEl);
    await newPane.openFile(file);
    initial=[...t.plugin.rendered].find(x=>x.containerEl===newPane.contentEl.firstElementChild);
    assert.ok(initial);
    assert.notEqual(initial.scanStatus,'blocked','normal navigation does not steal index mutex');
    assert.equal(t.plugin.homeNavigationBusy,true);
  };
  await t.plugin.openHome(home.path);
  await waitFor(()=>initial.scanStatus==='done' && scans===1,'normal first scan');
  assert.equal(t.plugin.homeNavigationBusy,false);
  await newPane.onUnloadFile(home);newPane.contentEl.remove();
  await t.close();
});

test('homepage creation uses the validated canonical folder for both folders and final file',async()=>{
  const t=await fixture();
  const file=await t.plugin.createHome('  文学\\摘录  ');
  assert.equal(file.path,'文学/摘录/首页.excerpts');
  assert.ok(t.files.has('文学'),'canonical first folder is created');
  assert.ok(t.files.has('文学/摘录'),'canonical nested folder is created');
  assert.ok(t.files.has(file.path),'home is placed inside the canonical folder');
  assert.equal(t.files.has('  文学\\摘录  /首页.excerpts'),false,'no raw unnormalized path is used');
  const existing=await t.plugin.createHome('  摘录/  ');
  assert.equal(existing,t.home,'normalized existing home is reused rather than duplicated');
  const before=t.files.size;
  await assert.rejects(t.plugin.createHome(' ../非法 '),/有效的相对文件夹路径/);
  assert.equal(t.files.size,before,'invalid path is rejected before creating folders');
  await t.close();
});

test('settings create and open resolves a normalized folder path end-to-end',async()=>{
  const t=await fixture();
  Setting.instances=[];
  const tab=t.plugin.settingsTab;
  tab.display();
  const entry=Setting.instances.find(x=>x.name==='创建首页文件');
  entry.text.handler('  电影\\对白  ');
  await entry.button.handler();
  assert.equal(t.leaf.lastFile?.path,'电影/对白/首页.excerpts');
  assert.equal(t.files.has('电影/对白/首页.excerpts'),true);
  assert.equal(t.plugin.homeCreationOwner,null);
  assert.equal(t.plugin.canOpenHome(),true);
  await t.close();
});

test('stale settings callbacks refuse every configuration change during normal navigation',async()=>{
  const t=await fixture();
  Setting.instances=[];
  const tab=t.plugin.settingsTab;
  tab.display();
  const scope=Setting.instances.find(x=>x.name==='包含子文件夹').toggle;
  const batch=Setting.instances.find(x=>x.name==='每批扫描数量').dropdown;
  const mode=Setting.instances.find(x=>x.name==='预取批次').dropdown;
  const size=Setting.instances.find(x=>x.name==='固定批次大小').dropdown;
  assert.ok(scope && batch && mode && size);
  const initial={...t.plugin.settings};
  let writes=0;
  t.plugin.saveSettings=async()=>{writes++;};
  let resolveOpen;
  t.leaf.openFile=async()=>{await new Promise(resolve=>{resolveOpen=resolve;});};
  const opening=t.plugin.openHome(t.home.path);
  await waitFor(()=>typeof resolveOpen==='function','normal navigation is pending');
  assert.equal(t.plugin.homeNavigationBusy,true);
  assert.equal(t.plugin.isBusy(),false,'navigation-only restriction must not block initial page scans');
  assert.equal(t.plugin.canOpenHome(),false);
  for(const control of [scope,batch,mode,size])assert.equal(control.disabled,true);
  await scope.handler(false);
  await batch.handler('128');
  await mode.handler('fixed');
  await size.handler('96');
  assert.deepEqual(t.plugin.settings,initial,'old callbacks cannot bypass disabled settings controls');
  assert.equal(scope.value,initial.recursive);
  assert.equal(batch.value,String(initial.scanBatchSize));
  assert.equal(mode.value,initial.listBatchMode);
  assert.equal(size.value,String(initial.listBatchSize));
  assert.equal(writes,0,'no settings writes or deferred actions');
  assert.match(Notice.last,/操作尚未完成/);
  resolveOpen();
  await opening;
  for(const control of [scope,batch,mode,size])assert.equal(control.disabled,false);
  await batch.handler('128');
  assert.equal(t.plugin.settings.scanBatchSize,128,'settings recover after navigation finishes');
  assert.equal(writes,1);
  await t.close();
});

test('folder menu opens a native folder view with no .excerpts entry file',async()=>{
  const t=await fixture();
  const menuFor=target=>{const menu=new Menu();t.workspaceEvents.get('file-menu')(menu,target);return menu;};
  assert.equal(menuFor(t.md).items.length,0);
  const folder=t.files.get('摘录').file;
  const menu=menuFor(folder);
  assert.equal(menu.items.length,1);
  assert.equal(menu.items[0].title,'打开摘录');
  await t.pane.onUnloadFile(t.home);
  t.files.delete(t.home.path);
  const originalGetLeaf=t.plugin.app.workspace.getLeaf;
  t.plugin.app.workspace.getLeaf=(mode)=>{
    if(mode!=='tab')return originalGetLeaf(mode);
    const tab={view:null,async setViewState(state){
      this.state=state;
      this.view=t.plugin.factories[state.type](tab);
      document.body.append(this.view.contentEl);
      await this.view.setState(state.state,{});
    }};
    t.folderLeaves.push(tab);
    return tab;
  };
  const before=t.files.size;
  await t.plugin.openFolder(folder);
  assert.equal(t.files.size,before,'folder opening creates no files');
  assert.equal(t.folderLeaves.length,1);
  const view=t.folderLeaves[0].view;
  assert.deepEqual(view.getState(),{folderPath:'摘录'});
  assert.equal(view.getViewType(),'excerpts-folder');
  assert.equal(view.contentEl.querySelector('.ex-title').textContent,'摘录');
  await waitFor(()=>view.contentEl.querySelector('.ex-scan-text')?.textContent==='已扫描 · 1 条');
  await t.plugin.openFolder(folder);
  assert.equal(t.folderLeaves.length,1,'reopening same folder reuses tab');
  await view.onClose();view.contentEl.remove();
  await t.close();
});

test('folder source saves filtered pages but never recreates deleted folders',async()=>{
  const t=await fixture();
  const folder=t.files.get('摘录').file;
  const ws=t.plugin.workspaceForFolder(folder);
  const saved=await t.plugin.createSavedPage(ws,'书摘筛选',{tag:'文学',query:''});
  assert.equal(saved.path,'摘录/书摘筛选.excerpts');
  assert.match(t.files.get(saved.path).data,/version: 1/);
  const before=t.files.size;
  t.files.delete('摘录');folder.path='已移动';t.files.set('已移动',{file:folder});
  await assert.rejects(t.plugin.repo.create(ws,'禁止重建'),/文件夹.*移动|不存在/);
  assert.equal(t.files.size,before);
  assert.equal(t.files.has('摘录'),false,'missing old folder is not recreated');
  await assert.rejects(t.plugin.createSavedPage(ws,'新筛选',{tag:'',query:'q'}),/文件夹.*移动|不存在/);
  await t.close();
});

test('missing folder state restores as a visible read-only error',async()=>{
  const t=await fixture();
  const view=t.plugin.factories['excerpts-folder']({});
  document.body.append(view.contentEl);
  const before=t.files.size;
  await view.setState({folderPath:'不存在的文件夹'},{});
  assert.equal(t.files.size,before);
  assert.deepEqual(view.getState(),{folderPath:'不存在的文件夹'});
  assert.match(view.contentEl.textContent,/文件夹不存在|移动/);
  assert.equal(view.contentEl.querySelector('.ex-composer'),null);
  await view.onClose();view.contentEl.remove();await t.close();
});

test('moving a folder invalidates an open folder-based feed',async()=>{
  const t=await fixture();
  const folder=t.files.get('摘录').file;
  const view=t.plugin.factories['excerpts-folder']({});
  document.body.append(view.contentEl);
  await view.setState({folderPath:'摘录'},{});
  await waitFor(()=>view.contentEl.querySelector('.ex-scan-text')?.textContent==='已扫描 · 1 条');
  t.files.delete('摘录');folder.path='收藏';t.files.set('收藏',{file:folder});
  t.vaultEvents.get('rename')(folder,'摘录');
  assert.equal(view.contentEl.querySelector('.ex-scan-status').dataset.state,'invalid');
  assert.equal(view.getState().folderPath,'摘录');
  await view.onClose();view.contentEl.remove();await t.close();
});

function installFolderTabs(t){
  const originalGetLeaf=t.plugin.app.workspace.getLeaf;
  t.plugin.app.workspace.getLeaf=(mode)=>{
    if(mode!=='tab')return originalGetLeaf(mode);
    const tab={view:null,async setViewState(state){
      this.state=state;
      this.view=t.plugin.factories[state.type](tab);
      document.body.append(this.view.contentEl);
      await this.view.setState(state.state,{});
    }};
    t.folderLeaves.push(tab);
    return tab;
  };
}

test('clicking folder context menu invokes navigation, stale menu refuses moved folder',async()=>{
  const t=await fixture();
  await t.pane.onUnloadFile(t.home);
  installFolderTabs(t);
  const folder=t.files.get('摘录').file;
  const menu=new Menu();
  t.workspaceEvents.get('file-menu')(menu,folder);
  menu.items[0].handler();
  await waitFor(()=>t.folderLeaves.length===1 && !!t.folderLeaves[0].view,'menu action opened folder');
  await waitFor(()=>t.folderLeaves[0].view.contentEl.querySelector('.ex-scan-status')?.dataset.state==='done');
  const stale=new Menu();
  t.workspaceEvents.get('file-menu')(stale,folder);
  t.files.delete('摘录');folder.path='改名';t.files.set('改名',{file:folder});
  t.vaultEvents.get('rename')(folder,'摘录');
  stale.items[0].handler();
  assert.equal(t.folderLeaves.length,1,'menu captured before rename does not navigate');
  assert.match(Notice.last,/位置已变化.*右键/);
  await t.folderLeaves[0].view.onClose();
  t.folderLeaves[0].view.contentEl.remove();
  await t.close();
});

test('renamed-back folder does not reuse a previously invalidated view',async()=>{
  const t=await fixture();
  await t.pane.onUnloadFile(t.home);
  installFolderTabs(t);
  const folder=t.files.get('摘录').file;
  await t.plugin.openFolder(folder);
  const stale=t.folderLeaves[0].view;
  await waitFor(()=>stale.contentEl.querySelector('.ex-scan-status')?.dataset.state==='done');
  t.files.delete('摘录');folder.path='收藏';t.files.set('收藏',{file:folder});
  t.vaultEvents.get('rename')(folder,'摘录');
  assert.equal(stale.contentEl.querySelector('.ex-scan-status').dataset.state,'invalid');
  assert.match(stale.contentEl.querySelector('.ex-page-hint').textContent,/文件夹右键菜单重新打开/);
  t.files.delete('收藏');folder.path='摘录';t.files.set('摘录',{file:folder});
  t.vaultEvents.get('rename')(folder,'收藏');
  assert.equal(stale.matchesFolder(folder),false);
  await t.plugin.openFolder(folder);
  assert.equal(t.folderLeaves.length,2,'new open creates a fresh tab instead of reusing invalid view');
  const fresh=t.folderLeaves[1].view;
  await waitFor(()=>fresh.contentEl.querySelector('.ex-scan-status')?.dataset.state==='done');
  assert.equal(fresh.matchesFolder(folder),true);
  assert.equal(stale.contentEl.querySelector('.ex-scan-status').dataset.state,'invalid');
  await t.plugin.openFolder(folder);
  assert.equal(t.folderLeaves.length,2,'valid folder tab can still be reused');
  await fresh.onClose();fresh.contentEl.remove();
  await stale.onClose();stale.contentEl.remove();
  await t.close();
});

test('two folder views isolate cards, drafts and saved page directories',async()=>{
  const t=await fixture();
  await t.pane.onUnloadFile(t.home);
  installFolderTabs(t);
  const first=t.files.get('摘录').file;
  const second=new TFolder('电影');
  t.files.set(second.path,{file:second});
  const secondFile=new TFile('电影/对白.md');
  t.files.set(secondFile.path,{file:secondFile,data:'# 电影台词'});
  await t.plugin.openFolder(first);
  const v1=t.folderLeaves[0].view;
  await waitFor(()=>v1.contentEl.querySelector('.ex-scan-text')?.textContent==='已扫描 · 1 条');
  const input=v1.contentEl.querySelector('.ex-compose-text');
  input.value='独立的文学草稿';
  input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  await t.plugin.openFolder(second);
  const v2=t.folderLeaves[1].view;
  await waitFor(()=>v2.contentEl.querySelector('.ex-scan-text')?.textContent==='已扫描 · 1 条');
  assert.equal(v1.contentEl.querySelector('.ex-card').dataset.path,'摘录/测试.md');
  assert.equal(v2.contentEl.querySelector('.ex-card').dataset.path,'电影/对白.md');
  assert.equal(v2.contentEl.querySelector('.ex-compose-text').value,'');
  const ws=[...t.plugin.rendered].find(child=>child.workspace.rootFolder==='电影').workspace;
  const created=await t.plugin.repo.create(ws,'# 第二目录摘录');
  assert.equal(created.path,'电影/第二目录摘录.md');
  const saved=await t.plugin.createSavedPage(ws,'电影精选',{tag:'台词',query:''});
  assert.equal(saved.path,'电影/电影精选.excerpts');
  assert.equal(v1.contentEl.querySelector('.ex-compose-text').value,'独立的文学草稿');
  await v2.onClose();v2.contentEl.remove();
  await v1.onClose();v1.contentEl.remove();
  await t.close();
});

test('folder identity is checked during scans and before delete writes',async()=>{
  const t=await fixture();
  const folder=t.files.get('摘录').file;
  const ws=t.plugin.workspaceForFolder(folder);
  const candidate=t.plugin.repo.snapshotForDelete(t.md.path,ws);
  assert.ok(candidate);
  await t.pane.onUnloadFile(t.home);
  const replacement=new TFolder('摘录');
  t.files.set('摘录',{file:replacement});
  assert.equal(t.plugin.repo.snapshotForDelete(t.md.path,ws),null);
  const deleted=await t.plugin.repo.deleteEntries(ws,[candidate]);
  assert.equal(deleted.deleted.length,0);
  assert.equal(deleted.failed.length,1);
  assert.match(deleted.failed[0].reason,/文件夹已移动|不存在/);
  assert.equal(t.files.has(t.md.path),true,'replaced folder cannot authorize old note deletion');
  await assert.rejects(t.plugin.repo.scan(ws,32,()=>{},()=>false),/文件夹已移动|不存在/);
  await assert.rejects(t.plugin.repo.create(ws,'# 不能保存'),/文件夹已移动|不存在/);
  const valid=t.plugin.workspaceForFolder(replacement);
  const scanned=await t.plugin.repo.scan(valid,32,()=>{},()=>false);
  assert.equal(scanned.length,1,'explicit reopened folder can scan');
  await t.close();
});

test('native editor retry refuses an unrelated file substituted at the saved path',async()=>{
  const t=await fixture();
  const original=t.leaf.openFile;
  t.leaf.openFile=async()=>{throw Error('native open unavailable');};
  clickByLabel(t.pane.contentEl,'编辑文档');
  await wait();
  const item=[...t.files].find(([p])=>p.startsWith('摘录/摘录 ')&&p.endsWith('.md'));
  assert.ok(item);
  const replacement=new TFile(item[0]);
  t.files.set(item[0],{file:replacement,data:'DO NOT OPEN'});
  let opened=0;
  t.leaf.openFile=async f=>{opened++;return original.call(t.leaf,f);};
  clickByLabel(t.pane.contentEl,'编辑文档');
  await wait();
  assert.equal(opened,0,'replacement file is never opened by retry');
  assert.equal(t.files.get(item[0]).data,'DO NOT OPEN');
  assert.equal([...t.files].filter(([p])=>p.startsWith('摘录/摘录 ')&&p.endsWith('.md')).length,1);
  assert.match(Notice.last,/原 Markdown 文件已移动或替换/);
  await t.close();
});

test('native editor retry refuses moved original file and never creates a second file',async()=>{
  const t=await fixture();
  t.leaf.openFile=async()=>{throw Error('native open unavailable');};
  clickByLabel(t.pane.contentEl,'编辑文档');
  await wait();
  const item=[...t.files].find(([p])=>p.startsWith('摘录/摘录 ')&&p.endsWith('.md'));
  assert.ok(item);
  t.files.delete(item[0]);
  item[1].file.path='摘录/改名.md';
  t.files.set(item[1].file.path,item[1]);
  let opened=0;
  t.leaf.openFile=async()=>{opened++;};
  clickByLabel(t.pane.contentEl,'编辑文档');
  await wait();
  assert.equal(opened,0);
  assert.equal(t.files.has('摘录/改名.md'),true);
  assert.equal(t.files.has(item[0]),false,'moved original is not silently recreated');
  assert.match(Notice.last,/原 Markdown 文件已移动或替换/);
  await t.close();
});

test('scoped editor opening blocks a target replaced before native open',async()=>{
  const t=await fixture();
  const ws=t.plugin.workspaceForHome(t.home);
  const original=t.plugin.app.workspace.getLeaf;
  let count=0;
  t.plugin.app.workspace.getLeaf=mode=>{
    const x=original(mode);
    if(mode==='tab') {
      const replacement=new TFile(t.md.path);
      t.files.set(t.md.path,{file:replacement,data:'other note'});
    }
    return x;
  };
  t.leaf.openFile=async()=>{count++;};
  await assert.rejects(
    t.plugin.openMarkdown(t.md.path,undefined,false,{workspace:ws,file:t.md}),
    /已移动|替换/);
  assert.equal(count,0);
  await t.close();
});

test('tag edit refuses replaced source Markdown without touching new frontmatter',async()=>{
  const t=await fixture();
  const card=t.pane.contentEl.querySelector('.ex-card');
  card.querySelector('.ex-add-tag').click();
  const picker=card.querySelector('.ex-tag-custom');
  picker.value='另一个标签';picker.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  [...card.querySelectorAll('.ex-tag-choice')].find(x=>x.textContent.includes('创建 #另一个标签')).click();
  const substitute=new TFile(t.md.path);
  t.files.set(t.md.path,{file:substitute,data:'new body'});
  card.querySelector('.ex-tag-done').click();
  await wait();
  assert.equal(t.getTagWrites(),0);
  assert.deepEqual(t.tagState.get(t.md.path),['哲学']);
  assert.match(Notice.last,/摘录文件已移动|替换/);
  await t.close();
});

test('tag write checks folder identity when native callback is released',async()=>{
  const t=await fixture();
  await t.pane.onUnloadFile(t.home);
  const view=t.plugin.factories['excerpts-folder']({});
  document.body.append(view.contentEl);
  await view.setState({folderPath:'摘录'},{});
  await waitFor(()=>view.contentEl.querySelector('.ex-scan-status')?.dataset.state==='done');
  const card=view.contentEl.querySelector('.ex-card');
  card.querySelector('.ex-add-tag').click();
  const input=card.querySelector('.ex-tag-custom');
  input.value='异步标签';input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  [...card.querySelectorAll('.ex-tag-choice')].find(x=>x.textContent.includes('创建 #异步标签')).click();
  let release;
  const real=t.plugin.app.fileManager.processFrontMatter;
  t.plugin.app.fileManager.processFrontMatter=async(file,fn)=>{
    await new Promise(resolve=>{release=resolve;});
    return real(file,fn);
  };
  card.querySelector('.ex-tag-done').click();
  await waitFor(()=>typeof release==='function','tag write reached native API');
  const folder=t.files.get('摘录').file;
  t.files.delete('摘录');folder.path='迁走';t.files.set('迁走',{file:folder});
  t.vaultEvents.get('rename')(folder,'摘录');
  release();
  await waitFor(()=>!([...t.plugin.rendered].find(c=>c.workspace.kind==='folder')?.pendingTags.size),
    'tag operation finished');
  assert.equal(t.getTagWrites(),0,'native callback must not modify tags after relocation');
  assert.deepEqual(t.tagState.get(t.md.path),['哲学']);
  await view.onClose();view.contentEl.remove();
  await t.close();
});

test('scan stops after source folder moves between metadata batches',async()=>{
  const t=await fixture();
  await t.pane.onUnloadFile(t.home);
  const folder=t.files.get('摘录').file;
  const ws=t.plugin.workspaceForFolder(folder);
  for(let i=0;i<40;i++) {
    const f=new TFile('摘录/补充'+i+'.md');
    t.files.set(f.path,{file:f,data:'body'});
  }
  let yielded;
  const original=t.plugin.app.vault.getMarkdownFiles;
  // The scan itself yields after the first small batch.
  const promise=t.plugin.repo.scan(ws,16,()=>{},()=>false);
  t.files.delete('摘录');folder.path='迁移';t.files.set('迁移',{file:folder});
  await assert.rejects(promise,/文件夹已移动|不存在/);
  t.plugin.app.vault.getMarkdownFiles=original;
  await t.close();
});

test('new folder tab is detached when view-state load throws',async()=>{
  const t=await fixture();
  const folder=t.files.get('摘录').file;
  let detached=0, reveal=0;
  const original=t.plugin.app.workspace.getLeaf;
  t.plugin.app.workspace.getLeaf=(mode)=>{
    if(mode!=='tab') return original(mode);
    return {view:null,async setViewState(){throw Error('view state failed');},
      detach(){detached++;}};
  };
  t.plugin.app.workspace.revealLeaf=async()=>{reveal++;};
  await assert.rejects(t.plugin.openFolder(folder),/view state failed/);
  assert.equal(detached,1);
  assert.equal(reveal,0);
  assert.equal(t.plugin.homeNavigationBusy,false);
  await t.close();
});

test('new folder tab is detached if its folder moves while setting view state',async()=>{
  const t=await fixture();
  const folder=t.files.get('摘录').file;
  let release, detached=0;
  const original=t.plugin.app.workspace.getLeaf;
  t.plugin.app.workspace.getLeaf=mode=>{
    if(mode!=='tab')return original(mode);
    return {view:null,async setViewState(){await new Promise(done=>{release=done;});},
      detach(){detached++;}};
  };
  const pending=t.plugin.openFolder(folder);
  await waitFor(()=>typeof release==='function','folder state load blocked');
  t.files.delete('摘录');folder.path='其他目录';t.files.set('其他目录',{file:folder});
  release();
  await assert.rejects(pending,/文件夹位置已变化/);
  assert.equal(detached,1);
  assert.equal(t.plugin.homeNavigationBusy,false);
  await t.close();
});


test('scope setting invalidates existing indexes before persistence and remains stale on failure', async()=>{
  const t=await fixture();
  const renderer=[...t.plugin.rendered][0];
  Setting.instances=[];
  t.plugin.settingsTab.display();
  const scope=Setting.instances.find(x=>x.name==='包含子文件夹').toggle;
  let release,fail=false;
  t.plugin.saveSettings=()=>new Promise((resolve,reject)=>{release=()=>fail?reject(new Error('persist failed')):resolve();});
  const change=scope.handler(false);
  assert.equal(renderer.scanStatus,'stale','scope must invalidate synchronously before awaiting');
  assert.equal(t.plugin.settings.recursive,false);
  clickByLabel(t.pane.contentEl,'页面选项');
  assert.equal(Menu.last.items.find(x=>x.title==='批量选择').disabled,true);
  fail=true;release();await change;
  assert.equal(t.plugin.settings.recursive,true,'failed persistence restores setting');
  assert.equal(scope.value,true);
  assert.equal(renderer.scanStatus,'stale','a failed write cannot revive old index');
  await t.close();
});

test('navigation blocks existing page writes and allows a new view initial scan',async()=>{
  const t=await fixture();
  let release;
  t.leaf.openFile=()=>new Promise(resolve=>{release=resolve;});
  const navigation=t.plugin.openHome(t.home.path);
  await waitFor(()=>typeof release==='function','navigation pending');
  const root=t.pane.contentEl;
  const composer=root.querySelector('.ex-compose-text');
  composer.value='不能在导航期间保存';composer.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  assert.equal(root.querySelector('.ex-btn-primary').disabled,true);
  root.querySelector('.ex-btn-primary').click();
  assert.equal([...t.files.keys()].filter(path=>path.endsWith('.md')).length,1);
  assert.equal(root.querySelector('.ex-search').disabled,true);
  // Native loading of the target view does not use the page action guard.
  await t.pane.onUnloadFile(t.home);
  const second=t.plugin.factory({});
  document.body.append(second.contentEl);
  await second.openFile(t.home);
  await waitFor(()=>second.contentEl.querySelector('.ex-scan-text')?.textContent==='已扫描 · 1 条',
    'initial scan during navigation');
  release();await navigation;
  assert.equal(second.contentEl.querySelector('.ex-compose-actions .ex-open-editor').disabled,false);
  await second.onUnloadFile(t.home);second.contentEl.remove();
  await t.close();
});

test('stale index freezes existing bulk selection while allowing exit',async()=>{
  const t=await fixture();const root=t.pane.contentEl;
  clickByLabel(root,'页面选项');
  Menu.last.items.find(x=>x.title==='批量选择').handler();
  const renderer=[...t.plugin.rendered][0];
  assert.equal(renderer.selectionMode,'selecting');
  renderer.markStale(t.md.path);
  assert.equal(root.querySelector('.ex-select-all').disabled,true);
  root.querySelector('.ex-card').click();
  assert.equal(renderer.selectedPaths.size,0);
  await renderer.toggleSelectAll();
  assert.equal(renderer.selectedPaths.size,0);
  root.querySelector('.ex-select-done').click();
  assert.equal(renderer.selectionMode,'normal');
  assert.equal(renderer.scanStatus,'stale');
  await t.close();
});

test('tag menu is capped and tag picker reuses the same index between input events',async()=>{
  const t=await fixture();const renderer=[...t.plugin.rendered][0];
  for(let i=0;i<60;i++)await t.plugin.app.vault.create('摘录/标签-'+i+'.md','文本'+i);
  t.plugin.app.metadataCache.getFileCache=file=>({
    tags:[{tag:'#tag-'+file.basename}],frontmatter:{tags:[]}
  });
  t.plugin.refreshViews(true);
  await waitFor(()=>renderer.scanStatus==='done'&&renderer.items.length===61,'tag scan');
  const tags=renderer.availableTags;
  assert.equal(tags.length,61);
  clickByLabel(t.pane.contentEl,'筛选标签');
  const more=[...t.pane.contentEl.querySelectorAll('.ex-filter-tags button')]
    .find(button=>button.textContent.startsWith('更多标签'));
  assert.ok(more);more.click();
  assert.equal(Menu.last.items.length,41,'only 40 selectable tags and one message');
  assert.equal(Menu.last.items.at(-1).disabled,true);
  clickByLabel(t.pane.contentEl,'添加标签');
  const input=t.pane.contentEl.querySelector('.ex-tags-input');
  for(const q of ['tag-','tag-标签-1','tag-标签-12']){
    input.value=q;input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
    assert.equal(renderer.availableTags,tags,'typing never rebuilds or sorts the index');
  }
  assert.ok(t.pane.contentEl.querySelectorAll('.ex-capture-tags .ex-tag-choice').length<=9);
  await t.close();
});
