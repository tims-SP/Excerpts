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
    return {
      path: file.path, basename: file.basename,
      mtime: file.stat?.mtime ?? 0, ctime: file.stat?.ctime ?? 0,
      size: file.stat?.size ?? 0, tags, inlineTags: [...inline]
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
