import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type ExcerptsPlugin from "./main";
import { Workspace } from "./model";
export class ExcerptsSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ExcerptsPlugin) { super(app, plugin); }
  display(): void {
    const c = this.containerEl;
    c.empty();
    c.createEl("h2", { text: "摘录 · Excerpts" });
    c.createEl("p", { text: "直接读取普通 Markdown 文件夹，不要求 Cards 目录、专用标记或附件管理。" });
    let name = "我的摘录", folder = "";
    new Setting(c).setName("收藏集名称").addText(t => t.setValue(name).onChange(v => { name = v; }));
    new Setting(c).setName("Vault 内文件夹")
      .setDesc("直接指定已有文件夹；不存在时创建。")
      .addText(t => t.setPlaceholder("资料/摘录").onChange(v => { folder = v; }));
    new Setting(c).addButton(b => b.setButtonText("添加收藏集").setCta().onClick(async () => {
      try { await this.plugin.createWorkspace(name, folder); this.display(); }
      catch (e) { new Notice(message(e)); }
    }));
    c.createEl("h3", { text: "收藏集" });
    for (const ws of this.plugin.settings.workspaces) this.workspaceSettings(c, ws);
    c.createEl("h3", { text: "文件更新与性能" });
    new Setting(c).setName("自动更新")
      .setDesc("合并 Vault 文件事件；关闭后可使用手动刷新。")
      .addToggle(t => t.setValue(this.plugin.settings.autoRefresh).onChange(async value => {
        this.plugin.settings.autoRefresh = value; await this.plugin.saveSettings();
      }));
    new Setting(c).setName("完整校验间隔")
      .setDesc("仅在收藏视图打开时校验；0 表示关闭。")
      .addDropdown(d => d.addOptions({ "0": "关闭（推荐）", "5": "5 分钟", "15": "15 分钟", "30": "30 分钟", "60": "60 分钟" })
        .setValue(String(this.plugin.settings.checkMinutes)).onChange(async value => {
          this.plugin.settings.checkMinutes = Number(value); await this.plugin.saveSettings();
        }));
    new Setting(c).setName("每批搜索文件数")
      .addDropdown(d => d.addOptions({ "20": "20", "40": "40（推荐）", "80": "80" })
        .setValue(String(this.plugin.settings.batchSize)).onChange(async value => {
          this.plugin.settings.batchSize = Number(value); await this.plugin.saveSettings();
        }));
    new Setting(c).setName("排序")
      .addDropdown(d => d.addOptions({ newest: "最近修改优先", oldest: "最早修改优先" })
        .setValue(this.plugin.settings.defaultSort).onChange(async value => {
          this.plugin.settings.defaultSort = value === "oldest" ? "oldest" : "newest";
          await this.plugin.saveSettings(); this.plugin.refreshViews();
        }));
    new Setting(c).setName("手动刷新").addButton(b => b.setButtonText("刷新全部收藏集").onClick(() => this.plugin.refreshViews(true)));
  }
  private workspaceSettings(c: HTMLElement, ws: Workspace): void {
    c.createEl("h4", { text: ws.name });
    c.createEl("p", { text: ws.rootFolder });
    new Setting(c).setName("打开视图").addButton(b => b.setButtonText("打开").onClick(() => void this.plugin.openWorkspace(ws)));
    new Setting(c).setName("包含子文件夹")
      .addToggle(t => t.setValue(ws.recursive).onChange(async value => {
        ws.recursive = value; await this.plugin.saveSettings(); this.plugin.refreshViews();
      }));
    let path = ws.rootFolder;
    new Setting(c).setName("关联文件夹").addText(t => t.setValue(path).onChange(value => { path = value; }))
      .addButton(b => b.setButtonText("更新").onClick(async () => {
        try { await this.plugin.repointWorkspace(ws.id, path); this.display(); }
        catch (e) { new Notice(message(e)); }
      }));
    new Setting(c).setName("移除收藏集配置")
      .setDesc("不删除任何 Markdown 文件。")
      .addButton(b => b.setWarning().setButtonText("移除").onClick(async () => {
        this.plugin.settings.workspaces = this.plugin.settings.workspaces.filter(x => x.id !== ws.id);
        await this.plugin.saveSettings(); this.display();
      }));
  }
}
function message(e: unknown): string { return e instanceof Error ? e.message : String(e); }
