import { App, TAbstractFile, TFile, TFolder } from "obsidian";
import { Entry, Workspace, makeId, workspacePaths, belongsTo } from "./model";
import { parseEntry, patchEntry, serializeEntry } from "./codec";

export class EntryRepository {
  constructor(private readonly app: App) {}

  async ensureFolder(path: string): Promise<void> {
    let cursor = "";
    for (const part of path.split("/")) {
      cursor = cursor ? cursor + "/" + part : part;
      const exists = this.app.vault.getAbstractFileByPath(cursor);
      if (exists && !(exists instanceof TFolder)) throw new Error(`${cursor} 是文件，无法创建目录`);
      if (!exists) await this.app.vault.createFolder(cursor);
    }
  }

  async list(ws: Workspace): Promise<Entry[]> {
    const folder = workspacePaths(ws).cards;
    const files = this.app.vault.getMarkdownFiles().filter(f => belongsTo(f.path, folder));
    const results: Entry[] = [];
    // Small batches to keep UI responsive and avoid overwhelming mobile storage.
    for (let i = 0; i < files.length; i += 12) {
      const batch = await Promise.all(files.slice(i, i + 12).map(async file => {
        try {
          const parsed = parseEntry(await this.app.vault.cachedRead(file));
          return parsed?.collectionId === ws.id ? { ...parsed, path: file.path } : null;
        } catch { return null; }
      }));
      for (const item of batch) if (item) results.push(item);
    }
    return results;
  }

  async create(ws: Workspace, text: string, tags: string[] = []): Promise<Entry> {
    const p = workspacePaths(ws);
    await this.ensureFolder(p.cards);
    const now = new Date().toISOString();
    const entry: Entry = { id: makeId("e"), collectionId: ws.id, created: now, updated: now, favorite: false, tags, text, extras: [] };
    const file = await this.app.vault.create(`${p.cards}/${entry.id}.md`, serializeEntry(entry));
    entry.path = file.path;
    return entry;
  }

  async update(entry: Entry, change: (previous: Entry) => Entry): Promise<Entry> {
    if (!entry.path) throw new Error("找不到摘录文件路径");
    const file = this.app.vault.getAbstractFileByPath(entry.path);
    if (!(file instanceof TFile)) throw new Error("摘录文件不存在，可能已被移动或删除");
    let saved: Entry | null = null;
    await this.app.vault.process(file, raw => {
      const current = parseEntry(raw);
      if (!current || current.id !== entry.id || current.collectionId !== entry.collectionId || current.readOnly) {
        throw new Error("文件已损坏或被替换，拒绝覆盖");
      }
      // UI editors can outlive an external Git/Sync or Obsidian edit. Never apply
      // a stale form over a newer record, even if the YAML updated time was unchanged.
      const snapshot = (value: Entry) => JSON.stringify([
        value.id, value.collectionId, value.created, value.updated,
        value.favorite, value.tags, value.text, value.extras
      ]);
      if (snapshot(current) !== snapshot(entry)) {
        throw new Error("摘录已被其他操作修改，请刷新后重试，未覆盖文件");
      }
      const next = change(current);
      if (next.id !== current.id || next.collectionId !== current.collectionId) throw new Error("不能修改摘录身份标识");
      next.updated = new Date().toISOString();
      saved = { ...next, path: file.path };
      return patchEntry(raw, current, next);
    });
    if (!saved) throw new Error("保存没有完成");
    return saved;
  }

  isInWorkspace(file: TAbstractFile, ws: Workspace): boolean {
    const { cards } = workspacePaths(ws);
    return belongsTo(file.path, cards);
  }
}
