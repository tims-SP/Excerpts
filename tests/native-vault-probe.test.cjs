const { test } = require("node:test");
const assert = require("node:assert/strict");
const probe = require("../scripts/native-vault-probe.cjs");

function host(size = 3) {
  const folder = { path: "G3-测试", children: [] };
  const files = Array.from({length: size}, (_, i) => ({
    path: "G3-测试/摘录-" + i + ".md", extension: "md"
  }));
  const byPath = new Map([[folder.path, folder], ...files.map(file => [file.path, file])]);
  const events = { scanned: 0, searched: 0, metadata: 0, writes: 0, busy: false };
  const vault = {
    getAbstractFileByPath: path => byPath.get(path) ?? null,
    getMarkdownFiles: () => files,
    create() { events.writes++; throw Error("unexpected create"); },
    modify() { events.writes++; throw Error("unexpected modify"); },
    process() { events.writes++; throw Error("unexpected process"); },
    trash() { events.writes++; throw Error("unexpected trash"); }
  };
  const repo = {
    async scan(ws, stride, progress, cancelled) {
      assert.equal(ws.rootFolder, folder.path);
      assert.equal(stride, 64);
      assert.equal(cancelled(), false);
      events.scanned++;
      progress(0, size);
      progress(size, size);
      return files.map(file => ({ path: file.path }));
    },
    async search(cards, term, cancelled) {
      assert.equal(cards.length, files.length);
      assert.match(term, /EXCERPTS_NATIVE_DIAGNOSTIC/);
      assert.equal(cancelled(), false);
      events.searched++;
      return new Set();
    }
  };
  const plugin = {
    repo, settings: { scanBatchSize: 64 },
    isBusy: () => events.busy,
    workspaceForFolder: value => {
      assert.equal(value, folder);
      return { kind: "folder", rootFolder: value.path, homePath: value.path, sourceFolder: value, recursive: true };
    }
  };
  const app = {
    vault, metadataCache: { getFileCache(file) {
      assert.ok(files.includes(file)); events.metadata++;
      return {frontmatter:{tags:[]}};
    }},
    plugins: {plugins:{excerpts:plugin}}
  };
  const runtime = {
    performance: {now: () => 100 + events.metadata + events.searched, memory: {usedJSHeapSize:10485760}},
    document: {querySelectorAll:()=>Array.from({length:2})}
  };
  const config = {confirm:"READ_ONLY_DIAGNOSTICS",folderPath:folder.path,maxFiles:100,measureSearch:true};
  return {app,plugin,folder,files,byPath,events,runtime,config};
}

test("native diagnostic only calls read-only Vault/MetadataCache/repository methods", async () => {
  const t = host();
  const data = await probe(t.app, t.config, t.runtime);
  assert.equal(data.markdownFiles,3);
  assert.equal(data.repositoryScanMs>=0,true);
  assert.equal(data.metadataLookupsMs>=0,true);
  assert.equal(data.searches.length,2);
  assert.equal(data.visibleExcerptCards,2);
  assert.equal(data.finalHeapMiB,10);
  assert.equal(t.events.scanned,1);
  assert.equal(t.events.metadata,3);
  assert.equal(t.events.searched,2);
  assert.equal(t.events.writes,0);
  assert.equal(JSON.stringify(data).includes(t.folder.path),false,"no test folder name in published metrics");
  assert.equal(JSON.stringify(data).includes(t.files[0].path),false,"no excerpt paths leaked");
});

test("native diagnostic rejects unconfirmed, whole-vault and oversized operations before scanning", async () => {
  const t = host(101);
  const original = {...t.config};
  await assert.rejects(probe(t.app,{...original,confirm:""},t.runtime),/确认/);
  await assert.rejects(probe(t.app,{...original,folderPath:"/"},t.runtime),/文件夹路径/);
  await assert.rejects(probe(t.app,{...original,folderPath:"missing"},t.runtime),/不是.*文件夹/);
  await assert.rejects(probe(t.app,original,t.runtime),/超过 maxFiles/);
  await assert.rejects(probe(t.app,{...original,maxFiles:30000},t.runtime),/allowLargeScan/);
  assert.equal(t.events.scanned,0);
  assert.equal(t.events.writes,0);
});

test("native diagnostic refuses to race another active plugin operation", async () => {
  const t=host();
  t.events.busy=true;
  await assert.rejects(probe(t.app,t.config,t.runtime),/其他摘录操作/);
  assert.equal(t.events.scanned,0);
});

test("native diagnostic refuses partial or cancelled scan results", async () => {
  const t=host();
  t.plugin.repo.scan = async () => null;
  await assert.rejects(probe(t.app,t.config,t.runtime),/中止或结果不完整/);
  assert.equal(t.events.writes,0);
});

test("native diagnostic aborts if the selected source folder is replaced while scanning", async () => {
  const t=host();
  t.plugin.repo.scan=async () => {
    t.byPath.set(t.folder.path, {path:t.folder.path,children:[]});
    return t.files.map(file => ({path:file.path}));
  };
  await assert.rejects(probe(t.app,t.config,t.runtime),/其他摘录操作|文件夹已移动或替换/);
  assert.equal(t.events.searched,0);
  assert.equal(t.events.writes,0);
});

test("native diagnostic permits a metadata-only measurement without fulltext reads", async () => {
  const t=host();
  const report=await probe(t.app,{...t.config,measureSearch:false},t.runtime);
  assert.deepEqual(report.searches,[]);
  assert.equal(t.events.searched,0);
  assert.equal(t.events.scanned,1);
});
