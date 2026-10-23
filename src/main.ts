import { Notice, Plugin, TFile, TFolder } from "obsidian";
import { DEFAULT_SETTINGS, PluginSettings, Workspace, belongsTo, isExcerptPath, makeId, validateRelativePath } from "./model";
import { EntryRepository } from "./repository";
import { ExcerptsSettingTab } from "./settings";
import { ExcerptsRenderChild } from "./view";
import { ExcerptsCollectionView, EXCERPTS_COLLECTION_VIEW } from "./collection-view";

export default class ExcerptsPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS, workspaces: [] };
  repo!: EntryRepository;
  private rendered = new Set<ExcerptsRenderChild>();
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  async onload(): Promise<void> {
    const raw = await this.loadData() as Partial<PluginSettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS, ...(raw || {}),
      workspaces: Array.isArray(raw?.workspaces)
        ? raw.workspaces.map(ws => ({ ...ws, recursive: ws.recursive !== false })) : []
    };
    this.repo = new EntryRepository(this.app);
    this.registerView(EXCERPTS_COLLECTION_VIEW, leaf => new ExcerptsCollectionView(leaf, this, this.repo));
    this.addSettingTab(new ExcerptsSettingTab(this.app, this));
    this.addRibbonIcon("bookmark", "打开摘录首页", () => {
      void this.openHome().catch(error => new Notice(error instanceof Error ? error.message : String(error)));
    });
    this.addCommand({ id: "open-home", name: "打开摘录首页", callback: () => {
      void this.openHome().catch(error => new Notice(error instanceof Error ? error.message : String(error)));
    }});
    this.addCommand({ id: "open-collection", name: "打开摘录收藏集", callback: () => {
      const first = this.settings.workspaces[0];
      if (first) void this.openWorkspace(first);
      else new Notice("请先在 Excerpts 设置中指定一个 Markdown 文件夹");
    }});
    this.addCommand({ id: "refresh-collection", name: "手动刷新摘录", callback: () => this.refreshViews(true) });
    this.registerEvent(this.app.vault.on("modify", f => this.onFileChanged(f.path)));
    this.registerEvent(this.app.vault.on("create", f => this.onFileChanged(f.path)));
    this.registerEvent(this.app.vault.on("delete", f => this.onFileChanged(f.path)));
    this.registerEvent(this.app.vault.on("rename", (f, oldPath) => {
      void this.trackFolderRename(oldPath, f.path);
      this.onFileChanged(oldPath);
      this.onFileChanged(f.path);
    }));
    this.registerEvent(this.app.metadataCache.on("changed", file => this.onFileChanged(file.path)));
    this.configurePolling();
  }
  onunload(): void {
    if (this.checkTimer) clearInterval(this.checkTimer);
  }
  private onFileChanged(path: string): void {
    this.repo.invalidate(path);
    if (!this.settings.autoRefresh) return;
    for (const child of this.rendered) {
      if (isExcerptPath(path, child.workspace)) child.requestRefresh();
    }
  }
  private async trackFolderRename(oldPath: string, newPath: string): Promise<void> {
    let updated = false;
    for (const ws of this.settings.workspaces) {
      if (ws.rootFolder === oldPath || ws.rootFolder.startsWith(oldPath + "/")) {
        ws.rootFolder = newPath + ws.rootFolder.slice(oldPath.length);
        updated = true;
      }
    }
    if (updated) {
      await this.saveSettings();
      this.refreshViews(true);
    }
  }
  configurePolling(): void {
    if (this.checkTimer) clearInterval(this.checkTimer);
    this.checkTimer = null;
    const minutes = this.settings.checkMinutes;
    if (minutes > 0) this.checkTimer = setInterval(() => {
      if (this.rendered.size) this.refreshViews(true);
    }, minutes * 60_000);
  }
  refreshViews(force = false): void {
    if (force) this.repo.invalidate();
    for (const child of this.rendered) child.requestRefresh(force);
  }
  trackRenderer(child: ExcerptsRenderChild): void { this.rendered.add(child); }
  untrackRenderer(child: ExcerptsRenderChild): void { this.rendered.delete(child); }
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.configurePolling();
  }
  async createWorkspace(name: string, folder: string): Promise<Workspace> {
    if (!name.trim()) throw new Error("收藏集名称不能为空");
    const rootFolder = validateRelativePath(folder);
    const found = this.app.vault.getAbstractFileByPath(rootFolder);
    if (found && !(found instanceof TFolder)) throw new Error("目标路径不是文件夹");
    if (!found) await this.repo.ensureFolder(rootFolder);
    const ws: Workspace = { id: makeId(), name: name.trim(), rootFolder, recursive: true };
    this.settings.workspaces.push(ws);
    await this.saveSettings();
    return ws;
  }
  async repointWorkspace(id: string, folder: string): Promise<void> {
    const ws = this.settings.workspaces.find(w => w.id === id);
    if (!ws) throw new Error("收藏集不存在");
    const rootFolder = validateRelativePath(folder);
    const found = this.app.vault.getAbstractFileByPath(rootFolder);
    if (!(found instanceof TFolder)) throw new Error("目标文件夹不存在");
    ws.rootFolder = rootFolder;
    await this.saveSettings();
    this.refreshViews(true);
  }
  /** Homepage navigation is a native pane, not a special Markdown file. */
  async openHome(): Promise<void> {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({ type: EXCERPTS_COLLECTION_VIEW, state: { workspaceId: "" }, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }
  async openWorkspace(ws: Workspace): Promise<void> {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({ type: EXCERPTS_COLLECTION_VIEW, state: { workspaceId: ws.id }, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }
  async openMarkdown(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error("文件不存在");
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(file);
    await this.app.workspace.revealLeaf(leaf);
  }
  async newMarkdown(ws: Workspace): Promise<void> {
    const file = await this.repo.create(ws);
    await this.openMarkdown(file.path);
  }
}
