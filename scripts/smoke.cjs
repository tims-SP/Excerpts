/* Integration smoke without real Obsidian: file extension, scope, no private collection. */
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
class TAbstractFile { constructor(p) { this.path=p; } }
class TFile extends TAbstractFile {
  constructor(p) { super(p); const name=p.split('/').pop(); this.basename=name.replace(/\.[^.]+$/,''); this.extension=name.split('.').pop(); this.stat={mtime:100,ctime:50,size:0}; this.parent={path:p.split('/').slice(0,-1).join('/') || '/'}; }
}
class TFolder extends TAbstractFile {}
class FileView { constructor(leaf) { this.leaf=leaf; this.contentEl={empty(){},addClass(){},createDiv(){return {}}}; } }
class MarkdownRenderChild { constructor(el) { this.containerEl=el; } load(){this.onload?.();} unload(){this.onunload?.();} addChild(){} removeChild(){} }
class Plugin {
  async loadData(){return null;} async saveData(settings){this.saved=settings;}
  registerView(type,factory){this.viewType=type;this.viewFactory=factory;}
  registerExtensions(exts,type){this.extensions={exts,type};}
  addSettingTab(){} addCommand(command){(this.commands??=[]).push(command);} registerEvent(){}
  addRibbonIcon(icon,title,action){this.ribbon={icon,title,action};}
}
class PluginSettingTab { constructor(app,plugin){this.app=app;this.plugin=plugin;} }
class Setting {}
class Notice { constructor(text){Notice.last=text;} }
class Modal { constructor(){this.modalEl={addClass(){}};this.contentEl={empty(){}};} open(){} close(){} }
const mocks={TAbstractFile,TFile,TFolder,FileView,MarkdownRenderChild,Plugin,PluginSettingTab,Setting,Notice,Modal,
  MarkdownRenderer:{async render(){}},setIcon(){},Menu:class {},
  getAllTags(cache){return [...(cache.tags||[]).map(x=>x.tag),...(cache.frontmatter?.tags||[]).map(t=>'#'+t)];}
};
const old=Module._load;
Module._load=function(request,parent,isMain){if(request==='obsidian')return mocks;return old.apply(this,arguments);};
const Excerpts=require(path.resolve(__dirname,'../main.js')); Module._load=old;
async function main(){
  const files=new Map(), events=new Map(), opened=[];
  const vault={
    getAbstractFileByPath(p){return files.get(p)?.file||null;},
    getFiles(){return [...files.values()].filter(x=>x.file instanceof TFile).map(x=>x.file);},
    getAllLoadedFiles(){return [...files.values()].map(x=>x.file);},
    getMarkdownFiles(){return this.getFiles().filter(f=>f.extension==='md');},
    async createFolder(p){files.set(p,{file:new TFolder(p)});},
    async create(p,data){if(files.has(p))throw Error('exists');const file=new TFile(p);file.stat.size=data.length;files.set(p,{file,data});return file;},
    async cachedRead(f){return files.get(f.path).data;},
    on(type,handler){events.set(type,handler);return {};}
  };
  const leaf={async openFile(file){opened.push(file.path);},async setViewState() {}};
  const plugin=new Excerpts();
  plugin.app={vault,metadataCache:{getFileCache(){return {frontmatter:{tags:['文学']},tags:[]};},on(){return {};}}
    ,fileManager:{async processFrontMatter(file,change){change({tags:[]});}}
    ,workspace:{getLeaf(){return leaf;},getLeavesOfType(){return [];},on(){return {};},async revealLeaf(){}}};
  await plugin.onload();
  assert.deepEqual(plugin.extensions,{exts:['excerpts'],type:'excerpts-home-file'});
  assert.equal(plugin.ribbon.title,'打开摘录首页');
  assert.ok(plugin.commands.some(c=>c.id==='open-home'));
  assert.equal(plugin.settings.defaultHome,'');
  const home=await plugin.createHome('资料/摘录');
  assert.equal(home.path,'资料/摘录/首页.excerpts');
  assert.equal((await plugin.createHome('资料/摘录')).path,home.path);
  assert.ok(!files.has('资料/摘录/Cards'));
  assert.ok(!files.has('资料/摘录/首页.md'));
  const ws=plugin.workspaceForHome(home);
  await vault.create('资料/摘录/自然.md','# 自然\n\n普通 Markdown\n\n## 批注\n\n我的想法');
  await vault.create('资料/摘录/子目录.md','普通摘录');
  const scanned=await plugin.repo.scan(ws,plugin.settings.scanBatchSize,()=>{},()=>false);
  assert.equal(scanned.length,2);
  const parsed=await plugin.repo.read('资料/摘录/自然.md');
  assert.equal(parsed.title,'自然');assert.equal(parsed.sections[0].name,'批注');
  const created=await plugin.repo.create(ws,'# 新记录', ['哲学']);
  assert.equal(created.path,'资料/摘录/新记录.md');
  assert.match(files.get(created.path).data,/tags:\n  - "哲学"/);
  assert.match(files.get(created.path).data,/新记录/);
  assert.equal(files.get('资料/摘录/自然.md').data,'# 自然\n\n普通 Markdown\n\n## 批注\n\n我的想法');
  const untitled=await plugin.repo.create(ws,'普通摘录，无明确 H1');
  assert.match(untitled.path,/^资料\/摘录\/摘录 \d{4}-\d\d-\d\d \d\d-\d\d\.md$/);
  // Same-text duplicates, case variants and parallel saves must create distinct files.
  const same=await plugin.repo.create(ws,'# 新记录');
  assert.equal(same.path,'资料/摘录/新记录-2.md');
  await vault.create('资料/摘录/HELLO.md','existing');
  const caseConflict=await plugin.repo.create(ws,'# hello');
  assert.equal(caseConflict.path,'资料/摘录/hello-2.md');
  await vault.create('资料/摘录/Cafe\u0301.md','existing NFD name');
  const normalizedConflict=await plugin.repo.create(ws,'# Café');
  assert.equal(normalizedConflict.path,'资料/摘录/Café-2.md');
  const many=await Promise.all([plugin.repo.create(ws,'# 并发摘录'),plugin.repo.create(ws,'# 并发摘录')]);
  assert.deepEqual(many.map(x=>x.path).sort(),['资料/摘录/并发摘录-2.md','资料/摘录/并发摘录.md'].sort());
  // Simulate an external writer winning the create race.
  const normalCreate=vault.create;
  let race=true;
  vault.create=async function(path,data){
    if(race && path==='资料/摘录/竞态.md'){
      race=false;
      await normalCreate.call(this,path,'created externally');
      throw Error('File already exists');
    }
    return normalCreate.call(this,path,data);
  };
  const retried=await plugin.repo.create(ws,'# 竞态');
  assert.equal(retried.path,'资料/摘录/竞态-2.md');
  assert.equal(files.get('资料/摘录/竞态.md').data,'created externally');
  vault.create=normalCreate;
  // EEXIST can arrive before a remote/cloud Vault index refreshes.
  let stale=true;
  vault.create=async function(path,data){
    if(stale && path==='资料/摘录/延迟同步.md'){
      stale=false;
      throw Object.assign(Error('File already exists'),{code:'EEXIST'});
    }
    return normalCreate.call(this,path,data);
  };
  const delayed=await plugin.repo.create(ws,'# 延迟同步');
  assert.equal(delayed.path,'资料/摘录/延迟同步-2.md');
  vault.create=normalCreate;
  // Propagate unrelated errors, do not silently retry them as conflicts.
  vault.create=async function(path,data){
    if(path==='资料/摘录/写入失败.md')throw Error('permission denied');
    return normalCreate.call(this,path,data);
  };
  await assert.rejects(plugin.repo.create(ws,'# 写入失败'),/permission denied/);
  vault.create=normalCreate;
  plugin.ribbon.action(); await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(opened,[home.path]);
  await plugin.rememberHome(home.path);
  assert.equal(plugin.settings.defaultHome,home.path);
  assert.deepEqual(plugin.getHomeFiles().map(x=>x.path),[home.path]);
  console.log('Markdown-first homepage smoke passed');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
