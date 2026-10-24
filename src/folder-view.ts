import { ItemView, TFolder, ViewStateResult, WorkspaceLeaf } from "obsidian";
import type ExcerptsPlugin from "./main";
import { EntryRepository } from "./repository";
import { ExcerptsRenderChild } from "./view";

export const EXCERPTS_FOLDER_VIEW = "excerpts-folder";

/** An actual Vault folder is the feed scope, with its own restorable tab. */
export class ExcerptsFolderView extends ItemView {
  private folderPath = "";
  private sourceFolder: TFolder | null = null;
  private renderer: ExcerptsRenderChild | null = null;
  constructor(leaf: WorkspaceLeaf, private plugin: ExcerptsPlugin, private repo: EntryRepository) {
    super(leaf);
  }
  getViewType(): string { return EXCERPTS_FOLDER_VIEW; }
  getDisplayText(): string { return this.folderPath.split("/").pop() || "摘录"; }
  getIcon(): string { return "bookmark"; }
  getState(): { folderPath: string } { return { folderPath: this.folderPath }; }
  matchesFolder(folder: TFolder): boolean {
    return this.sourceFolder === folder && this.folderPath === folder.path;
  }
  requestRefresh(force = false): void { this.renderer?.requestRefresh(force); }
  async setState(state: { folderPath?: string }, result: ViewStateResult): Promise<void> {
    this.teardown();
    this.folderPath = typeof state?.folderPath === "string" ? state.folderPath : "";
    this.contentEl.empty();
    this.contentEl.addClass("excerpts-native-host");
    const root = this.contentEl.createDiv();
    const folder = this.plugin.resolveFolder(this.folderPath);
    if (!folder) {
      root.addClass("ex-page-error");
      root.textContent = "文件夹不存在或已移动，请从文件夹右键菜单重新打开摘录";
      await super.setState(state, result);
      return;
    }
    this.sourceFolder = folder;
    try {
      this.renderer = new ExcerptsRenderChild(root, this.plugin,
        this.plugin.workspaceForFolder(folder), this.repo);
      this.plugin.trackRenderer(this.renderer);
      this.renderer.load();
      await super.setState(state, result);
    } catch (error) {
      this.teardown();
      throw error;
    }
  }
  async onClose(): Promise<void> { this.teardown(); }
  private teardown(): void {
    if (this.renderer) {
      this.plugin.untrackRenderer(this.renderer);
      this.renderer.unload();
      this.renderer = null;
    }
    this.sourceFolder = null;
  }
}
