declare module "obsidian" {
  export class TAbstractFile { path: string; }
  export class TFile extends TAbstractFile {}
  export class TFolder extends TAbstractFile {}
  export class Vault {
    getAbstractFileByPath(path: string): TAbstractFile | null;
    getMarkdownFiles(): TFile[];
    createFolder(path: string): Promise<TFolder>;
    create(path: string, data: string): Promise<TFile>;
    cachedRead(file: TFile): Promise<string>;
    process(file: TFile, callback: (data: string) => string): Promise<string>;
    on(event: string, callback: (...args: any[]) => void): any;
  }
  export class App {
    vault: Vault;
    workspace: { getLeaf(detach?: boolean): { openFile(file: TFile, opts?: any): Promise<void> }; revealLeaf(leaf: any): void };
  }
  export class MarkdownRenderChild {
    containerEl: HTMLElement;
    constructor(el: HTMLElement);
    onload(): void;
    onunload(): void;
  }
  export interface MarkdownPostProcessorContext { sourcePath: string; addChild(child: MarkdownRenderChild): void }
  export class Plugin {
    app: App;
    loadData(): Promise<any>;
    saveData(data: any): Promise<void>;
    addSettingTab(tab: PluginSettingTab): void;
    addCommand(cmd: { id: string; name: string; callback: () => void }): void;
    registerMarkdownCodeBlockProcessor(name: string, fn: (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => void): void;
    registerEvent(event: any): void;
  }
  export class Notice { constructor(message: string); }
  export class PluginSettingTab {
    containerEl: HTMLElement;
    constructor(app: App, plugin: Plugin);
    display(): void;
  }
  export class Setting {
    constructor(container: HTMLElement);
    setName(text: string): this;
    setDesc(text: string): this;
    addText(callback: (input: { setPlaceholder(s: string): any; setValue(s: string): any; onChange(fn: (value: string) => void): any }) => void): this;
    addButton(callback: (b: { setButtonText(s: string): any; setCta(): any; setWarning(): any; onClick(fn: () => void): any }) => void): this;
    addToggle(callback: (b: { setValue(v: boolean): any; onChange(fn: (v: boolean) => void): any }) => void): this;
    addDropdown(callback: (b: { addOptions(options: Record<string, string>): any; setValue(v: string): any; onChange(fn: (v: string) => void): any }) => void): this;
  }
}
interface HTMLElement { empty(): void; addClass(name: string): void; setText(text: string): void; createEl<K extends keyof HTMLElementTagNameMap>(tag: K, options?: { text?: string }): HTMLElementTagNameMap[K]; }
