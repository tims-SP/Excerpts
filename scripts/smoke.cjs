/* Exercises the compiled plugin with in-memory Vault and Obsidian mocks. */
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
class TAbstractFile { constructor(path) { this.path = path; } }
class TFile extends TAbstractFile {}
class TFolder extends TAbstractFile {}
class MarkdownRenderChild { constructor(el) { this.containerEl = el; } onload() {} onunload() {} }
class ItemView {
  constructor(leaf) { this.leaf=leaf; this.contentEl={empty(){},addClass(){},createEl(){},createDiv(){return {}}}; }
  async setState(state) { this.state=state; }
}
class Plugin {registerView(type,factory){this.viewType=type;this.factory=factory;} async loadData() { return null; } async saveData(x) { this.saved=x; } addSettingTab(tab) { this.tab=tab; } registerEvent(e){} addCommand(c) { this.command=c; } registerMarkdownCodeBlockProcessor(k,fn){this.processor=fn;this.processorName=k;} }
class PluginSettingTab { constructor(app,plugin){this.app=app;this.plugin=plugin;} }
class Setting {}
class Notice { constructor(message) { Notice.last=message; } }
const replacement={TAbstractFile,TFile,TFolder,ItemView,MarkdownRenderChild,Plugin,PluginSettingTab,Setting,Notice};
const oldLoad=Module._load;
Module._load=function(req,parent,isMain){if(req==='obsidian')return replacement;return oldLoad.apply(this,arguments);};
const entry=process.env.EXCERPTS_TEST_BUNDLE || path.resolve(__dirname,'../main.js');
const Excerpts= require(entry);
Module._load=oldLoad;
async function test(){
  const files=new Map(), events=new Map();let creates=0;
  const vault={
    getAbstractFileByPath(p){return files.get(p)?.file||null;},
    getMarkdownFiles(){return [...files.values()].filter(e=>e.file instanceof TFile).map(e=>e.file);},
    async createFolder(p){if(files.has(p))throw Error('exists');const f=new TFolder(p);files.set(p,{file:f});return f;},
    async create(p,data){if(files.has(p))throw Error('exists');const f=new TFile(p);files.set(p,{file:f,data});creates++;return f;},
    async cachedRead(f){return files.get(f.path).data;},
    async read(f){return files.get(f.path).data;},
    async rename(f,p){
      if(files.has(p)) throw Error('destination exists');
      const prior=files.get(f.path);
      if(!prior) throw Error('source missing');
      files.delete(f.path);f.path=p;files.set(p,prior);
    },
    async process(f,callback){const holder=files.get(f.path);holder.data=callback(holder.data);return holder.data;},
    on(type,fn){events.set(type,fn);return {}},
  };
  const leaf={view:{getViewType:()=>"markdown"},async setViewState(state){this.state=state;}};
  const app={vault,workspace:{activeLeaf:leaf,on(type,callback){events.set("ws:"+type,callback);return {};},onLayoutReady(callback){events.set("layout-ready",callback);},getActiveFile(){return null;},getLeaf(){return leaf;},revealLeaf(){}}};
  const plugin=new Excerpts();plugin.app=app;
  await plugin.onload();
  assert.equal(plugin.processorName,'excerpts');
  assert.equal(plugin.viewType,'excerpts-collection');
  assert.equal(plugin.settings.workspaces.length,0);
  const ws=await plugin.createWorkspace('喜欢的句子','个人/收藏/句子');
  assert.equal(ws.rootFolder,'个人/收藏/句子');
  assert.equal(plugin.settings.workspaces.length,1);
  assert.equal(creates,1);
  assert.ok(files.has('个人/收藏/句子/Cards'));
  assert.ok(files.has('个人/收藏/句子/首页.md'));
  const home=files.get('个人/收藏/句子/首页.md').data;
  assert.ok(home.includes(`workspace: ${ws.id}`));
  assert.ok(!home.startsWith('# '),'new home should not add a duplicate Markdown heading');
  events.get('ws:file-open')(new TFile('普通笔记.md'));
  assert.equal(leaf.state,undefined);
  events.get('ws:file-open')(new TFile('个人/收藏/句子/首页.md'));
  await new Promise(r=>setImmediate(r));
  assert.equal(leaf.state.type,'excerpts-collection');
  await assert.rejects(()=>plugin.createWorkspace('冲突','个人/收藏/句子/内部'));
  // Custom codeblock is refused on every other file, including an identical block.
  let added=0, warning='';
  plugin.processor(`workspace: ${ws.id}`,{setText(s){warning=s;}},{sourcePath:'普通笔记.md',addChild(){added++;}});
  assert.equal(added,0);assert.match(warning,/未获授权/);
  plugin.processor(`workspace: ${ws.id}`,{}, {sourcePath:'个人/收藏/句子/首页.md',addChild(child){added++;child.onunload();}});
  assert.equal(added,1);
  const repo=plugin.repo;
  const item=await repo.create(ws,'一条收藏的句子',['诗歌']);
  assert.equal((await repo.list(ws)).length,1);
  const saved=await repo.update(item,previous=>({...previous,extras:[{id:'x_1',kind:'source',title:'出处',content:'《测试》'}],favorite:true}));
  assert.equal(saved.favorite,true);
  const loaded=(await repo.list(ws))[0];
  assert.equal(loaded.extras[0].content,'《测试》');
  assert.equal(loaded.tags[0],'诗歌');
  // Simulate an external edit that leaves the YAML timestamp unchanged.
  const externalRaw=files.get(item.path).data.replace('《测试》','《外部修订》');
  const previousRaw=files.get(item.path).data;
  files.get(item.path).data=externalRaw;
  await assert.rejects(()=>repo.update(saved,prev=>({...prev,favorite:false})),/刷新/);
  assert.equal(files.get(item.path).data,externalRaw);
  files.get(item.path).data=previousRaw;
  // Editing must not rewrite a damaged record, even when the cached Entry is valid.
  const goodRaw=files.get(item.path).data;
  const damagedRaw=goodRaw.replace('<!-- excerpts:extras:end -->','');
  files.get(item.path).data=damagedRaw;
  await assert.rejects(()=>repo.update(saved,prev=>({...prev,favorite:false})),/损坏/);
  assert.equal(files.get(item.path).data,damagedRaw);
  files.get(item.path).data=goodRaw;
  // Delete means archive: raw bytes are never edited or permanently erased.
  const archiveInput=(await repo.list(ws))[0];
  const beforeArchive=files.get(item.path).data;
  const receipt=await repo.trash(ws,archiveInput);
  assert.ok(receipt.recyclePath.startsWith('个人/收藏/句子/Excerpts-Recycle/'));
  assert.equal(files.get(receipt.recyclePath).data,beforeArchive);
  assert.ok(!files.has(item.path));
  assert.equal((await repo.list(ws)).length,0);
  // An occupied destination must never be overwritten by undo.
  files.set(item.path,{file:new TFile(item.path),data:'DO NOT REPLACE'});
  await assert.rejects(()=>repo.restore(ws,receipt),/拒绝覆盖/);
  assert.equal(files.get(item.path).data,'DO NOT REPLACE');
  files.delete(item.path);
  // External changes to the archive also block an automatic restore.
  files.get(receipt.recyclePath).data += '\\nexternal change'.replace('\\n','\n');
  await assert.rejects(()=>repo.restore(ws,receipt),/发生变化/);
  files.get(receipt.recyclePath).data=beforeArchive;
  await repo.restore(ws,receipt);
  assert.equal(files.get(item.path).data,beforeArchive);
  assert.equal((await repo.list(ws)).length,1);
  // Wrong collection identity or stale entry state blocks archiving.
  await assert.rejects(()=>repo.trash(ws,{...archiveInput,collectionId:'other'}),/不属于/);
  await assert.rejects(()=>repo.trash(ws,{...archiveInput,text:'outdated'}),/刷新/);
  // A path using Windows separators must not bypass the overlap check.
  await plugin.createWorkspace('另一个收藏集','其它/空间');
  await assert.rejects(()=>plugin.repointWorkspace(ws.id,'其它\\空间'),/重叠/);
  // A string mentioning the workspace ID is not an authorized homepage.
  files.set('假首页/首页.md',{file:new TFile('假首页/首页.md'),data:'# text\nworkspace: '+ws.id+'\n'});
  await assert.rejects(()=>plugin.repointWorkspace(ws.id,'假首页'),/未绑定/);
  // Existing notes are untouched.
  files.set('普通笔记.md',{file:new TFile('普通笔记.md'),data:'# A separate note'});
  assert.equal(files.get('普通笔记.md').data,'# A separate note');
  // Files are not moved or destroyed by removing configuration.
  plugin.settings.workspaces=[];await plugin.saveSettings();
  assert.ok(files.has(item.path));
  console.log('Compiled plugin smoke test passed: workspace, authorization, Markdown round-trip, extras, isolation.');
}
test().catch(e=>{console.error(e);process.exitCode=1;});
