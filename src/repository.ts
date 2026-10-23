import { App, TFile, TFolder, getAllTags } from "obsidian";
import { CardIndex, ParsedMarkdown, Workspace, isExcerptPath, validateRelativePath } from "./model";
import { parseMarkdown } from "./codec";

export class EntryRepository {
  private cache = new Map<string, { stamp: string; parsed: ParsedMarkdown; raw: string }>();
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
  list(ws: Workspace): CardIndex[] {
    return this.app.vault.getMarkdownFiles()
      .filter(file => isExcerptPath(file.path, ws))
      .map(file => this.indexFile(file));
  }
  private indexFile(file: TFile): CardIndex {
    const cache = this.app.metadataCache.getFileCache(file);
    const all = getAllTags(cache ?? {}) ?? [];
    const inline = new Set((cache?.tags ?? []).map(tag => tag.tag.replace(/^#/, "")));
    const tags = [...new Set(all.map(tag => tag.replace(/^#/, "")))];
    const sourceTags = cache?.frontmatter?.tags;
    const propertyTags = [...new Set((Array.isArray(sourceTags) ? sourceTags :
      typeof sourceTags === "string" ? sourceTags.split(/[ ,]+/) : [])
      .map(value => String(value).trim().replace(/^#/, "")).filter(Boolean))];
    return {
      path: file.path, basename: file.basename,
      mtime: file.stat?.mtime ?? 0, ctime: file.stat?.ctime ?? 0,
      size: file.stat?.size ?? 0, tags, propertyTags, inlineTags: [...inline],
      favorite: cache?.frontmatter?.favorite === true
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
    if (path) this.cache.delete(path);
    else this.cache.clear();
  }
  async search(files: CardIndex[], query: string, batchSize: number,
    shouldCancel: () => boolean, onProgress?: (done: number) => void): Promise<Set<string>> {
    const q = query.trim().toLocaleLowerCase();
    const matches = new Set<string>();
    if (!q) return matches;
    const stride = Math.max(1, Math.min(80, batchSize));
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
            const parsed = await this.read(card.path);
            const text = [parsed.title, parsed.body, ...parsed.sections.map(s => s.name + "\n" + s.markdown)].join("\n");
            if (text.toLocaleLowerCase().includes(q)) matches.add(card.path);
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
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T","-");
    for (let i = 0; i < 1000; i++) {
      const path = (ws.rootFolder === "/" ? "" : ws.rootFolder + "/") + "摘录-" + stamp + (i ? "-" + i : "") + ".md";
      if (!this.app.vault.getAbstractFileByPath(path)) {
        const cleanTags = [...new Set(tags.map(t => t.replace(/^#/, "").trim()).filter(Boolean))];
        const yaml = cleanTags.length ? "---\ntags:\n" + cleanTags.map(tag => "  - " + JSON.stringify(tag)).join("\n") + "\n---\n\n" : "";
        return this.app.vault.create(path, yaml + markdown.trim() + "\n");
      }
    }
    throw new Error("无法生成唯一文件名");
  }
  /** Original bytes are the conflict baseline. Display parsing never modifies note content. */
  async readSource(path: string): Promise<string> { return this.app.vault.read(this.file(path)); }
  /** Frontmatter is not exposed in the inline editor. Preserve its original source verbatim. */
  editorBody(raw: string): string {
    const frontmatter = raw.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
    return frontmatter ? raw.slice(frontmatter[0].length) : raw;
  }
  private replacePropertyTags(source: string, tags: string[]): string {
    const block = tags.length ? "tags:\n" + tags.map(t => "  - " + JSON.stringify(t)).join("\n") + "\n" : "";
    const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/);
    if (!frontmatter) return block ? "---\n" + block + "---\n\n" + source : source;
    const yaml = frontmatter[1];
    const lines = yaml.split(/\r?\n/);
    const start = lines.findIndex(line => /^tags\s*:/.test(line));
    if (start >= 0) {
      let end = start + 1;
      while (end < lines.length && (!lines[end].trim() || /^[ \t]/.test(lines[end]))) end++;
      lines.splice(start, end - start);
    }
    if (block) lines.push(block.trimEnd());
    return "---\n" + lines.join("\n") + "\n---" +
      source.slice(frontmatter[0].length);
  }
  /** Single atomic Vault.process: Markdown text and YAML tags commit together or not at all. */
  async saveMarkdown(path: string, originalRaw: string, newBody: string,
    newTags: string[], originalTags: string[]): Promise<void> {
    const file = this.file(path);
    const cleaned = [...new Set(newTags.map(tag => tag.trim().replace(/^#/, "")).filter(Boolean))];
    if (cleaned.some(tag => /\s/.test(tag))) throw new Error("标签不能包含空格");
    await this.app.vault.process(file, current => {
      if (current !== originalRaw) throw new Error("Markdown 已在其他窗口修改；未覆盖原文件");
      const oldHeader = current.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
      const nextRaw = (oldHeader ? oldHeader[0] : "") + newBody;
      return JSON.stringify(cleaned) === JSON.stringify(originalTags) ?
        nextRaw : this.replacePropertyTags(nextRaw, cleaned);
    });
    this.invalidate(path);
  }
  async setFavorite(path: string, value: boolean): Promise<void> {
    await this.app.fileManager.processFrontMatter(this.file(path), frontmatter => {
      if (value) frontmatter.favorite = true;
      else delete frontmatter.favorite;
    });
    this.invalidate(path);
  }
  async setTag(path: string, tag: string, add: boolean): Promise<void> {
    const file = this.file(path);
    const normalized = tag.replace(/^#/, "").trim();
    if (!normalized || /\s/.test(normalized)) throw new Error("标签不能包含空格");
    const current = this.indexFile(file);
    if (!add && current.inlineTags.includes(normalized)) {
      throw new Error("该标签位于 Markdown 正文中，请使用原生编辑器修改");
    }
    await this.app.fileManager.processFrontMatter(file, frontmatter => {
      const existing = Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) :
        typeof frontmatter.tags === "string" ? frontmatter.tags.split(/[,\s]+/) : [];
      const next = new Set(existing.map((t: string) => t.replace(/^#/, "")).filter(Boolean));
      if (add) next.add(normalized); else next.delete(normalized);
      if (next.size) frontmatter.tags = [...next]; else delete frontmatter.tags;
    });
    this.invalidate(path);
  }
}
