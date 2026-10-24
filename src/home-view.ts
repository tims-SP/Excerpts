import { FileView, TFile, WorkspaceLeaf } from "obsidian";
import type ExcerptsPlugin from "./main";
import { EntryRepository } from "./repository";
import { ExcerptsRenderChild } from "./view";
import { parsePageFilter } from "./page-config";

export const EXCERPTS_HOME_VIEW = "excerpts-home-file";

/** Opening 首页.excerpts from the file explorer resolves directly to the beta.6-style feed. */
export class ExcerptsHomeFileView extends FileView {
  private renderer: ExcerptsRenderChild | null = null;
  constructor(leaf: WorkspaceLeaf, private plugin: ExcerptsPlugin, private repo: EntryRepository) {
    super(leaf);
  }
  getViewType(): string { return EXCERPTS_HOME_VIEW; }
  getDisplayText(): string { return this.file?.basename ?? "摘录"; }
  getIcon(): string { return "bookmark"; }
  async onLoadFile(file: TFile): Promise<void> {
    this.teardown();
    this.contentEl.empty();
    this.contentEl.addClass("excerpts-native-host");
    const root = this.contentEl.createDiv();
    let filter;
    let raw: string;
    try {
      raw = await this.plugin.app.vault.cachedRead(file);
      filter = parsePageFilter(raw);
    } catch (error) {
      root.setText(error instanceof Error ? error.message : String(error));
      root.addClass("ex-page-error");
      return;
    }
    this.renderer = new ExcerptsRenderChild(root, this.plugin, this.plugin.workspaceForHome(file),
      this.repo, filter, filter ? raw : null);
    this.plugin.trackRenderer(this.renderer);
    this.renderer.load();
    if (file.basename === "首页" && !filter) {
      void this.plugin.rememberHome(file.path).catch(error => {
        console.error("Excerpts: failed to persist the default homepage", error);
      });
    }
  }
  async onUnloadFile(_file: TFile): Promise<void> { this.teardown(); }
  async onClose(): Promise<void> { this.teardown(); }
  private teardown(): void {
    if (this.renderer) {
      this.plugin.untrackRenderer(this.renderer);
      this.renderer.unload();
      this.renderer = null;
    }
  }
}
