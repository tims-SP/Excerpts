import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type ExcerptsPlugin from "./main";
export class ExcerptsSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ExcerptsPlugin) { super(app, plugin); }
  display(): void {
    const root = this.containerEl;
    root.empty();
    root.createEl("h2", { text: "摘录 · Excerpts" });
    root.createEl("p", { text: "首页.excerpts 是界面入口，它所在文件夹的普通 .md 文件就是摘录。无需收藏集名称、ID 或附属目录。" });
    root.createEl("h3", { text: "首页入口" });
    let folder = "";
    new Setting(root).setName("创建首页文件")
      .setDesc("在 Vault 内指定文件夹，创建空白首页.excerpts。已有文件不会被覆盖。")
      .addText(t => t.setPlaceholder("笔记/摘录").onChange((v: string) => { folder = v; }))
      .addButton(b => b.setCta().setButtonText("创建并打开").onClick(async () => {
        try {
          const file = await this.plugin.createHome(folder);
          await this.plugin.openHome(file.path);
          this.display();
        } catch (error) { new Notice(message(error)); }
      }));
    const homes = this.plugin.getHomeFiles();
    if (!homes.length) root.createEl("p", { text: "尚无 .excerpts 首页文件。" });
    for (const file of homes) {
      new Setting(root).setName(file.path)
        .setDesc(file.path === this.plugin.settings.defaultHome ? "默认首页" : "点击即可直接进入该目录的摘录时间线")
        .addButton(b => b.setButtonText("打开").onClick(() => void this.plugin.openHome(file.path)));
    }
    root.createEl("h3", { text: "展示与同步" });
    new Setting(root).setName("包含子文件夹")
      .addToggle(t => t.setValue(this.plugin.settings.recursive).onChange(async (v: any) => {
        this.plugin.settings.recursive = v; await this.plugin.saveSettings(); this.plugin.refreshViews(true);
      }));
    new Setting(root).setName("自动更新")
      .setDesc("合并 Markdown 文件变化；关闭后可手动刷新。")
      .addToggle(t => t.setValue(this.plugin.settings.autoRefresh).onChange(async (v: any) => {
        this.plugin.settings.autoRefresh = v; await this.plugin.saveSettings();
      }));
    new Setting(root).setName("完整校验间隔")
      .addDropdown(d => d.addOptions({ "0": "关闭", "5": "5 分钟", "15": "15 分钟", "30": "30 分钟" })
        .setValue(String(this.plugin.settings.checkMinutes)).onChange(async (v: any) => {
          this.plugin.settings.checkMinutes = Number(v); await this.plugin.saveSettings();
        }));
    new Setting(root).setName("全文搜索批量")
      .addDropdown(d => d.addOptions({ "20": "20", "40": "40", "80": "80" })
        .setValue(String(this.plugin.settings.batchSize)).onChange(async (v: any) => {
          this.plugin.settings.batchSize = Number(v); await this.plugin.saveSettings();
        }));
    new Setting(root).setName("时间线排序")
      .addDropdown(d => d.addOptions({ newest: "最近优先", oldest: "最早优先" })
        .setValue(this.plugin.settings.defaultSort).onChange(async (v: any) => {
          this.plugin.settings.defaultSort = v === "oldest" ? "oldest" : "newest";
          await this.plugin.saveSettings(); this.plugin.refreshViews();
        }));
    new Setting(root).setName("刷新全部视图")
      .addButton(b => b.setButtonText("刷新").onClick(() => this.plugin.refreshViews(true)));
  }
}
function message(value: unknown): string { return value instanceof Error ? value.message : String(value); }
