import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type ExcerptsPlugin from "./main";
export class ExcerptsSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ExcerptsPlugin) { super(app, plugin); }
  display(): void {
    const root = this.containerEl;
    root.empty();
    root.createEl("h2", { text: "摘录 · Excerpts" });
    root.createEl("p", { text: "首页.excerpts 是主入口；其他 .excerpts 文件可保存独立筛选，摘录内容仍是普通 Markdown。" });
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
    const files = this.plugin.getHomeFiles();
    const homes = files.filter(file => file.basename === "首页" ||
      file.path === this.plugin.settings.defaultHome);
    const pages = files.filter(file => !homes.includes(file));
    if (!homes.length) root.createEl("p", { text: "尚无 首页.excerpts，请在上方创建。" });
    for (const file of homes) {
      new Setting(root).setName(file.path)
        .setDesc(file.path === this.plugin.settings.defaultHome ? "默认首页" : "全部摘录入口")
        .addButton(b => b.setButtonText("打开").onClick(() => void this.plugin.openHome(file.path)));
    }
    if (pages.length) {
      root.createEl("h3", { text: "已保存的摘录页" });
      for (const file of pages) {
        new Setting(root).setName(file.basename)
          .setDesc(file.path)
          .addButton(b => b.setButtonText("打开").onClick(() => void this.plugin.openHome(file.path)));
      }
    }
    root.createEl("h3", { text: "文件范围" });
    new Setting(root).setName("包含子文件夹")
      .setDesc("包含首页所在目录下子文件夹中的 Markdown 文件。")
      .addToggle(t => t.setValue(this.plugin.settings.recursive).onChange(async (v: boolean) => {
        this.plugin.settings.recursive = v;
        await this.plugin.saveSettings();
        this.plugin.refreshViews(true);
      }));

  }
}
function message(value: unknown): string { return value instanceof Error ? value.message : String(value); }
