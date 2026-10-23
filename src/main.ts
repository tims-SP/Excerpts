import { MarkdownView, Notice, Plugin, TFile } from "obsidian";
import { DEFAULT_SETTINGS, PluginSettings, Workspace, isExcerptPath } from "./model";
import { EntryRepository } from "./repository";
import { ExcerptsSettingTab } from "./settings";
import { ExcerptsRenderChild } from "./view";
import { EXCERPTS_HOME_VIEW, ExcerptsHomeFileView } from "./home-view";

/** A .excerpts file is a real entrypoint; no independent collection IDs or navigation view. */
export default class ExcerptsPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  repo!: EntryRepository;
  private rendered = new Set<ExcerptsRenderChild>();
  async onload(): Promise<void> {
    const data = await this.loadData() as Partial<PluginSettings> | null;
    // This is a breaking development release. Ignore the former collections schema.
    this.settings = {
      defaultHome: typeof data?.defaultHome === "string" ? data.defaultHome : "",
      recursive: data?.recursive !== false
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
  }
  private onFileChange(path: string): void {
    this.repo.invalidate(path);
    for (const child of this.rendered) if (isExcerptPath(path, child.workspace)) child.requestRefresh();
  }
  trackRenderer(child: ExcerptsRenderChild): void { this.rendered.add(child); }
  untrackRenderer(child: ExcerptsRenderChild): void { this.rendered.delete(child); }
  refreshViews(force = false): void {
    if (force) this.repo.invalidate();
    for (const child of this.rendered) {
      child.workspace.recursive = this.settings.recursive;
      child.requestRefresh(force);
    }
  }
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
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
  async openMarkdown(path: string, line?: number): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error("Markdown 文件不存在：" + path);
    // A new tab keeps the .excerpts homepage, its filters and scroll position intact.
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(file);
    // Switch the leaf's view state rather than calling an unsupported MarkdownView setter.
    if (leaf.view instanceof MarkdownView && leaf.view.getMode() !== "source") {
      await leaf.setViewState({ type: "markdown", state: { file: path, mode: "source" } });
    }
    await this.app.workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (view instanceof MarkdownView) {
      if (line !== undefined) {
        const cursor = { line, ch: 0 };
        view.editor.setCursor(cursor);
        view.editor.scrollIntoView({ from: cursor, to: cursor }, true);
      }
      view.editor.focus();
    }
  }
}
function showError(error: unknown): void { new Notice(error instanceof Error ? error.message : String(error)); }
