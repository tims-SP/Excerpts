import { MarkdownPostProcessorContext, Plugin, TFile, TFolder, Notice } from "obsidian";
import { DEFAULT_SETTINGS, PluginSettings, Workspace, belongsTo, joinPath, makeId, validateRelativePath, workspacePaths } from "./model";
import { EntryRepository } from "./repository";
import { ExcerptsSettingTab } from "./settings";
import { ExcerptsRenderChild } from "./view";

export default class ExcerptsPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS, workspaces: [] };
  private repo!: EntryRepository;
  private rendered = new Set<ExcerptsRenderChild>();
  async onload(): Promise<void> {
    const raw = await this.loadData() as Partial<PluginSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(raw || {}), workspaces: Array.isArray(raw?.workspaces) ? raw!.workspaces : [] };
    this.repo = new EntryRepository(this.app);
    this.addSettingTab(new ExcerptsSettingTab(this.app, this));
    this.registerMarkdownCodeBlockProcessor("excerpts", (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
      const match = source.match(/^workspace:\s*([a-zA-Z0-9_-]+)\s*$/m);
      if (!match) { el.setText("Excerpts：缺少 workspace 配置"); return; }
      const ws = this.settings.workspaces.find(w => w.id === match[1]);
      if (!ws || ctx.sourcePath !== workspacePaths(ws).home) {
        el.setText("Excerpts：此工作区入口未获授权，或首页路径发生变化"); return;
      }
      const child = new ExcerptsRenderChild(el, this, ws, this.repo);
      this.rendered.add(child);
      const oldUnload = child.onunload.bind(child);
      child.onunload = () => { oldUnload(); this.rendered.delete(child); };
      ctx.addChild(child);
    });
    this.addCommand({ id: "open-collection", name: "打开摘录收藏集", callback: () => {
      const first = this.settings.workspaces[0];
      if (first) void this.openWorkspace(first);
      else new Notice("请先在插件设置中创建收藏集");
    }});
    this.registerEvent(this.app.vault.on("modify", file => this.fileChanged(file.path)));
    this.registerEvent(this.app.vault.on("create", file => this.fileChanged(file.path)));
    this.registerEvent(this.app.vault.on("delete", file => this.fileChanged(file.path)));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      void this.handleRename(file.path, oldPath);
      this.fileChanged(file.path); this.fileChanged(oldPath);
    }));
  }
  private fileChanged(path: string): void {
    for (const child of this.rendered) {
      const ws = child.workspace;
      if (ws && belongsTo(path, workspacePaths(ws).cards)) child.requestRefresh();
    }
  }
  async saveSettings(): Promise<void> { await this.saveData(this.settings); }
  async createWorkspace(name: string, folder: string): Promise<Workspace> {
    if (!name) throw new Error("收藏集名称不能为空");
    const rootFolder = validateRelativePath(folder);
    if (this.settings.workspaces.some(x => x.rootFolder === rootFolder || belongsTo(rootFolder, x.rootFolder) || belongsTo(x.rootFolder, rootFolder))) {
      throw new Error("此路径与已有工作区重叠，请使用独立的文件夹");
    }
    const ws: Workspace = { id: makeId("w"), name, rootFolder, entryFile: "首页.md", cardsFolder: "Cards", attachmentsFolder: "Attachments" };
    const p = workspacePaths(ws);
    // Check existing homepage before creating anything. Never overwrite user content.
    if (this.app.vault.getAbstractFileByPath(p.home)) throw new Error("首页文件已存在，请选择其他工作区目录");
    await this.repo.ensureFolder(p.root);
    await this.repo.ensureFolder(p.cards);
    await this.repo.ensureFolder(p.attachments);
    await this.app.vault.create(p.home, `# ${name}\n\n\`\`\`excerpts\nworkspace: ${ws.id}\n\`\`\`\n`);
    this.settings.workspaces.push(ws);
    await this.saveSettings();
    return ws;
  }
  async repointWorkspace(id: string, folder: string): Promise<void> {
    const ws = this.settings.workspaces.find(x => x.id === id);
    if (!ws) throw new Error("收藏集不存在");
    const candidateRoot = validateRelativePath(folder);
    if (this.settings.workspaces.some(x => x.id !== id && (x.rootFolder === candidateRoot || belongsTo(candidateRoot, x.rootFolder) || belongsTo(x.rootFolder, candidateRoot)))) {
      throw new Error("工作区目录不能重叠");
    }
    const candidate = { ...ws, rootFolder: candidateRoot };
    const home = this.app.vault.getAbstractFileByPath(workspacePaths(candidate).home);
    if (!(home instanceof TFile)) throw new Error("新路径没有有效首页，请通过 Obsidian 文件管理器移动整个工作区文件夹");
    const source = await this.app.vault.cachedRead(home);
    // Require a real excerpts codeblock, not a coincidental string in a note.
    const bindings = [...source.matchAll(/```excerpts[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n```/g)];
    if (!bindings.some(match => match[1].trim() === `workspace: ${ws.id}`)) {
      throw new Error("目标首页未绑定当前工作区 ID");
    }
    ws.rootFolder = candidate.rootFolder;
    await this.saveSettings();
  }
  private async handleRename(path: string, previous: string): Promise<void> {
    let dirty = false;
    for (const ws of this.settings.workspaces) {
      if (ws.rootFolder === previous || ws.rootFolder.startsWith(previous + "/")) {
        ws.rootFolder = path + ws.rootFolder.slice(previous.length); dirty = true; continue;
      }
      if (previous === workspacePaths(ws).home) {
        // Only a basename in the same workspace is supported for homepage renames.
        if (path.startsWith(ws.rootFolder + "/")) { ws.entryFile = path.slice(ws.rootFolder.length + 1); dirty = true; }
      }
      const cards = joinPath(ws.rootFolder, ws.cardsFolder);
      if (previous === cards && path.startsWith(ws.rootFolder + "/")) { ws.cardsFolder = path.slice(ws.rootFolder.length + 1); dirty = true; }
    }
    if (dirty) await this.saveSettings();
  }
  async openWorkspace(ws: Workspace): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(workspacePaths(ws).home);
    if (!(file instanceof TFile)) { new Notice("找不到工作区首页，请在设置中核对路径"); return; }
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file, { state: { mode: "preview" } });
    this.app.workspace.revealLeaf(leaf);
  }
}
