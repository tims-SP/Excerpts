/* Build smoke: normal Markdown files become cards, no private schema or home file. */
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
class TAbstractFile { constructor(p) { this.path=p; } }
class TFile extends TAbstractFile {
  constructor(p) { super(p); this.basename=p.split('/').pop().replace(/\.md$/i,''); this.stat={mtime:100,ctime:50,size:0}; }
}
class TFolder extends TAbstractFile {}
class MarkdownRenderChild {
  constructor(el) { this.containerEl=el; }
  load() { this.onload?.(); }
  unload() { this.onunload?.(); }
  addChild() {}
  removeChild() {}
}
class ItemView { constructor(leaf) { this.leaf=leaf; this.contentEl={empty(){},addClass(){},createEl(){},createDiv(){return {}}}; } async setState(state) {this.state=state;} }
class Plugin {
  async loadData() {return null;} async saveData(s) {this.saved=s;}
  registerView(k,fn) {this.viewType=k;this.factory=fn;}
  addSettingTab(){} addCommand(){} registerEvent(){}
}
class PluginSettingTab { constructor(app,plugin) {this.app=app;this.plugin=plugin;} }
class Setting {}
class Notice {constructor(message) {Notice.last=message;} }
const mocks={
  TAbstractFile,TFile,TFolder,MarkdownRenderChild,ItemView,Plugin,PluginSettingTab,Setting,Notice,
  MarkdownRenderer:{render:async()=>{}},setIcon(){},
  getAllTags(cache) { return [...(cache.tags||[]).map(t=>t.tag),...(cache.frontmatter?.tags||[]).map(t=>'#'+t)]; }
};
const original=Module._load;
Module._load=function(request,parent,isMain){if(request==='obsidian')return mocks;return original.apply(this,arguments);};
const Excerpts=require(path.resolve(__dirname,'../main.js'));
Module._load=original;
async function main(){
  const files=new Map(), events=new Map();
  const vault={
    getAbstractFileByPath(p){return files.get(p)?.file||null;},
    getMarkdownFiles(){return [...files.values()].filter(x=>x.file instanceof TFile).map(x=>x.file);},
    async createFolder(p){files.set(p,{file:new TFolder(p)});},
    async create(p,data){const file=new TFile(p);file.stat.size=data.length;files.set(p,{file,data});return file;},
    async cachedRead(f){return files.get(f.path).data;},
    async read(f){return files.get(f.path).data;},
    on(type,handler){events.set(type,handler);return {};}
  };
  const app={
    vault,
    metadataCache:{ getFileCache(){return {frontmatter:{tags:['文学']},tags:[]};},on(){return {};}},
    fileManager:{async processFrontMatter(file,fn){const yaml={tags:['文学']};fn(yaml);}},
    workspace:{getLeaf(){return {async setViewState(){},async openFile(){}};},async revealLeaf(){}}
  };
  const plugin=new Excerpts();plugin.app=app;await plugin.onload();
  assert.equal(plugin.viewType,'excerpts-collection');
  const ws=await plugin.createWorkspace('文学','资料/摘录');
  assert.ok(files.has('资料/摘录'));
  assert.ok(!files.has('资料/摘录/首页.md'));
  assert.ok(!files.has('资料/摘录/Cards'));
  await vault.create('资料/摘录/自然.md','# 自然\n\n普通 Markdown\n\n## 批注\n\n我的想法');
  await vault.create('资料/摘录/子目录.md','# 子目录');
  const cards=plugin.repo.list(ws);
  assert.equal(cards.length,2);
  assert.deepEqual(cards[0].tags,['文学']);
  const parsed=await plugin.repo.read('资料/摘录/自然.md');
  assert.equal(parsed.title,'自然');
  assert.equal(parsed.sections[0].name,'批注');
  await plugin.repo.setFavorite('资料/摘录/自然.md',true);
  await plugin.repo.setTag('资料/摘录/自然.md','哲学',true);
  const newFile=await plugin.repo.create(ws);
  assert.match(newFile.path,/摘录-\d{8}-\d{6}\.md/);
  assert.equal(files.get('资料/摘录/自然.md').data,'# 自然\n\n普通 Markdown\n\n## 批注\n\n我的想法');
  console.log('Markdown-first smoke passed');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
