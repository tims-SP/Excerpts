import { MarkdownView, Notice, Plugin, TFile, TFolder } from "obsidian";
import { DEFAULT_SETTINGS, PluginSettings, SCAN_BATCH_SIZES, LIST_BATCH_SIZES, Workspace } from "./model";
import { EntryRepository } from "./repository";
import { ExcerptsSettingTab } from "./settings";
import { ExcerptsRenderChild } from "./view";
import { EXCERPTS_HOME_VIEW, ExcerptsHomeFileView } from "./home-view";
import { PageFilter, pageNameError, serializePageFilter } from "./page-config";

/** A .excerpts file is a real entrypoint; no independent collection IDs or navigation view. */
export default class ExcerptsPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  repo!: EntryRepository;
  private rendered = new Set<ExcerptsRenderChild>();
  /** Exclusive owner of the single Vault-wide index scan; never released before scan settles. */
  private scanOwner: ExcerptsRenderChild | null = null;
  /** Only the initiating creation flow may navigate and release this lock. */
  private homeCreationOwner: symbol | null = null;
  /** Navigation-only guard: never blocks the page's own initial index scan. */
  private homeNavigationBusy = false;
  private settingsTab: ExcerptsSettingTab | null = null;
  /** Session-only candidates: never sweep unrelated or pre-existing notes. */
  private temporaryEditors = new Map<TFile, { path: string; frontmatter: string }>();
  private editorCleanupTimer: ReturnType<typeof setTimeout> | null = null;
  private editorCleanupRunning = false;
  private unloading = false;
  async onload(): Promise<void> {
    const data = await this.loadData() as Partial<PluginSettings> | null;
    // This is a breaking development release. Ignore the former collections schema.
    const batchSize = data?.scanBatchSize;
    this.settings = {
      defaultHome: typeof data?.defaultHome === "string" ? data.defaultHome : "",
      recursive: data?.recursive !== false,
      scanBatchSize: SCAN_BATCH_SIZES.some(size => size === batchSize)
        ? batchSize! : DEFAULT_SETTINGS.scanBatchSize,
      listBatchMode: data?.listBatchMode === "fixed" ? "fixed" : "auto",
      listBatchSize: LIST_BATCH_SIZES.some(size => size === data?.listBatchSize)
        ? data!.listBatchSize! : DEFAULT_SETTINGS.listBatchSize
    };
    this.repo = new EntryRepository(this.app);
    this.registerView(EXCERPTS_HOME_VIEW, leaf => new ExcerptsHomeFileView(leaf, this, this.repo));
    this.registerExtensions(["excerpts"], EXCERPTS_HOME_VIEW);
    this.settingsTab = new ExcerptsSettingTab(this.app, this);
    this.addSettingTab(this.settingsTab);
    this.addRibbonIcon("bookmark", "打开摘录首页", () => void this.openHome().catch(showError));
    this.addCommand({ id: "open-home", name: "打开摘录首页", callback: () => void this.openHome().catch(showError) });
    this.addCommand({ id: "refresh-home", name: "刷新摘录", callback: () => {
      const view = this.app.workspace.activeLeaf?.view;
      if (view instanceof ExcerptsHomeFileView) view.requestRefresh(true);
      else new Notice("请先打开并选中一个摘录页");
    } });
    this.registerEvent(this.app.vault.on("modify", file => {
      if (file instanceof TFile && file.extension.toLowerCase() === "excerpts") {
        for (const child of this.rendered) {
          if (child.workspace.homePath === file.path) child.invalidateHome("configuration");
        }
        return;
      }
      this.onFileChange(file.path);
    }));
    this.registerEvent(this.app.vault.on("create", file => this.onFileChange(file.path, file instanceof TFolder)));
    this.registerEvent(this.app.vault.on("delete", file => {
      const path = file.path;
      if (this.settings.defaultHome === path ||
          this.settings.defaultHome.startsWith(path + "/")) {
        this.settings.defaultHome = "";
        void this.saveSettings();
      }
      for (const child of this.rendered) {
        const home = child.workspace.homePath;
        if (home === path || home.startsWith(path + "/")) child.invalidateHome();
      }
      this.onFileChange(path, file instanceof TFolder);
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      // Do not migrate default-home pointers or running views to renamed paths.
      if (this.settings.defaultHome === oldPath ||
          this.settings.defaultHome.startsWith(oldPath + "/")) {
        this.settings.defaultHome = "";
        void this.saveSettings();
      }
      for (const child of this.rendered) {
        const home = child.workspace.homePath;
        if (home === oldPath || home.startsWith(oldPath + "/")) child.invalidateHome();
      }
      this.onFileChange(oldPath, file instanceof TFolder);
      this.onFileChange(file.path, file instanceof TFolder);
    }));
    this.registerEvent(this.app.metadataCache.on("changed", file => this.onFileChange(file.path)));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.scheduleEditorCleanup()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.scheduleEditorCleanup()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.scheduleEditorCleanup()));
  }
  onunload(): void {
    this.unloading = true;
    if (this.editorCleanupTimer) clearTimeout(this.editorCleanupTimer);
    this.temporaryEditors.clear();
  }
  /** Called after a newly created file has opened successfully in the native editor. */
  trackNewEditor(file: TFile, initialRaw: string): void {
    const frontmatter = initialRaw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n(?:\r?\n)?/)?.[0] ?? "";
    this.temporaryEditors.set(file, { path: file.path, frontmatter });
  }
  private isEditorOpen(file: TFile): boolean {
    return this.app.workspace.getLeavesOfType("markdown")
      .some(leaf => leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path);
  }
  private scheduleEditorCleanup(): void {
    if (this.unloading || !this.temporaryEditors.size) return;
    if (this.editorCleanupTimer) clearTimeout(this.editorCleanupTimer);
    this.editorCleanupTimer = setTimeout(() => {
      this.editorCleanupTimer = null;
      void this.cleanupClosedEditors().catch(showError);
    }, 1600);
  }
  /** Conservative removal: wait for native editor writes and compare persisted content twice. */
  private async cleanupClosedEditors(): Promise<void> {
    if (this.unloading) return;
    if (this.editorCleanupRunning) { this.scheduleEditorCleanup(); return; }
    this.editorCleanupRunning = true;
    try {
      for (const [file, candidate] of this.temporaryEditors) {
        if (this.unloading) return;
        if (this.isEditorOpen(file)) continue; // Switching tabs is not closing.
        // Do not delete a document if the user renamed or moved it.
        if (file.path !== candidate.path ||
            this.app.vault.getAbstractFileByPath(candidate.path) !== file) {
          this.temporaryEditors.delete(file);
          continue;
        }
        const beforeStamp = file.stat.mtime;
        const before = await this.app.vault.read(file);
        await new Promise<void>(resolve => setTimeout(resolve, 350));
        if (this.isEditorOpen(file)) continue;
        const after = await this.app.vault.read(file);
        if (before !== after || beforeStamp !== file.stat.mtime) {
          this.scheduleEditorCleanup();
          continue;
        }
        this.temporaryEditors.delete(file);
        // Any changed frontmatter, body, media, comments or other data preserves the file.
        if (!after.startsWith(candidate.frontmatter) ||
            after.slice(candidate.frontmatter.length).trim() !== "") continue;
        if (this.unloading || this.isEditorOpen(file) || file.path !== candidate.path ||
            this.app.vault.getAbstractFileByPath(candidate.path) !== file) continue;
        await this.app.fileManager.trashFile(file);
      }
    } finally {
      this.editorCleanupRunning = false;
    }
  }
  private onFileChange(path: string, folder = false): void {
    // A .excerpts file is page configuration, not a Markdown card.
    // Only a real vault "modify" event invalidates its active page.
    if (!folder && path.toLowerCase().endsWith(".excerpts")) return;
    // Vault events only invalidate the visible index; they never launch a scan.
    this.repo.invalidate(path);
    for (const child of this.rendered) {
      if (!folder) { child.markStale(path); continue; }
      const root = child.workspace.rootFolder;
      if (root === "/" || path === root || path.startsWith(root + "/") ||
          root.startsWith(path + "/")) child.markStale();
    }
  }
  canOpenHome(): boolean { return !this.homeNavigationBusy && !this.isBusy(); }
  /** Start creation synchronously. The token is the sole authority to release the lock. */
  private tryBeginHomeCreation(): symbol | null {
    if (!this.canOpenHome()) return null;
    const owner = Symbol("home-creation");
    this.homeCreationOwner = owner;
    this.notifyActivityChange();
    return owner;
  }
  private endHomeCreation(owner: symbol): void {
    if (this.homeCreationOwner !== owner) return;
    this.homeCreationOwner = null;
    this.notifyActivityChange();
  }
  /** Create and navigate under one owner; native first scans remain blocked until manual refresh. */
  async createAndOpenHome(folder: string): Promise<{ file: TFile; openError: Error | null }> {
    const owner = this.tryBeginHomeCreation();
    if (!owner) throw new Error("另一项摘录操作尚未完成，请结束后再创建首页");
    try {
      const file = await this.createHome(folder);
      try {
        await this.openHomeFile(file, owner);
        return { file, openError: null };
      } catch (error) {
        return { file, openError: error instanceof Error ? error : new Error(String(error)) };
      }
    } finally {
      this.endHomeCreation(owner);
    }
  }
  /** Acquire synchronously before any scan work or yield. Failed attempts are not queued. */
  tryAcquireScan(owner: ExcerptsRenderChild): boolean {
    if (this.homeCreationOwner !== null || this.scanOwner !== null) return false;
    this.scanOwner = owner;
    return true;
  }
  /** A cancelled/unloaded scan keeps its lock until its async task actually settles. */
  releaseScan(owner: ExcerptsRenderChild): void {
    if (this.scanOwner !== owner) return;
    this.scanOwner = null;
    this.notifyActivityChange(owner);
  }
  isBusy(except?: ExcerptsRenderChild): boolean {
    return this.homeCreationOwner !== null || (this.scanOwner !== null && this.scanOwner !== except) ||
      [...this.rendered].some(child => child !== except && child.isBusy());
  }
  notifyActivityChange(sender?: ExcerptsRenderChild): void {
    for (const child of this.rendered) if (child !== sender) child.syncControls();
    this.settingsTab?.syncBusy();
  }
  markAllStale(): void {
    for (const child of this.rendered) child.markStale();
  }
  trackRenderer(child: ExcerptsRenderChild): void {
    this.rendered.add(child);
    this.notifyActivityChange(child);
  }
  untrackRenderer(child: ExcerptsRenderChild): void {
    this.rendered.delete(child);
    this.notifyActivityChange(child);
  }
  refreshViews(force = false): void {
    for (const child of this.rendered) child.requestRefresh(force);
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
  /** Only 首页.excerpts is a default entrypoint; opening a filtered page never replaces it. */
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
  private savedPagePath(homePath: string, name: string): string {
    const home = this.app.vault.getAbstractFileByPath(homePath);
    if (!(home instanceof TFile) || home.extension !== "excerpts")
      throw new Error("当前摘录页文件不存在");
    const prefix = home.parent?.path && home.parent.path !== "/" ? home.parent.path + "/" : "";
    return prefix + name.trim().normalize("NFC") + ".excerpts";
  }
  savedPageNameIssue(homePath: string, name: string): string | null {
    const error = pageNameError(name);
    if (error) return error;
    const path = this.savedPagePath(homePath, name);
    const key = path.normalize("NFC").toLocaleLowerCase("en-US");
    return this.app.vault.getAllLoadedFiles().some(file =>
      file.path.normalize("NFC").toLocaleLowerCase("en-US") === key)
      ? "已存在同名文件，请更换名称" : null;
  }
  async createSavedPage(homePath: string, name: string, filter: PageFilter): Promise<TFile> {
    const issue = this.savedPageNameIssue(homePath, name);
    if (issue) throw new Error(issue);
    const path = this.savedPagePath(homePath, name);
    // Vault.create rejects a concurrent duplicate; never overwrite an existing page.
    return this.app.vault.create(path, serializePageFilter(filter));
  }
  async updateSavedPage(path: string, expectedRaw: string, filter: PageFilter): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension !== "excerpts" || !expectedRaw.trim())
      throw new Error("无法更新当前摘录页");
    const content = serializePageFilter(filter);
    await this.app.vault.process(file, current => {
      if (current !== expectedRaw) throw new Error("摘录页已被其他操作修改，请重新打开");
      return content;
    });
    return content;
  }
  /** Normal navigation never bypasses the global creation lock. */
  async openHome(path?: string): Promise<void> {
    if (!this.canOpenHome())
      throw new Error("另一项摘录操作尚未完成，请结束后再打开摘录页");
    const homes = this.getHomeFiles();
    const file = path
      ? homes.find(item => item.path === path)
      : homes.find(item => item.path === this.settings.defaultHome) ??
        homes.find(item => item.basename === "首页");
    if (!file) throw new Error(path
      ? "摘录页文件不存在：" + path
      : "没有首页.excerpts，请在插件设置中创建首页入口");
    // The synchronous flag rejects a second openHome before native navigation yields.
    this.homeNavigationBusy = true;
    this.notifyActivityChange();
    try {
      await this.openHomeFile(file);
    } finally {
      this.homeNavigationBusy = false;
      this.notifyActivityChange();
    }
  }
  /** Owner-restricted navigation; only createAndOpenHome may pass the owner token. */
  private async openHomeFile(file: TFile, owner?: symbol): Promise<void> {
    if (owner !== undefined) {
      if (this.homeCreationOwner !== owner) throw new Error("首页创建操作已失效");
    } else if (!this.homeNavigationBusy || this.homeCreationOwner !== null) {
      throw new Error("另一项摘录操作尚未完成，请结束后再打开摘录页");
    }
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    await this.app.workspace.revealLeaf(leaf);
  }
  /** Reading uses the native Markdown preview mode, with no editor focus or soft keyboard. */
  async openMarkdownPreview(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== "md")
      throw new Error("Markdown 文件不存在：" + path);
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: "markdown", state: { file: path, mode: "preview" } });
    if (!(leaf.view instanceof MarkdownView) || leaf.view.getMode() !== "preview")
      throw new Error("无法切换到 Markdown 阅读模式");
    await this.app.workspace.revealLeaf(leaf);
  }
  async openMarkdown(path: string, line?: number, atEnd = false): Promise<void> {
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
      if (line !== undefined || atEnd) {
        const lastLine = atEnd ? view.editor.lastLine() : 0;
        const cursor = line !== undefined ? { line, ch: 0 } :
          { line: lastLine, ch: view.editor.getLine(lastLine).length };
        view.editor.setCursor(cursor);
        view.editor.scrollIntoView({ from: cursor, to: cursor }, true);
      }
      view.editor.focus();
    }
  }
}
function showError(error: unknown): void { new Notice(error instanceof Error ? error.message : String(error)); }
