import { ItemView, WorkspaceLeaf } from "obsidian";
import type ExcerptsPlugin from "./main";
import type { Workspace } from "./model";
import { EntryRepository } from "./repository";
import { ExcerptsRenderChild } from "./view";

/** A real Obsidian pane, not a rendered section inside a Markdown document. */
export const EXCERPTS_COLLECTION_VIEW = "excerpts-collection";

export class ExcerptsCollectionView extends ItemView {
  private renderer: ExcerptsRenderChild | null = null;
  private workspaceId = "";
  constructor(leaf: WorkspaceLeaf, private readonly plugin: ExcerptsPlugin, private readonly repo: EntryRepository) {
    super(leaf);
  }
  getViewType(): string { return EXCERPTS_COLLECTION_VIEW; }
  getState(): Record<string, unknown> { return { workspaceId: this.workspaceId }; }
  getDisplayText(): string { return "摘录"; }
  getIcon(): string { return "bookmark"; }
  async onOpen(): Promise<void> { this.renderCurrent(); }
  async setState(state: Record<string, unknown>, result: any): Promise<void> {
    this.workspaceId = typeof state.workspaceId === "string" ? state.workspaceId : "";
    await super.setState(state, result);
    this.renderCurrent();
  }
  async onClose(): Promise<void> { this.teardown(); }
  private teardown(): void {
    if (this.renderer) {
      this.plugin.untrackRenderer(this.renderer);
      this.renderer.onunload();
      this.renderer = null;
    }
  }
  private renderCurrent(): void {
    this.teardown();
    this.contentEl.empty();
    this.contentEl.addClass("excerpts-native-host");
    const ws: Workspace | undefined = this.plugin.settings.workspaces.find(x => x.id === this.workspaceId);
    if (!ws) {
      this.contentEl.createEl("p", { text: "找不到对应的摘录收藏集。请在插件设置中重新打开。" });
      return;
    }
    const root = this.contentEl.createDiv();
    this.renderer = new ExcerptsRenderChild(root, this.plugin, ws, this.repo);
    this.plugin.trackRenderer(this.renderer);
    this.renderer.onload();
  }
}
