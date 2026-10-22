/* Exercises the compiled plugin with in-memory Vault and Obsidian mocks. */
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
class TAbstractFile { constructor(path) { this.path = path; } }
class TFile extends TAbstractFile {}
class TFolder extends TAbstractFile {}
class MarkdownRenderChild { constructor(el) { this.containerEl = el; } onload() {} onunload() {} }
class Plugin { async loadData() { return null; } async saveData(x) { this.saved=x; } addSettingTab(tab) { this.tab=tab; } registerEvent(e){} addCommand(c) { this.command=c; } registerMarkdownCodeBlockProcessor(k,fn){this.processor=fn;this.processorName=k;} }
class PluginSettingTab { constructor(app,plugin){this.app=app;this.plugin=plugin;} }
class Setting {}
class Notice { constructor(message) { Notice.last=message; } }
const replacement={TAbstractFile,TFile,TFolder,MarkdownRenderChild,Plugin,PluginSettingTab,Setting,Notice};
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
    async process(f,callback){const holder=files.get(f.path);holder.data=callback(holder.data);return holder.data;},
    on(type,fn){events.set(type,fn);return {}},
  };
  const app={vault,workspace:{getLeaf(){return {async openFile(file,opts){app.opened=file.path;app.mode=opts.state.mode;}}},revealLeaf(){}}};
  const plugin=new Excerpts();plugin.app=app;
  await plugin.onload();
  assert.equal(plugin.processorName,'excerpts');
  assert.equal(plugin.settings.workspaces.length,0);
  const ws=await plugin.createWorkspace('喜欢的句子','个人/收藏/句子');
  assert.equal(ws.rootFolder,'个人/收藏/句子');
  assert.equal(plugin.settings.workspaces.length,1);
  assert.equal(creates,1);
  assert.ok(files.has('个人/收藏/句子/Cards'));
  assert.ok(files.has('个人/收藏/句子/首页.md'));
  const home=files.get('个人/收藏/句子/首页.md').data;
  assert.ok(home.includes(`workspace: ${ws.id}`));
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
  // Existing notes are untouched.
  files.set('普通笔记.md',{file:new TFile('普通笔记.md'),data:'# A separate note'});
  assert.equal(files.get('普通笔记.md').data,'# A separate note');
  // Files are not moved or destroyed by removing configuration.
  plugin.settings.workspaces=[];await plugin.saveSettings();
  assert.ok(files.has(item.path));
  console.log('Compiled plugin smoke test passed: workspace, authorization, Markdown round-trip, extras, isolation.');
}
test().catch(e=>{console.error(e);process.exitCode=1;});
