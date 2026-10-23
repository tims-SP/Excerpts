import { Notice, Plugin, TFile } from "obsidian";
import { DEFAULT_SETTINGS, PluginSettings, Workspace, isExcerptPath } from "./model";
import { EntryRepository } from "./repository";
import { ExcerptsSettingTab } from "./settings";
import { ExcerptsRenderChild } from "./view";
import { EXCERPTS_HOME_VIEW, ExcerptsHomeFileView } from "./home-view";

export interface ExcerptsDraft {
  kind: "capture" | "edit";
  path?: string;
  raw?: string;
  body: string;
  tags: string[];
  updated: number;
}

/** A .excerpts file is a real entrypoint; no independent collection IDs or navigation view. */
export default class ExcerptsPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  repo!: EntryRepository;
  private rendered = new Set<ExcerptsRenderChild>();
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private drafts: Record<string, ExcerptsDraft> = {};
  private draftTimer: ReturnType<typeof setTimeout> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  async onload(): Promise<void> {
    const data = await this.loadData() as (Partial<PluginSettings> & { drafts?: Record<string, ExcerptsDraft> }) | null;
    this.drafts = data?.drafts && typeof data.drafts === "object" ? data.drafts : {};
    // This is a breaking development release. Ignore the former collections schema.
    this.settings = {
      defaultHome: typeof data?.defaultHome === "string" ? data.defaultHome : "",
      recursive: data?.recursive !== false,
      autoRefresh: data?.autoRefresh !== false,
      checkMinutes: Number.isFinite(data?.checkMinutes) ? Number(data?.checkMinutes) : 0,
      batchSize: [20, 40, 80].includes(Number(data?.batchSize)) ? Number(data?.batchSize) : 40,
      defaultSort: data?.defaultSort === "oldest" ? "oldest" : "newest"
    };
    this.repo = new EntryRepository(this.app);
    this.registerView(EXCERPTS_HOME_VIEW, leaf => new ExcerptsHomeFileView(leaf, this, this.repo));
    this.registerExtensions(["excerpts"], EXCERPTS_HOME_VIEW);
    this.addSettingTab(new ExcerptsSettingTab(this.app, this));
    this.addRibbonIcon("bookmark", "打开摘录首页", () => void this.openHome().catch(showError));
    this.addCommand({ id: "open-home", name: "打开摘录首页", callback: () => void this.openHome().catch(showError) });
    this.addCommand({ id: "refresh-home", name: "刷新摘录", callback: () => this.refreshViews(true) });
    this.registerEvent(this.app.vault.on("modify", file => this.onFileChange(file.path)));
    this.registerEvent(this.app.vault.on("create", file => this.onFileChange(file.path)));
    this.registerEvent(this.app.vault.on("delete", file => {
      if (file.path === this.settings.defaultHome) {
        this.settings.defaultHome = "";
        void this.saveSettings();
      }
      this.onFileChange(file.path);
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (oldPath === this.settings.defaultHome) {
        this.settings.defaultHome = file.path;
        void this.saveSettings();
      } else if (this.settings.defaultHome.startsWith(oldPath + "/")) {
        this.settings.defaultHome = file.path + this.settings.defaultHome.slice(oldPath.length);
        void this.saveSettings();
      }
      this.repo.invalidate(oldPath);
      this.onFileChange(oldPath);
      this.onFileChange(file.path);
      if (file.path.endsWith(".excerpts") || oldPath.endsWith(".excerpts")) this.refreshViews(true);
    }));
    this.registerEvent(this.app.metadataCache.on("changed", file => this.onFileChange(file.path)));
    this.configurePolling();
  }
  onunload(): void {
    if (this.checkTimer) clearInterval(this.checkTimer);
    if (this.draftTimer) clearTimeout(this.draftTimer);
    void this.persist();
  }
  getDraft(key: string): ExcerptsDraft | null {
    const draft = this.drafts[key];
    return draft && typeof draft.body === "string" && Array.isArray(draft.tags) ? {
      ...draft, tags: [...draft.tags]
    } : null;
  }
  setDraft(key: string, draft: ExcerptsDraft | null): void {
    if (draft && draft.body.length < 300000) this.drafts[key] = { ...draft, tags: [...draft.tags] };
    else delete this.drafts[key];
    if (this.draftTimer) clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => { this.draftTimer = null; void this.persist(); }, 350);
  }
  /** Serialize draft/settings writes so fast typing cannot overwrite newer snapshots. */
  private persist(): Promise<void> {
    const snapshot = { ...this.settings, drafts: { ...this.drafts } };
    this.writeQueue = this.writeQueue.catch(() => {}).then(() => this.saveData(snapshot));
    return this.writeQueue.catch(error => { console.error("Excerpts: failed to save drafts/settings", error); });
  }
  private onFileChange(path: string): void {
    this.repo.invalidate(path);
    if (!this.settings.autoRefresh) return;
    for (const child of this.rendered) if (isExcerptPath(path, child.workspace)) child.requestRefresh();
  }
  trackRenderer(child: ExcerptsRenderChild): void { this.rendered.add(child); }
  untrackRenderer(child: ExcerptsRenderChild): void { this.rendered.delete(child); }
  refreshViews(force = false): void {
    if (force) this.repo.invalidate();
    for (const child of this.rendered) child.requestRefresh(force);
  }
  configurePolling(): void {
    if (this.checkTimer) clearInterval(this.checkTimer);
    this.checkTimer = null;
    if (this.settings.checkMinutes > 0) {
      this.checkTimer = setInterval(() => {
        if (this.rendered.size) this.refreshViews(true);
      }, this.settings.checkMinutes * 60_000);
    }
  }
  async saveSettings(): Promise<void> {
    await this.persist();
    this.configurePolling();
  }
  getHomeFiles(): TFile[] {
    return this.app.vault.getFiles().filter(file => file.extension === "excerpts")
      .sort((a, b) => a.path.localeCompare(b.path, "zh"));
  }
  workspaceForHome(home: TFile): Workspace {
    return { homePath: home.path, rootFolder: home.parent?.path ?? "/", recursive: this.settings.recursive };
  }
  async rememberHome(path: string): Promise<void> {
    if (this.settings.defaultHome === path) return;
    this.settings.defaultHome = path;
    await this.saveSettings();
  }
  async createHome(folder: string): Promise<TFile> {
    await this.repo.ensureFolder(folder);
    const path = folder.replace(/\/+$/, "") + "/首页.excerpts";
    const current = this.app.vault.getAbstractFileByPath(path);
    if (current instanceof TFile && current.extension === "excerpts") return current;
    if (current) throw new Error("首页路径已经被其他文件占用");
    return this.app.vault.create(path, "");
  }
  async openHome(path?: string): Promise<void> {
    const homes = this.getHomeFiles();
    const file = (path ? homes.find(item => item.path === path) : null) ??
      homes.find(item => item.path === this.settings.defaultHome) ?? homes[0];
    if (!file) { new Notice("没有首页.excerpts，请在插件设置中创建首页入口"); return; }
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    await this.app.workspace.revealLeaf(leaf);
  }
  async openMarkdown(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error("Markdown 文件不存在：" + path);
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(file);
    await this.app.workspace.revealLeaf(leaf);
  }
}
function showError(error: unknown): void { new Notice(error instanceof Error ? error.message : String(error)); }
