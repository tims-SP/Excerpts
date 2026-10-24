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
  private cache = new Map<string, { stamp: string; parsed: ParsedMarkdown; raw: string }>();
  /** Reusable full-text search material, bounded independently from parsed Markdown. */
  private searchCache = new Map<string, { stamp: string; lowerText: string; bytes: number }>();
  private searchCacheBytes = 0;
  private reservedPaths = new Set<string>();
  constructor(private readonly app: App) {}
  async ensureFolder(path: string): Promise<void> {
    let cursor = "";
    for (const part of validateRelativePath(path).split("/")) {
      cursor = cursor ? cursor + "/" + part : part;
      const found = this.app.vault.getAbstractFileByPath(cursor);
      if (found && !(found instanceof TFolder)) throw new Error(cursor + " 已存在同名文件");
      if (!found) await this.app.vault.createFolder(cursor);
    }
  }
  /** Metadata-only scan. Each batch yields to the UI without reading Markdown bodies. */
  async scan(ws: Workspace, batchSize: number,
    onProgress: (done: number, total: number) => void,
    isCancelled: () => boolean): Promise<CardIndex[] | null> {
    if (isCancelled()) return null;
    const files = this.app.vault.getMarkdownFiles().filter(file => isExcerptPath(file.path, ws));
    const total = files.length;
    onProgress(0, total);
    const stride = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : 64;
    const cards: CardIndex[] = [];
    for (let start = 0; start < total; start += stride) {
      if (isCancelled()) return null;
      for (const file of files.slice(start, start + stride)) cards.push(this.indexFile(file));
      onProgress(cards.length, total);
      if (cards.length < total) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    return isCancelled() ? null : cards;
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
    const file = this.file(path);
    const stamp = String(file.stat?.mtime ?? 0) + ":" + String(file.stat?.size ?? 0);
    const prior = this.cache.get(path);
    if (prior?.stamp === stamp) {
      this.cache.delete(path); this.cache.set(path, prior);
      return prior.parsed;
    }
    const raw = await this.app.vault.cachedRead(file);
    const parsed = parseMarkdown(raw);
    this.cache.set(path, { stamp, raw, parsed });
    this.trim();
    return parsed;
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
      this.cache.delete(path);
      this.forgetSearchText(path);
    } else {
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
    const cached = this.searchCache.get(card.path);
    if (cached?.stamp === stamp) {
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
    this.searchCache.set(card.path, { stamp, lowerText, bytes });
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
        await Promise.all(batch.slice(p, p+4).map(async card => {
          if (card.basename.toLocaleLowerCase().includes(q) ||
              card.tags.some(tag => tag.toLocaleLowerCase().includes(q))) {
            matches.add(card.path);
            return;
          }
          try {
            if ((await this.searchText(card)).includes(q)) matches.add(card.path);
          } catch { /* A deleted or inaccessible file cannot match. */ }
        }));
      }
      onProgress?.(Math.min(files.length, offset + batch.length));
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    return matches;
  }
  async create(ws: Workspace, markdown = "", tags: string[] = []): Promise<TFile> {
    if (ws.rootFolder !== "/") await this.ensureFolder(ws.rootFolder);
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
      try {
        return await this.app.vault.create(path, content);
      } catch (error) {
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
    if (!isExcerptPath(path, ws)) return null;
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
  async setFrontmatterTags(path: string, tags: string[], expected: string[]): Promise<void> {
    const file = this.file(path);
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
      const raw = frontmatter.tags;
      const current = Array.isArray(raw) ? raw.map(String) :
        typeof raw === "string" ? raw.split(/[\s,]+/) : [];
      if (comparable(current) !== comparable(expected))
        throw new Error("标签已被其他操作修改，请重新打开标签编辑器");
      if (names.length) frontmatter.tags = names;
      else delete frontmatter.tags;
    });
    this.invalidate(path);
  }
}
