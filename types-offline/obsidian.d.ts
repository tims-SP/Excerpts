/** Minimal offline compatibility declarations. Canonical checks use the official Obsidian package. */
declare module "obsidian" {
  export class TAbstractFile { path: string; parent: TFolder | null; }
  export class TFolder extends TAbstractFile {}
  export class TFile extends TAbstractFile {
    basename: string; extension: string;
    stat: { ctime: number; mtime: number; size: number };
  }
  export class Vault {
    getAbstractFileByPath(path: string): TAbstractFile | null;
    getFiles(): TFile[];
    getMarkdownFiles(): TFile[];
    createFolder(path: string): Promise<TFolder>;
    create(path: string, content: string): Promise<TFile>;
    cachedRead(file: TFile): Promise<string>;
    process(file: TFile, updater: (current: string) => string): Promise<string>;
    on(event: string, callback: (...args: any[]) => void): any;
  }
  export interface CachedMetadata {
    frontmatter?: Record<string, any>;
    tags?: { tag: string }[];
  }
  export function getAllTags(cache: CachedMetadata): string[] | null;
  export interface WorkspaceLeaf {
    view: FileView;
    openFile(file: TFile): Promise<void>;
    setViewState(state: any): Promise<void>;
  }
  export class App {
    vault: Vault;
    metadataCache: {
      getFileCache(file: TFile): CachedMetadata | null;
      on(event: string, callback: (file: TFile) => void): any;
    };
    fileManager: { processFrontMatter(file: TFile, edit: (properties: Record<string, any>) => void): Promise<void> };
    workspace: { getLeaf(arg?: boolean | "tab"): WorkspaceLeaf; revealLeaf(leaf: WorkspaceLeaf): Promise<void> };
  }
  export class Component {
    load(): void; unload(): void;
    addChild(child: Component): void; removeChild(child: Component): void;
  }
  export class MarkdownRenderChild extends Component {
    containerEl: HTMLElement;
    constructor(el: HTMLElement);
    onload(): void;
    onunload(): void;
  }
  export class FileView extends Component {
    contentEl: HTMLElement;
    file: TFile | null;
    constructor(leaf: WorkspaceLeaf);
    getViewType(): string;
    getDisplayText(): string;
    getIcon(): string;
    onLoadFile(file: TFile): Promise<void>;
    onUnloadFile(file: TFile): Promise<void>;
    onClose(): Promise<void>;
  }
  export interface EditorPosition { line: number; ch: number; }
  export interface Editor {
    setCursor(pos: EditorPosition): void;
    scrollIntoView(range: { from: EditorPosition; to: EditorPosition }, center?: boolean): void;
    focus(): void;
  }
  export class MarkdownView extends FileView {
    editor: Editor;
    setMode(mode: "source" | "preview"): Promise<void>;
  }
  export class MarkdownRenderer {
    static render(app: App, markdown: string, target: HTMLElement, sourcePath: string, child: Component): Promise<void>;
  }
  export class Plugin {
    app: App;
    loadData(): Promise<any>;
    saveData(data: any): Promise<void>;
    registerView(kind: string, creator: (leaf: WorkspaceLeaf) => FileView): void;
    registerExtensions(exts: string[], kind: string): void;
    addRibbonIcon(icon: string, title: string, click: () => void): HTMLElement;
    addSettingTab(tab: PluginSettingTab): void;
    addCommand(command: { id: string; name: string; callback: () => void }): void;
    registerEvent(event: any): void;
  }
  export interface MenuItem {
    setTitle(value: string): MenuItem;
    onClick(handler: () => void): MenuItem;
  }
  export class Menu {
    addItem(callback: (item: MenuItem) => void): this;
    showAtPosition(point: { x: number; y: number }, document?: Document): void;
  }
  export function setIcon(el: HTMLElement, name: string): void;
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
    addText(cb: (input: { setPlaceholder(s: string): any; setValue(s: string): any; onChange(fn: (value: string) => void): any }) => void): this;
    addButton(cb: (button: { setButtonText(s: string): any; setCta(): any; setWarning(): any; onClick(fn: () => void): any }) => void): this;
    addToggle(cb: (toggle: { setValue(value: boolean): any; onChange(fn: (value: boolean) => void): any }) => void): this;
    addDropdown(cb: (menu: { addOptions(options: Record<string, string>): any; setValue(value: string): any; onChange(fn: (value: string) => void): any }) => void): this;
  }
}
interface HTMLElement {
  empty(): void; addClass(name: string): void;
  createDiv(): HTMLDivElement;
  createEl<K extends keyof HTMLElementTagNameMap>(tag: K, options?: { text?: string }): HTMLElementTagNameMap[K];
}
