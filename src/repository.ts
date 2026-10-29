import { App, MarkdownView, TFile, TFolder, getAllTags } from "obsidian";
import { CardIndex, ParsedMarkdown, Workspace, isExcerptPath, validateRelativePath } from "./model";
import { parseMarkdown } from "./codec";
import { excerptFileStem, fitFileStem } from "./naming";

const filenameKey = (path: string): string => path.normalize("NFC").toLocaleLowerCase("en-US");

/** An in-session identity snapshot, not a persistent item ID. */
export interface DeleteCandidate {
  path: string;
  file: TFile;
  mtime: number;
  size: number;
}
export interface DeleteFailure { path: string; reason: string }
export interface DeleteResult { deleted: string[]; failed: DeleteFailure[] }
export interface DeleteProgress {
  processed: number;
  total: number;
  deleted: number;
  failed: number;
}

export class EntryRepository {
  private cache = new Map<string, { file: TFile; stamp: string; parsed: ParsedMarkdown; raw: string }>();
  /** Exact original text for a returned parse, retained only while the parse is referenced. */
  private readonly rawByParsed = new WeakMap<ParsedMarkdown, string>();
  private readonly fileEpochs = new WeakMap<TFile, number>();
  private globalEpoch = 0;
  /** Reusable full-text search material, bounded independently from parsed Markdown. */
  private searchCache = new Map<string, { file: TFile; stamp: string; lowerText: string; bytes: number }>();
  private searchCacheBytes = 0;
  private reservedPaths = new Set<string>();
  constructor(private readonly app: App) {}
  private folderSourceValid(ws: Workspace): boolean {
    if (ws.kind !== "folder") return true;
    const folder = this.app.vault.getAbstractFileByPath(ws.homePath);
    return folder instanceof TFolder && folder === ws.sourceFolder && folder.path === ws.rootFolder;
  }
  private assertFolderSource(ws: Workspace): void {
    if (!this.folderSourceValid(ws))
      throw new Error("文件夹已移动或不存在，请从文件夹右键菜单重新打开摘录");
  }
  async ensureFolder(path: string): Promise<void> {
    let cursor = "";
    for (const part of validateRelativePath(path).split("/")) {
      cursor = cursor ? cursor + "/" + part : part;
      const found = this.app.vault.getAbstractFileByPath(cursor);
      if (found && !(found instanceof TFolder)) throw new Error(cursor + " 已存在同名文件");
      if (!found) await this.app.vault.createFolder(cursor);
    }
  }
  /** Refuse to operate on a moved, deleted, replaced or out-of-scope Markdown file. */
  assertScopedFile(ws: Workspace, path: string, expectedFile: TFile): TFile {
    this.assertFolderSource(ws);
    const current = this.app.vault.getAbstractFileByPath(path);
    if (!(current instanceof TFile) || current !== expectedFile || current.path !== path ||
        current.extension.toLowerCase() !== "md" || !isExcerptPath(path, ws))
      throw new Error("摘录文件已移动、替换或超出文件夹范围，请重新打开");
    return current;
  }
  /** Metadata-only scan. Each batch yields to the UI without reading Markdown bodies. */
  async scan(ws: Workspace, batchSize: number,
    onProgress: (done: number, total: number) => void,
    isCancelled: () => boolean): Promise<CardIndex[] | null> {
    if (isCancelled()) return null;
    this.assertFolderSource(ws);
    const files = this.app.vault.getMarkdownFiles().filter(file => isExcerptPath(file.path, ws));
    const initialPaths = files.map(file => file.path);
    const total = files.length;
    onProgress(0, total);
    const stride = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : 64;
    const cards: CardIndex[] = [];
    for (let start = 0; start < total; start += stride) {
      if (isCancelled()) return null;
      this.assertFolderSource(ws);
      for (let i = start; i < Math.min(total, start + stride); i++) {
        const file = files[i], path = initialPaths[i];
        if (file.path !== path || this.app.vault.getAbstractFileByPath(path) !== file)
          throw new Error("摘录文件在扫描期间发生变化，请手动刷新");
        cards.push(this.indexFile(file));
      }
      onProgress(cards.length, total);
      if (cards.length < total) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    if (isCancelled()) return null;
    this.assertFolderSource(ws);
    // A processed file can also move during a later batch's yield.
    for (let i = 0; i < files.length; i++) {
      if (files[i].path !== initialPaths[i] ||
          this.app.vault.getAbstractFileByPath(initialPaths[i]) !== files[i])
        throw new Error("摘录文件在扫描期间发生变化，请手动刷新");
    }
    return cards;
  }
  /** Index one newly created Markdown file without scanning the vault.
   * Explicit save tags bridge the interval before Obsidian's metadata cache catches up. */
  indexCreatedFile(file: TFile, savedTags: readonly string[]): CardIndex {
    const card = this.indexFile(file);
    const tags = [...new Set(savedTags.map(t => t.replace(/^#/, "").trim()).filter(Boolean))];
    return {
      ...card,
      tags: [...new Set([...card.tags, ...tags])],
      frontmatterTags: [...new Set([...card.frontmatterTags, ...tags])]
    };
  }
  private indexFile(file: TFile): CardIndex {
    const cache = this.app.metadataCache.getFileCache(file);
    const all = getAllTags(cache ?? {}) ?? [];
    const inline = new Set((cache?.tags ?? []).map(tag => tag.tag.replace(/^#/, "")));
    const tags = [...new Set(all.map(tag => tag.replace(/^#/, "")))];
    const rawFrontmatter = cache?.frontmatter?.tags;
    const frontmatterTags = (Array.isArray(rawFrontmatter) ? rawFrontmatter.map(String) :
      typeof rawFrontmatter === "string" ? rawFrontmatter.split(/[\s,]+/) : [])
      .map(value => value.replace(/^#/, "").trim()).filter(Boolean);
    return {
      path: file.path, basename: file.basename,
      mtime: file.stat?.mtime ?? 0, ctime: file.stat?.ctime ?? 0,
      size: file.stat?.size ?? 0, tags, inlineTags: [...inline], frontmatterTags
    };
  }
  private file(path: string): TFile {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error("Markdown 文件不存在：" + path);
    return file;
  }
  async read(path: string): Promise<ParsedMarkdown> {
    return (await this.readSnapshot(path)).parsed;
  }
  rawFor(parsed: ParsedMarkdown): string | undefined { return this.rawByParsed.get(parsed); }
  /** Explicit refresh bypasses stamp-based and Obsidian cached reads. */
  async readSnapshot(path: string, fresh = false): Promise<{ raw: string; parsed: ParsedMarkdown }> {
    const file = this.file(path);
    const stamp = String(file.stat?.mtime ?? 0) + ":" + String(file.stat?.size ?? 0);
    const prior = this.cache.get(path);
    if (!fresh && prior?.file === file && prior.stamp === stamp) {
      this.cache.delete(path); this.cache.set(path, prior);
      return { raw: prior.raw, parsed: prior.parsed };
    }
    const fileEpoch = this.fileEpochs.get(file) ?? 0;
    const globalEpoch = this.globalEpoch;
    const raw = fresh ? await this.app.vault.read(file) : await this.app.vault.cachedRead(file);
    if (globalEpoch !== this.globalEpoch || fileEpoch !== (this.fileEpochs.get(file) ?? 0) ||
        this.app.vault.getAbstractFileByPath(path) !== file ||
        stamp !== String(file.stat?.mtime ?? 0) + ":" + String(file.stat?.size ?? 0))
      throw new Error("摘录在读取期间发生变化，请手动刷新");
    const parsed = parseMarkdown(raw);
    this.rawByParsed.set(parsed, raw);
    this.cache.set(path, { file, stamp, raw, parsed });
    this.trim();
    return { raw, parsed };
  }
  private trim(): void {
    // Cap retained raw Markdown and parsed content, including on mobile.
    let bytes = 0;
    for (const value of this.cache.values()) bytes += value.raw.length * 2;
    while (this.cache.size > 50 || bytes > 8 * 1024 * 1024) {
      const first = this.cache.keys().next().value;
      if (!first) break;
      bytes -= this.cache.get(first)!.raw.length * 2;
      this.cache.delete(first);
    }
  }
  invalidate(path?: string): void {
    if (path) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) this.fileEpochs.set(file, (this.fileEpochs.get(file) ?? 0) + 1);
      this.cache.delete(path);
      this.forgetSearchText(path);
    } else {
      this.globalEpoch++;
      this.cache.clear();
      this.searchCache.clear();
      this.searchCacheBytes = 0;
    }
  }
  private forgetSearchText(path: string): void {
    const value = this.searchCache.get(path);
    if (value) this.searchCacheBytes -= value.bytes;
    this.searchCache.delete(path);
  }
  private async searchText(card: CardIndex): Promise<string> {
    const stamp = card.mtime + ":" + card.size;
    const file = this.file(card.path);
    const cached = this.searchCache.get(card.path);
    if (cached?.file === file && cached.stamp === stamp) {
      this.searchCache.delete(card.path);
      this.searchCache.set(card.path, cached);
      return cached.lowerText;
    }
    if (cached) this.forgetSearchText(card.path);
    const parsed = await this.read(card.path);
    const lowerText = [parsed.title, parsed.body,
      ...parsed.sections.map(section => section.name + "\n" + section.markdown)]
      .join("\n").toLocaleLowerCase();
    const bytes = lowerText.length * 2;
    // A single unusually large note is searched without being retained.
    if (bytes > 16 * 1024 * 1024) return lowerText;
    // Another search may have finished the same path while this read was awaiting.
    this.forgetSearchText(card.path);
    // Keep a stable bounded subset rather than thrashing the cache during a 10k+ full scan.
    if (this.searchCache.size >= 30000 || this.searchCacheBytes + bytes > 16 * 1024 * 1024)
      return lowerText;
    this.searchCache.set(card.path, { file, stamp, lowerText, bytes });
    this.searchCacheBytes += bytes;
    return lowerText;
  }
  async search(files: CardIndex[], query: string,
    shouldCancel: () => boolean, onProgress?: (done: number) => void): Promise<Set<string>> {
    const q = query.trim().toLocaleLowerCase();
    const matches = new Set<string>();
    if (!q) return matches;
    const stride = 40;
    for (let offset = 0; offset < files.length; offset += stride) {
      if (shouldCancel()) return matches;
      const batch = files.slice(offset, offset + stride);
      for (let p = 0; p < batch.length; p += 4) {
        if (shouldCancel()) return matches;
        let unreadable = false;
        await Promise.all(batch.slice(p, p+4).map(async card => {
          if (card.basename.toLocaleLowerCase().includes(q) ||
              card.tags.some(tag => tag.toLocaleLowerCase().includes(q))) {
            matches.add(card.path);
            return;
          }
          try {
            if ((await this.searchText(card)).includes(q)) matches.add(card.path);
          } catch {
            unreadable = true;
          }
        }));
        // Complete the bounded batch before failing; an obsolete search must
        // never replace a newer query's success with its own read error.
        if (shouldCancel()) return matches;
        if (unreadable)
          throw new Error("部分摘录文件无法读取，无法确认完整搜索结果。请检查文件后重新搜索，或清除关键词。");
      }
      onProgress?.(Math.min(files.length, offset + batch.length));
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    return matches;
  }
  async create(ws: Workspace, markdown = "", tags: string[] = [],
    onAttempt?: (path: string) => (file?: TFile) => void): Promise<TFile> {
    this.assertFolderSource(ws);
    if (ws.kind === "file" && ws.rootFolder !== "/") await this.ensureFolder(ws.rootFolder);
    const base = excerptFileStem(markdown);
    const prefix = ws.rootFolder === "/" ? "" : ws.rootFolder + "/";
    const occupied = new Set(this.app.vault.getAllLoadedFiles().map(file => filenameKey(file.path)));
    const cleanTags = [...new Set(tags.map(t => t.replace(/^#/, "").trim()).filter(Boolean))];
    const yaml = cleanTags.length ? "---\ntags:\n" + cleanTags.map(tag => "  - " + JSON.stringify(tag)).join("\n") + "\n---\n\n" : "";
    const content = yaml + markdown.trim() + "\n";

    // Reserve names while in flight so simultaneous saves never choose the same path.
    // Only after 10,000 sequential collisions use a timestamp-based unique suffix.
    for (let i = 1; i <= 10050; i++) {
      const suffix = i <= 10000 ? (i === 1 ? "" : "-" + i) :
        "-" + Date.now().toString(36) + "-" + (i - 10000);
      const filename = fitFileStem(base, 30 - Array.from(suffix).length) + suffix + ".md";
      const path = prefix + filename;
      const key = filenameKey(path);
      if (occupied.has(key) || this.reservedPaths.has(key) || this.app.vault.getAbstractFileByPath(path)) continue;
      this.reservedPaths.add(key);
      let settle: ((file?: TFile) => void) | undefined;
      try {
        settle = onAttempt?.(path);
        this.assertFolderSource(ws);
        const file = await this.app.vault.create(path, content);
        // Record the file identity before returning to the caller. Vault events
        // may arrive either before or after the create promise resolves.
        settle?.(file);
        return file;
      } catch (error) {
        settle?.();
        // Retry only when another writer really created the path, not on unrelated IO errors.
        const conflict = this.app.vault.getAllLoadedFiles()
          .some(file => filenameKey(file.path) === key);
        const alreadyExists = error instanceof Error &&
          (/\b(?:EEXIST|already exists|file exists)\b/i.test(error.message) ||
            (error as Error & { code?: string }).code === "EEXIST");
        if (!conflict && !this.app.vault.getAbstractFileByPath(path) && !alreadyExists) throw error;
        occupied.add(key);
      } finally {
        this.reservedPaths.delete(key);
      }
    }
    throw new Error("无法生成唯一文件名");
  }
  snapshotForDelete(path: string, ws: Workspace): DeleteCandidate | null {
    if (!this.folderSourceValid(ws) || !isExcerptPath(path, ws)) return null;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension !== "md") return null;
    return { path, file, mtime: file.stat.mtime, size: file.stat.size };
  }
  /** Serialize trash operations; a stale, moved, open or modified file must never be removed. */
  async deleteEntries(ws: Workspace, candidates: readonly DeleteCandidate[],
    onProgress?: (progress: DeleteProgress) => void): Promise<DeleteResult> {
    const result: DeleteResult = { deleted: [], failed: [] };
    // Each path is processed once; progress counts completed attempts, including failures.
    const unique = [...new Map(candidates.map(candidate => [candidate.path, candidate])).values()];
    const total = unique.length;
    let processed = 0;
    for (const candidate of unique) {
      const { path } = candidate;
      try {
        this.assertFolderSource(ws);
        const current = this.app.vault.getAbstractFileByPath(path);
        if (!(current instanceof TFile) || current !== candidate.file ||
            current.extension !== "md" || !isExcerptPath(path, ws)) {
          result.failed.push({ path, reason: "文件已不存在或位置发生变化" });
          continue;
        }
        if (current.stat.mtime !== candidate.mtime || current.stat.size !== candidate.size) {
          result.failed.push({ path, reason: "文件已被修改，请重新选择" });
          continue;
        }
        const editorOpen = this.app.workspace.getLeavesOfType("markdown").some(leaf =>
          leaf.view instanceof MarkdownView && leaf.view.file === current);
        if (editorOpen) {
          result.failed.push({ path, reason: "文件正在编辑器中打开，请先关闭" });
          continue;
        }
        await this.app.fileManager.trashFile(current);
        this.invalidate(path);
        result.deleted.push(path);
      } catch (error) {
        result.failed.push({ path, reason: error instanceof Error ? error.message : String(error) });
      } finally {
        processed++;
        onProgress?.({ processed, total, deleted: result.deleted.length, failed: result.failed.length });
      }
      // Yield after the first file and every 16 files so a fast bulk delete
      // can paint real progress without a timer delay for every item.
      if (processed < total && (processed === 1 || processed % 16 === 0))
        await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    return result;
  }
  async readRaw(path: string): Promise<string> {
    return this.app.vault.cachedRead(this.file(path));
  }
  /** Atomically replace only YAML tags; never rewrite inline #tags in the Markdown body. */
  async setFrontmatterTags(path: string, tags: string[], expected: string[],
    ws: Workspace, expectedFile: TFile): Promise<void> {
    const file = this.assertScopedFile(ws, path, expectedFile);
    const normalized = new Map<string, string>();
    for (const original of tags) {
      const tag = original.trim().replace(/^#/, "");
      if (!tag || /\s/.test(tag)) throw new Error("标签不能为空或包含空格");
      const key = tag.toLocaleLowerCase();
      if (!normalized.has(key)) normalized.set(key, tag);
    }
    const names = [...normalized.values()];
    const comparable = (list: string[]) => list.map(value => value.replace(/^#/, "").trim().toLocaleLowerCase())
      .filter(Boolean).sort().join("\n");
    await this.app.fileManager.processFrontMatter(file, frontmatter => {
      // Obsidian may have waited for other Vault writers before invoking this callback.
      this.assertScopedFile(ws, path, expectedFile);
      const raw = frontmatter.tags;
      const current = Array.isArray(raw) ? raw.map(String) :
        typeof raw === "string" ? raw.split(/[\s,]+/) : [];
      if (comparable(current) !== comparable(expected))
        throw new Error("标签已被其他操作修改，请重新打开标签编辑器");
      if (names.length) frontmatter.tags = names;
      else delete frontmatter.tags;
    });
    this.invalidate(path);
    // An external rename after the native write started cannot be rolled back here.
    if (ws.kind === "folder") {
      try {
        this.assertScopedFile(ws, path, expectedFile);
      } catch {
        throw new Error("标签写入已返回，但文件夹或文件位置发生变化，请核对实际标签结果");
      }
    }
  }
}
