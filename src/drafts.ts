import { App, TFile } from "obsidian";
import { Workspace, makeId, joinPath, workspacePaths, belongsTo } from "./model";

/**
 * Drafts are recoverable Markdown notes, not plugin data.json. A unique
 * per-editor file avoids cross-pane last-writer-wins data loss.
 */
export interface SavedDraft {
  id: string;
  collectionId: string;
  kind: "capture" | "quote";
  entryId: string;
  base: string;
  text: string;
  tags: string;
  created: string;
  updated: string;
}

const TITLE = "# Excerpts · 未保存草稿\n\n";
const OPEN = "~~~json\n";
const CLOSE = "\n~~~\n";

function validId(value: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(value);
}
export function encodeDraft(draft: SavedDraft): string {
  if (!validId(draft.id) || !validId(draft.collectionId) ||
      (draft.entryId && !validId(draft.entryId)) ||
      !["capture", "quote"].includes(draft.kind) ||
      (draft.kind === "quote" && !draft.entryId) ||
      (draft.kind === "capture" && draft.entryId)) throw new Error("草稿身份无效");
  // JSON.stringify escapes newlines in user strings. Tilde fences can be chosen
  // longer than any run inside JSON to allow arbitrary user content.
  const data = JSON.stringify(draft, null, 2);
  const longest = Math.max(3, ...([...data.matchAll(/~+/g)].map(x => x[0].length + 1)));
  const fence = "~".repeat(longest);
  return TITLE + fence + "json\n" + data + "\n" + fence + "\n";
}
export function decodeDraft(raw: string): SavedDraft | null {
  if (!raw.startsWith(TITLE)) return null;
  const rest = raw.slice(TITLE.length);
  const m = rest.match(/^(~{3,})json\n([\s\S]*)\n\1\n$/);
  if (!m) return null;
  let value: unknown;
  try { value = JSON.parse(m[2]); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const x = value as Partial<SavedDraft>;
  if (!["capture", "quote"].includes(x.kind || "") ||
      ![x.id, x.collectionId, x.entryId, x.base, x.text, x.tags, x.created, x.updated]
        .every(y => typeof y === "string") ||
      !validId(x.id!) || !validId(x.collectionId!) ||
      (x.entryId !== "" && !validId(x.entryId!)) ||
      (x.kind === "quote" && !x.entryId) || (x.kind === "capture" && x.entryId !== "")) return null;
  const draft = x as SavedDraft;
  // Refuse silently malformed/unowned notes; never rewrite them.
  return encodeDraft(draft) === raw ? draft : null;
}

export class DraftRepository {
  constructor(private readonly app: App) {}
  private folder(ws: Workspace): string {
    const p = workspacePaths(ws);
    const folder = joinPath(p.root, "Excerpts-Drafts");
    if (folder === p.cards || belongsTo(folder, p.cards) || belongsTo(p.cards, folder)) {
      throw new Error("草稿目录与摘录目录冲突");
    }
    return folder;
  }
  private async ensureFolder(path: string): Promise<void> {
    let pathSoFar = "";
    for (const part of path.split("/")) {
      pathSoFar = pathSoFar ? pathSoFar + "/" + part : part;
      if (!this.app.vault.getAbstractFileByPath(pathSoFar)) {
        await this.app.vault.createFolder(pathSoFar);
      }
    }
  }
  async list(ws: Workspace): Promise<SavedDraft[]> {
    const folder = this.folder(ws);
    const files = this.app.vault.getMarkdownFiles()
      .filter(f => f.path.startsWith(folder + "/") && !f.path.slice(folder.length + 1).includes("/"));
    const drafts: SavedDraft[] = [];
    for (const file of files) {
      try {
        const value = decodeDraft(await this.app.vault.read(file));
        if (value && value.collectionId === ws.id && file.path === joinPath(folder, value.id + ".md")) {
          drafts.push(value);
        }
      } catch { /* A damaged draft is kept for manual recovery, never overwritten. */ }
    }
    return drafts.sort((a,b) => b.updated.localeCompare(a.updated));
  }
  async create(ws: Workspace, value: Omit<SavedDraft,"id"|"collectionId"|"created"|"updated">): Promise<SavedDraft> {
    const folder = this.folder(ws);
    await this.ensureFolder(folder);
    const now = new Date().toISOString();
    const draft: SavedDraft = { ...value, id: makeId("d"), collectionId: ws.id, created: now, updated: now };
    await this.app.vault.create(joinPath(folder, draft.id + ".md"), encodeDraft(draft));
    return draft;
  }
  async update(ws: Workspace, expected: SavedDraft, value: Pick<SavedDraft,"text"|"tags">): Promise<SavedDraft> {
    if (expected.collectionId !== ws.id || !validId(expected.id)) throw new Error("草稿不属于当前收藏集");
    const file = this.app.vault.getAbstractFileByPath(joinPath(this.folder(ws), expected.id + ".md"));
    if (!(file instanceof TFile)) throw new Error("草稿文件不存在");
    let result: SavedDraft | null = null;
    await this.app.vault.process(file, raw => {
      if (raw !== encodeDraft(expected)) throw new Error("草稿文件已在外部修改，拒绝覆盖");
      result = { ...expected, ...value, updated: new Date().toISOString() };
      return encodeDraft(result);
    });
    if (!result) throw new Error("草稿未保存");
    return result;
  }
  async resolve(ws: Workspace, expected: SavedDraft): Promise<void> {
    if (expected.collectionId !== ws.id || !validId(expected.id)) throw new Error("草稿不属于当前收藏集");
    const file = this.app.vault.getAbstractFileByPath(joinPath(this.folder(ws), expected.id + ".md"));
    if (!(file instanceof TFile)) throw new Error("草稿文件不存在");
    if (await this.app.vault.read(file) !== encodeDraft(expected)) throw new Error("草稿发生变化，拒绝覆盖");
    const folder = joinPath(this.folder(ws), "Resolved");
    await this.ensureFolder(folder);
    const to = joinPath(folder, expected.id + ".md");
    if (this.app.vault.getAbstractFileByPath(to)) throw new Error("历史草稿路径冲突");
    await this.app.vault.rename(file, to);
  }
}
