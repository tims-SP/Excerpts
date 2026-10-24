import { App, Notice, PluginSettingTab, Setting, ToggleComponent, DropdownComponent, ButtonComponent } from "obsidian";
import type ExcerptsPlugin from "./main";
import { SCAN_BATCH_SIZES } from "./model";
export class ExcerptsSettingTab extends PluginSettingTab {
  private scopeToggle: ToggleComponent | null = null;
  private batchDropdown: DropdownComponent | null = null;
  private homeButtons: ButtonComponent[] = [];
  syncBusy(): void {
    const busy = this.plugin.isBusy();
    this.scopeToggle?.setDisabled(busy);
    this.batchDropdown?.setDisabled(busy);
    for (const button of this.homeButtons) button.setDisabled(busy);
  }
  private canOpen(): boolean {
    if (this.plugin.canOpenHome()) return true;
    new Notice("另一项摘录操作尚未完成，请结束后再打开摘录页");
    return false;
  }
  constructor(app: App, private plugin: ExcerptsPlugin) { super(app, plugin); }
  display(): void {
    const root = this.containerEl;
    root.empty();
    this.scopeToggle = null;
    this.batchDropdown = null;
    this.homeButtons = [];
    root.createEl("h2", { text: "摘录 · Excerpts" });
    root.createEl("p", { text: "首页.excerpts 是主入口；其他 .excerpts 文件可保存独立筛选，摘录内容仍是普通 Markdown。" });
    root.createEl("h3", { text: "首页入口" });
    let folder = "";
    new Setting(root).setName("创建首页文件")
      .setDesc("在 Vault 内指定文件夹，创建空白首页.excerpts。已有文件不会被覆盖。")
      .addText(t => t.setPlaceholder("笔记/摘录").onChange((v: string) => { folder = v; }))
      .addButton(b => {
        this.homeButtons.push(b);
        b.setCta().setButtonText("创建并打开").onClick(async () => {
          if (!this.canOpen()) return;
          try {
          const file = await this.plugin.createHome(folder);
          await this.plugin.openHome(file.path);
          this.display();
          } catch (error) { new Notice(message(error)); }
        });
      });
    const files = this.plugin.getHomeFiles();
    const homes = files.filter(file => file.basename === "首页" ||
      file.path === this.plugin.settings.defaultHome);
    const pages = files.filter(file => !homes.includes(file));
    if (!homes.length) root.createEl("p", { text: "尚无 首页.excerpts，请在上方创建。" });
    for (const file of homes) {
      new Setting(root).setName(file.path)
        .setDesc(file.path === this.plugin.settings.defaultHome ? "默认首页" : "全部摘录入口")
        .addButton(b => {
          this.homeButtons.push(b);
          b.setButtonText("打开").onClick(() => {
            if (!this.canOpen()) return;
            void this.plugin.openHome(file.path);
          });
        });
    }
    if (pages.length) {
      root.createEl("h3", { text: "已保存的摘录页" });
      for (const file of pages) {
        new Setting(root).setName(file.basename)
          .setDesc(file.path)
          .addButton(b => {
          this.homeButtons.push(b);
          b.setButtonText("打开").onClick(() => {
            if (!this.canOpen()) return;
            void this.plugin.openHome(file.path);
          });
        });
      }
    }
    root.createEl("h3", { text: "文件范围" });
    new Setting(root).setName("包含子文件夹")
      .setDesc("包含首页所在目录下子文件夹中的 Markdown 文件。")
      .addToggle(t => {
        this.scopeToggle = t;
        t.setValue(this.plugin.settings.recursive).onChange(async (v: boolean) => {
          if (this.plugin.isBusy()) {
            t.setValue(this.plugin.settings.recursive);
            new Notice("摘录操作尚未完成，请稍后修改文件范围");
            return;
          }
          this.plugin.settings.recursive = v;
          await this.plugin.saveSettings();
          this.plugin.markAllStale();
          new Notice("文件范围已更新，请在摘录首页手动刷新");
        });
      });
    new Setting(root).setName("每批扫描数量")
      .setDesc("每处理一批 Markdown 文件后让出主线程。默认 64 个，下次扫描生效。")
      .addDropdown(dropdown => {
        this.batchDropdown = dropdown;
        for (const size of SCAN_BATCH_SIZES) dropdown.addOption(String(size), size + " 个");
        dropdown.setValue(String(this.plugin.settings.scanBatchSize))
          .onChange(async value => {
            if (this.plugin.isBusy()) {
              dropdown.setValue(String(this.plugin.settings.scanBatchSize));
              new Notice("摘录操作尚未完成，请稍后修改扫描设置");
              return;
            }
            const size = Number(value);
            if (!SCAN_BATCH_SIZES.some(option => option === size)) return;
            this.plugin.settings.scanBatchSize = size;
            await this.plugin.saveSettings();
          });
      });
    this.syncBusy();
  }
}
function message(value: unknown): string { return value instanceof Error ? value.message : String(value); }
