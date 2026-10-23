import { ItemView, WorkspaceLeaf } from "obsidian";
import type ExcerptsPlugin from "./main";
import type { Workspace } from "./model";
import { EntryRepository } from "./repository";
import { ExcerptsRenderChild } from "./view";
export const EXCERPTS_COLLECTION_VIEW = "excerpts-collection";
export class ExcerptsCollectionView extends ItemView {
  private renderer: ExcerptsRenderChild | null = null;
  private workspaceId = "";
  constructor(leaf: WorkspaceLeaf, private plugin: ExcerptsPlugin, private repo: EntryRepository) { super(leaf); }
  getViewType(): string { return EXCERPTS_COLLECTION_VIEW; }
  getState(): Record<string, unknown> { return { workspaceId: this.workspaceId }; }
  getDisplayText(): string {
    const ws = this.plugin.settings.workspaces.find(w => w.id === this.workspaceId);
    return ws ? ws.name + " · 摘录" : "摘录首页";
  }
  getIcon(): string { return "bookmark"; }
  async onOpen(): Promise<void> { this.renderCurrent(); }
  async setState(state: Record<string, unknown>, result: any): Promise<void> {
    this.workspaceId = typeof state.workspaceId === "string" ? state.workspaceId : "";
    await super.setState(state, result);
    this.renderCurrent();
  }
  async onClose(): Promise<void> { this.teardown(); }
  private teardown(): void {
    if (!this.renderer) return;
    this.plugin.untrackRenderer(this.renderer);
    this.renderer.unload();
    this.renderer = null;
  }
  private renderCurrent(): void {
    this.teardown();
    this.contentEl.empty();
    this.contentEl.addClass("excerpts-native-host");
    if (!this.workspaceId) { this.renderHome(); return; }
    const ws: Workspace | undefined = this.plugin.settings.workspaces.find(w => w.id === this.workspaceId);
    if (!ws) { this.contentEl.createEl("p", { text: "收藏集不存在，请在设置中重新打开。" }); return; }
    const root = this.contentEl.createDiv();
    this.renderer = new ExcerptsRenderChild(root, this.plugin, ws, this.repo);
    this.plugin.trackRenderer(this.renderer);
    this.renderer.load();
  }
  private renderHome(): void {
    const root = document.createElement("div");
    root.className = "excerpts-root ex-home";
    const heading = document.createElement("h2");
    heading.className = "ex-title";
    heading.textContent = "摘录首页";
    root.append(heading);
    const description = document.createElement("p");
    description.className = "ex-home-description";
    description.textContent = "选择一个收藏集，查看其中的 Markdown 摘录。";
    root.append(description);
    const list = document.createElement("div");
    list.className = "ex-home-list";
    for (const ws of this.plugin.settings.workspaces) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "ex-home-item";
      const name = document.createElement("span");
      name.className = "ex-home-name";
      name.textContent = ws.name;
      const location = document.createElement("span");
      location.className = "ex-home-path";
      location.textContent = ws.rootFolder;
      item.append(name, location);
      item.addEventListener("click", () => {
        void this.plugin.openWorkspace(ws).catch(error => {
          const warning = document.createElement("p");
          warning.className = "ex-warning";
          warning.textContent = "打开收藏集失败：" + (error instanceof Error ? error.message : String(error));
          root.append(warning);
        });
      });
      list.append(item);
    }
    if (!list.childElementCount) {
      const empty = document.createElement("p");
      empty.className = "ex-empty";
      empty.textContent = "尚未添加收藏集。请在 Obsidian 设置中选择 Markdown 文件夹。";
      root.append(empty);
    }
    root.append(list);
    this.contentEl.append(root);
  }
}
