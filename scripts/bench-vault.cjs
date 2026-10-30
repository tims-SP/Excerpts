/* G3 diagnostic benchmark: real temporary Markdown files, simulated Obsidian APIs.
 * Measures the repository path; NOT native Obsidian MetadataCache or MarkdownRenderer.
 * No speed thresholds: measurements are evidence, not release gates.
 */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const { performance } = require("node:perf_hooks");
const ts = require("typescript");

const count = Number(process.argv[2]);
const output = process.argv[3];
if (![1000, 10000, 30000].includes(count) || !output)
  throw Error("Usage: node --expose-gc scripts/bench-vault.cjs 1000|10000|30000 output.json");

class TFile {
  constructor(filePath, size, tag, i) {
    this.path = filePath;
    this.basename = path.posix.basename(filePath, ".md");
    this.extension = "md";
    this.stat = { size, mtime: 1800000000000 + i, ctime: 1790000000000 + i };
    this.metadata = {
      frontmatter: { tags: [tag] },
      tags: i % 5 === 0 ? [{ tag: "#inline" }] : []
    };
  }
}
class TFolder { constructor(filePath) { this.path = filePath; } }
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "obsidian") return {
    TFile, TFolder,
    getAllTags(metadata) {
      return [...(metadata.tags || []).map(t => t.tag),
        ...(metadata.frontmatter?.tags || []).map(t => "#" + t)];
    }
  };
  return originalLoad.apply(this, arguments);
};
require.extensions[".ts"] = (mod, filePath) => {
  const src = fs.readFileSync(filePath, "utf8");
  const compiled = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  });
  mod._compile(compiled.outputText, filePath);
};
const { EntryRepository } = require("../src/repository.ts");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "excerpts-g3-"));
const directory = path.join(tmp, "摘录");
let readCount = 0;
let readBytes = 0;
let metadataLookups = 0;
const fileList = [];
const fileMap = new Map();
const diskPaths = new Map();

function mib(bytes) { return Math.round(bytes / 1048576 * 100) / 100; }
function ms(value) { return Math.round(value * 100) / 100; }
function sampleMemory() {
  const m = process.memoryUsage();
  return { heapMiB: mib(m.heapUsed), rssMiB: mib(m.rss) };
}
function generatedMarkdown(i) {
  const tag = ["文学", "想法", "生活", "对白"][i % 4];
  const frontmatter = "---\ntags:\n  - " + tag + "\n---\n\n";
  const text = "# 摘录 " + i + "\n\n" +
    ("这是第 " + i + " 条固定语料，用于衡量 Markdown 文件读取和解析。 ")
      .repeat(i % 25 === 0 ? 40 : 4);
  if (i % 50 === 0) return frontmatter + text +
    "\n\n## 上下文\n\n" + "第一组正文内容。".repeat(35) +
    "\n\n## 备注\n\n" + "第二组正文内容。".repeat(35);
  if (i % 50 === 1) return frontmatter + text +
    "\n\n![[示例图片.png]]\n\n![[示例视频.mp4]]\n";
  if (i % 50 === 2) return frontmatter + text +
    "\n\n" + "较长摘录段落，用来构造不同大小的文档。".repeat(170);
  return frontmatter + text + (i % 5 === 0 ? "\n\n#inline\n" : "\n");
}
async function stage(label, fn) {
  const startReads = readCount, startBytes = readBytes, startMetadata = metadataLookups;
  const start = performance.now();
  const result = await fn();
  return {
    label, wallMs: ms(performance.now() - start),
    fileReads: readCount - startReads,
    fileReadMiB: mib(readBytes - startBytes),
    metadataLookups: metadataLookups - startMetadata,
    memory: sampleMemory(),
    ...result
  };
}
async function run() {
  try {
    fs.mkdirSync(directory);
    let fixtureBytes = 0;
    for (let i = 0; i < count; i++) {
      const relative = "摘录/记录-" + String(i).padStart(6, "0") + ".md";
      const physical = path.join(directory, path.basename(relative));
      const body = generatedMarkdown(i);
      fs.writeFileSync(physical, body, "utf8");
      const size = Buffer.byteLength(body, "utf8");
      fixtureBytes += size;
      const file = new TFile(relative, size, ["文学", "想法", "生活", "对白"][i % 4], i);
      fileList.push(file);
      fileMap.set(relative, file);
      diskPaths.set(relative, physical);
    }
    const vault = {
      getMarkdownFiles: () => fileList,
      getAbstractFileByPath: filePath => fileMap.get(filePath) || null,
      async cachedRead(file) {
        const raw = await fsp.readFile(diskPaths.get(file.path), "utf8");
        readCount++; readBytes += Buffer.byteLength(raw, "utf8");
        return raw;
      },
      async read(file) { return this.cachedRead(file); }
    };
    const app = {
      vault,
      metadataCache: {
        getFileCache(file) { metadataLookups++; return file.metadata; }
      },
      workspace: { getLeavesOfType: () => [] }
    };
    const repo = new EntryRepository(app);
    const ws = { kind: "file", rootFolder: "摘录", homePath: "摘录/首页.excerpts", recursive: true };
    if (global.gc) global.gc();
    const initialMemory = sampleMemory();
    let cards;
    const steps = [];
    const scan = await stage("scan-index-only", async () => {
      cards = await repo.scan(ws, 64, (done, total) => {
        assert.equal(total, count); steps.push(done);
      }, () => false);
      assert.equal(cards.length, count);
      assert.equal(steps.at(-1), count);
      return { cards: cards.length, batches: steps.length - 1 };
    });
    assert.equal(scan.fileReads, 0, "Metadata-only scan must never read Markdown files");
    const missing = "zzq-unique-search-term-absent";
    const cold = await stage("fulltext-repository-cold", async () => {
      const matches = await repo.search(cards, missing, () => false);
      assert.equal(matches.size, 0);
      return { matches: matches.size };
    });
    const warm = await stage("fulltext-repository-warm", async () => {
      const matches = await repo.search(cards, "zzq-another-absent-term", () => false);
      assert.equal(matches.size, 0);
      return { matches: matches.size };
    });
    const sampleCount = Math.min(64, count);
    const previews = await stage("preview-source-read-64", async () => {
      let totalSections = 0;
      for (let i = 0; i < sampleCount; i++) {
        const target = fileList[Math.floor(i * count / sampleCount)];
        const parsed = await repo.readSnapshot(target.path, true);
        totalSections += parsed.parsed.sections.length;
        assert.ok(parsed.raw.includes("摘录"));
      }
      return { documents: sampleCount, h2Sections: totalSections };
    });
    // Distribution checks use exactly the same generated on-disk Markdown.
    // Metadata-only queries should be able to match without reading any body.
    const indexed = await stage("filename-index-match", async () => {
      const matches = await repo.search(cards, "记录-", () => false);
      assert.equal(matches.size, count);
      return { matches: matches.size };
    });
    assert.equal(indexed.fileReads, 0, "filename-index matches must not read note bodies");
    const lastBody = await stage("body-last-file-match", async () => {
      const matches = await repo.search(cards,
        "这是第 " + (count - 1) + " 条固定语料", () => false);
      assert.equal(matches.size, 1, "only the last generated body has that exact phrase");
      assert.equal(matches.has(fileList.at(-1).path), true);
      return { matches: matches.size };
    });
    const frequentBody = await stage("body-many-matches", async () => {
      const matches = await repo.search(cards, "固定语料", () => false);
      assert.equal(matches.size, count);
      return { matches: matches.size };
    });
    let cancelChecks = 0;
    const interrupted = await stage("early-cancel", async () => {
      const matches = await repo.search(cards, "z-probe-cancel-no-match",
        () => ++cancelChecks >= 6);
      assert.equal(matches.size, 0);
      return { matches: matches.size, cancelChecks };
    });
    // Search cache is bounded, not an unbounded persistent full-text index.
    // Repeated full searches reveal actual cache rereads and retained JS heap.
    const rounds = count <= 1000 ? 20 : count <= 10000 ? 10 : 3;
    const samples = [];
    const repeated = await stage("repeated-fulltext-searches", async () => {
      for (let i = 0; i < rounds; i++) {
        const matches = await repo.search(cards, "zzq-bounded-repeat-" + i, () => false);
        assert.equal(matches.size, 0);
        if (i === 0 || i === Math.floor(rounds / 2) || i === rounds - 1) {
          if (global.gc) global.gc();
          samples.push({ completed: i + 1, memory: sampleMemory() });
        }
      }
      return { rounds, gcSampledMemory: samples };
    });
    const data = {
      schema: 2,
      scope: "real local Markdown files + simulated Obsidian Vault/MetadataCache adapter",
      excluded: [
        "actual Obsidian Vault internal scanning and metadata parsing",
        "actual Obsidian MarkdownRenderer, images or videos",
        "OS cold disk cache guarantee, real user vaults and mobile devices"
      ],
      count, fixtureMiB: mib(fixtureBytes), node: process.version,
      platform: process.platform, architecture: process.arch,
      initialMemory, stages: [scan, cold, warm, previews, indexed,
        lastBody, frequentBody, interrupted, repeated]
    };
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(data, null, 2) + "\n");
    console.log("G3_METRICS " + JSON.stringify(data));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}
run().catch(err => { console.error(err); process.exitCode = 1; });
