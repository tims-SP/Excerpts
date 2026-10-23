import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type ExcerptsPlugin from "./main";
import { Workspace, makeId, validateRelativePath, workspacePaths } from "./model";

export class ExcerptsSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ExcerptsPlugin) { super(app, plugin); }
  display(): void {
    const c = this.containerEl;
    c.empty();
    c.createEl("h2", { text: "摘录 · Excerpts" });
    c.createEl("p", { text: "在选定的文件夹内建立独立的收藏工作区。其他笔记保持原来的界面。" });
    c.createEl("h3", { text: "创建收藏集" });
    let name = "我的摘录", folder = "";
    new Setting(c).setName("收藏集名称").addText(t => t.setPlaceholder("我的摘录").setValue(name).onChange((v: string) => { name = v; }));
    new Setting(c).setName("工作区文件夹").setDesc("Vault 内相对路径；例如：资料/摘录。不会改动已有笔记。").addText(t => t.setPlaceholder("资料/摘录").onChange((v: string) => { folder = v; }));
    new Setting(c).addButton(b => b.setButtonText("创建收藏集").setCta().onClick(async () => {
      try {
        await this.plugin.createWorkspace(name.trim(), folder.trim());
        new Notice("收藏集已创建，可从下方打开首页");
        this.display();
      } catch (e) { new Notice(`创建失败：${message(e)}`); }
    }));
    c.createEl("h3", { text: "已有收藏集" });
    if (!this.plugin.settings.workspaces.length) c.createEl("p", { text: "尚未创建收藏集。" });
    for (const ws of this.plugin.settings.workspaces) this.addWorkspaceSettings(c, ws);
    c.createEl("h3", { text: "展示偏好" });
    new Setting(c).setName("打开首页时进入摘录视图")
      .setDesc("默认启用。关闭后可以直接编辑收藏集首页的原始 Markdown，设置页的‘打开首页’仍会进入独立视图。")
      .addToggle(t => t.setValue(this.plugin.settings.autoOpenHome).onChange(async (v: boolean) => {
        this.plugin.settings.autoOpenHome = v;
        await this.plugin.saveSettings();
      }));
    new Setting(c).setName("默认折叠附属内容").addToggle(t => t.setValue(this.plugin.settings.collapseExtras).onChange(async (v: boolean) => { this.plugin.settings.collapseExtras = v; await this.plugin.saveSettings(); }));
    new Setting(c).setName("默认排序").addDropdown(d => d.addOptions({ newest: "最新优先", oldest: "最早优先" }).setValue(this.plugin.settings.defaultSort).onChange(async (v: string) => {
      this.plugin.settings.defaultSort = v === "oldest" ? "oldest" : "newest";
      await this.plugin.saveSettings();
    }));
  }
  private addWorkspaceSettings(c: HTMLElement, ws: Workspace) {
    c.createEl("h4", { text: ws.name });
    c.createEl("p", { text: `目录：${ws.rootFolder}　·　首页：${workspacePaths(ws).home}` });
    new Setting(c).setName("打开收藏集").addButton(b => b.setButtonText("打开首页").onClick(() => void this.plugin.openWorkspace(ws)));
    let proposed = ws.rootFolder;
    new Setting(c).setName("更换关联文件夹").setDesc("仅切换工作区关联路径，不移动、复制或删除旧文件。新目录必须已有正确的首页入口。")
      .addText(t => t.setValue(ws.rootFolder).onChange((v: string) => { proposed = v; }))
      .addButton(b => b.setButtonText("更新路径").onClick(async () => {
        try {
          const newRoot = validateRelativePath(proposed);
          await this.plugin.repointWorkspace(ws.id, newRoot);
          this.display(); new Notice("工作区关联路径已更新");
        } catch(e) { new Notice(message(e)); }
      }));
    new Setting(c).setName("移除工作区配置").setDesc("仅从插件设置中移除，不删除任何 Markdown 文件。")
      .addButton(b => b.setWarning().setButtonText("移除配置").onClick(async () => {
        this.plugin.settings.workspaces = this.plugin.settings.workspaces.filter(w => w.id !== ws.id);
        await this.plugin.saveSettings();
        this.display();
      }));
  }
}
function message(e: unknown) { return e instanceof Error ? e.message : String(e); }
