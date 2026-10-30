/* G3 native Obsidian diagnostic. Paste the whole file into Obsidian desktop DevTools.
 * No vault writes, UI changes, locks, cache invalidation or automatic refresh.
 * Usage: configure globalThis.__EXCERPTS_NATIVE_PROBE_CONFIG__ first.
 * Node tests: require("./native-vault-probe.cjs") exports runNativeVaultProbe.
 */
"use strict";
async function runNativeVaultProbe(app, config, runtime = globalThis) {
  const allowedSizes = [100, 1000, 10000, 30000];
  if (!config || config.confirm !== "READ_ONLY_DIAGNOSTICS")
    throw Error("请先在独立测试 Vault 中明确确认只读诊断");
  if (!allowedSizes.includes(config.maxFiles))
    throw Error("maxFiles 仅允许 100、1000、10000、30000");
  if (config.maxFiles === 30000 && config.allowLargeScan !== true)
    throw Error("30,000 条诊断需要额外设置 allowLargeScan: true");
  const folderPath = config.folderPath;
  if (typeof folderPath !== "string" || !folderPath || folderPath.startsWith("/") ||
      folderPath.includes("\\") || folderPath.split("/").some(part => !part || part === "." || part === ".."))
    throw Error("必须指定 Vault 内的实际测试文件夹路径，不允许扫描整个 Vault");
  if (!app?.vault?.getMarkdownFiles || !app?.vault?.getAbstractFileByPath ||
      !app?.metadataCache?.getFileCache)
    throw Error("需要真实 Obsidian Vault 和 MetadataCache 环境");
  const plugin = app.plugins?.plugins?.excerpts;
  if (!plugin?.repo?.scan || !plugin.repo.search || !plugin.workspaceForFolder ||
      !plugin.isBusy || !plugin.settings)
    throw Error("Excerpts 插件未启用或版本不支持此诊断脚本");
  const folder = app.vault.getAbstractFileByPath(folderPath);
  if (!folder || folder.path !== folderPath || !Array.isArray(folder.children))
    throw Error("指定路径不是当前 Vault 中已存在的文件夹");
  const recursive = config.recursive !== false;
  const belongs = filePath => filePath.startsWith(folderPath + "/") &&
    (recursive || !filePath.slice(folderPath.length + 1).includes("/"));
  const wallNow = () => runtime.performance && typeof runtime.performance.now === "function"
    ? runtime.performance.now() : Date.now();
  const heap = () => {
    const used = runtime.performance?.memory?.usedJSHeapSize;
    // Entire JS heap when present, never plugin-attributed, never an RSS estimate.
    return typeof used === "number" && Number.isFinite(used)
      ? Math.round(used / 1048576 * 100) / 100 : null;
  };
  const elapsed = start => Math.round((wallNow() - start) * 100) / 100;
  const guard = () => {
    if (plugin.isBusy()) throw Error("其他摘录操作尚未完成，请在空闲状态重新运行");
    if (app.vault.getAbstractFileByPath(folderPath) !== folder)
      throw Error("测试文件夹已移动或替换，拒绝继续");
  };
  guard();
  const listingStart = wallNow();
  const scopedFiles = app.vault.getMarkdownFiles().filter(file =>
    file.extension?.toLowerCase() === "md" && belongs(file.path));
  const listingMs = elapsed(listingStart);
  if (!scopedFiles.length) throw Error("指定文件夹没有 Markdown 文档");
  if (scopedFiles.length > config.maxFiles)
    throw Error("测试目录的 Markdown 数量超过 maxFiles，拒绝执行完整扫描");
  guard();
  const metadataStart = wallNow();
  for (const file of scopedFiles) {
    app.metadataCache.getFileCache(file);
    if (app.vault.getAbstractFileByPath(file.path) !== file)
      throw Error("测试目录中有文件在读取元数据期间发生变化");
  }
  const metadataMs = elapsed(metadataStart);
  guard();
  const workspace = plugin.workspaceForFolder(folder);
  // Match the recursive flag explicitly, without changing plugin settings.
  workspace.recursive = recursive;
  const batchSize = plugin.settings.scanBatchSize;
  let batches = 0;
  const scanStart = wallNow();
  const cards = await plugin.repo.scan(workspace, batchSize, () => { batches++; },
    () => plugin.isBusy() || app.vault.getAbstractFileByPath(folderPath) !== folder);
  if (!cards || cards.length !== scopedFiles.length)
    throw Error("扫描已中止或结果不完整，不能保存诊断结果");
  const scanMs = elapsed(scanStart);
  guard();

  const report = {
    schema: 1,
    scope: "native Obsidian Vault + MetadataCache + Excerpts repository; read-only test folder",
    exclusions: [
      "OS cold disk cache is not guaranteed",
      "Repository search cache may already be warm; no invalidation is performed",
      "No MarkdownRenderer timing, media decoding, frame recording or peak memory",
      "No mobile device or cross-run latency acceptance implied"
    ],
    markdownFiles: scopedFiles.length,
    recursive, batchSize,
    listingMs, metadataLookupsMs: metadataMs, repositoryScanMs: scanMs,
    progressCallbacks: batches,
    initialHeapMiB: heap(),
    searches: [],
    finalHeapMiB: null,
    visibleExcerptCards: null
  };
  if (config.measureSearch === true) {
    // Use two distinct, very unlikely strings to force traversal. Only counts are retained;
    // the diagnostic does not include note paths or plaintext in its result.
    for (const label of ["first", "second"]) {
      guard();
      const start = wallNow();
      const matches = await plugin.repo.search(cards,
        "__EXCERPTS_NATIVE_DIAGNOSTIC_" + label + "_NO_MATCH__",
        () => plugin.isBusy() || app.vault.getAbstractFileByPath(folderPath) !== folder);
      guard();
      report.searches.push({
        pass: label, wallMs: elapsed(start), matchCount: matches.size,
        jsHeapMiB: heap()
      });
    }
  }
  report.finalHeapMiB = heap();
  const dom = runtime.document;
  if (dom?.querySelectorAll)
    report.visibleExcerptCards = dom.querySelectorAll(".excerpts-native-host .ex-card").length;
  guard();
  return report;
}
if (typeof module !== "undefined" && module.exports)
  module.exports = runNativeVaultProbe;
if (typeof globalThis !== "undefined" && globalThis.app &&
    globalThis.__EXCERPTS_NATIVE_PROBE_CONFIG__) {
  void runNativeVaultProbe(globalThis.app, globalThis.__EXCERPTS_NATIVE_PROBE_CONFIG__, globalThis)
    .then(result => console.info("EXCERPTS_NATIVE_PROBE", JSON.stringify(result)))
    .catch(error => console.error("EXCERPTS_NATIVE_PROBE_FAILED", String(error)));
}
