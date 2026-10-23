import { MarkdownRenderChild, MarkdownRenderer, Notice, setIcon } from "obsidian";
import type ExcerptsPlugin from "./main";
import { EntryRepository } from "./repository";
import { CardIndex, MarkdownSection, ParsedMarkdown, Workspace } from "./model";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", value = ""): HTMLElementTagNameMap[K] {
  const out = document.createElement(tag);
  if (cls) out.className = cls;
  if (value) out.textContent = value;
  return out;
}
function button(label: string, action: () => void, cls = ""): HTMLButtonElement {
  const result = el("button", "ex-btn " + cls, label);
  result.type = "button";
  result.addEventListener("click", action);
  return result;
}
function iconButton(icon: string, label: string, action: () => void, cls = ""): HTMLButtonElement {
  const result = button("", action, "clickable-icon ex-icon-button " + cls);
  result.setAttribute("aria-label", label);
  result.setAttribute("title", label);
  setIcon(result, icon);
  return result;
}
function notice(error: unknown): void { new Notice(error instanceof Error ? error.message : String(error)); }
function dateLabel(timestamp: number): string {
  return new Date(timestamp || Date.now()).toLocaleDateString("zh-CN", { year: "numeric", month: "short", day: "numeric" });
}

/** Card furniture is custom; all Markdown content uses Obsidian's own renderer. */
export class ExcerptsRenderChild extends MarkdownRenderChild {
  private items: CardIndex[] = [];
  private listEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private tagsEl!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private searchText = "";
  private tagFilter = "";
  private searchMatches: Set<string> | null = null;
  private searchToken = 0;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshToken = 0;
  private pageSize = 40;
  private observer: IntersectionObserver | null = null;
  private pending: Array<() => Promise<void>> = [];
  private reading = 0;
  private renders = new Map<string, MarkdownRenderChild[]>();
  private selected = new Map<string, Set<string>>();
  private disposed = false;

  constructor(container: HTMLElement, private plugin: ExcerptsPlugin, public readonly workspace: Workspace,
    private repo: EntryRepository) { super(container); }

  onload(): void {
    this.disposed = false;
    this.build();
    void this.reload();
  }
  onunload(): void {
    this.disposed = true;
    this.refreshToken++;
    this.searchToken++;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.observer?.disconnect();
    this.clearRenders();
    this.pending = [];
  }
  requestRefresh(force = false): void {
    if (this.disposed) return;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      if (force) this.repo.invalidate();
      void this.reload();
    }, force ? 0 : 1500);
  }
  private build(): void {
    const root = this.containerEl;
    root.replaceChildren();
    root.classList.add("excerpts-root");
    const head = el("header", "ex-header");
    const heading = el("div", "ex-heading");
    heading.append(el("h2", "ex-title", this.workspace.name));
    head.append(heading);
    const actions = el("div", "ex-header-actions");
    actions.append(iconButton("refresh-cw", "刷新 Markdown 文件", () => this.requestRefresh(true)));
    actions.append(button("新建 Markdown", () => void this.plugin.newMarkdown(this.workspace).catch(notice), "ex-btn-primary"));
    head.append(actions);
    root.append(head);
    const filters = el("div", "ex-search-wrap");
    this.searchInput = el("input", "ex-search");
    this.searchInput.type = "search";
    this.searchInput.placeholder = "搜索文件、正文、标签和章节";
    this.searchInput.setAttribute("aria-label", "搜索摘录");
    this.searchInput.addEventListener("input", () => {
      this.searchText = this.searchInput.value.trim();
      this.scheduleSearch();
    });
    filters.append(this.searchInput);
    root.append(filters);
    this.tagsEl = el("div", "ex-filter-tags");
    root.append(this.tagsEl);
    this.statusEl = el("div", "ex-count");
    this.statusEl.setAttribute("aria-live", "polite");
    root.append(this.statusEl);
    this.listEl = el("main", "ex-feed");
    root.append(this.listEl);
  }
  private async reload(): Promise<void> {
    const token = ++this.refreshToken;
    const sorted = this.repo.list(this.workspace);
    sorted.sort((a,b) => this.plugin.settings.defaultSort === "oldest" ? a.mtime-b.mtime : b.mtime-a.mtime);
    if (this.disposed || token !== this.refreshToken) return;
    this.items = sorted;
    this.updateTagFilters();
    if (this.searchText) { this.scheduleSearch(); return; }
    this.searchMatches = null;
    this.drawCards();
  }
  private scheduleSearch(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    const token = ++this.searchToken;
    if (!this.searchText) {
      this.searchMatches = null;
      this.drawCards();
      return;
    }
    this.statusEl.textContent = "搜索准备中…";
    this.searchTimer = setTimeout(() => void this.performSearch(token), 360);
  }
  private async performSearch(token: number): Promise<void> {
    const query = this.searchText;
    this.statusEl.textContent = "搜索 Markdown 文件中…";
    this.listEl.replaceChildren();
    this.clearRenders();
    this.observer?.disconnect();
    try {
      const matches = await this.repo.search(
        this.items, query, this.plugin.settings.batchSize,
        () => this.disposed || token !== this.searchToken,
        done => {
          if (token === this.searchToken) this.statusEl.textContent =
            "搜索中 " + done + " / " + this.items.length;
        }
      );
      if (this.disposed || token !== this.searchToken) return;
      this.searchMatches = matches;
      this.pageSize = 40;
      this.drawCards();
    } catch (error) { if (token === this.searchToken) notice(error); }
  }
  private updateTagFilters(): void {
    this.tagsEl.replaceChildren();
    const counts = new Map<string,number>();
    for (const card of this.items) for (const tag of card.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    const top = [...counts].sort((a,b) => b[1]-a[1]).slice(0, 20);
    for (const [tag,count] of top) {
      const chip = button("#" + tag + " " + count, () => {
        this.tagFilter = this.tagFilter === tag ? "" : tag;
        this.drawCards();
        this.updateTagFilters();
      }, "ex-tag " + (tag === this.tagFilter ? "ex-selected" : ""));
      this.tagsEl.append(chip);
    }
    if (this.tagFilter) this.tagsEl.append(button("清除筛选", () => {
      this.tagFilter = "";
      this.updateTagFilters(); this.drawCards();
    }, "ex-btn-quiet"));
  }
  private visibleCards(): CardIndex[] {
    return this.items.filter(card =>
      (!this.tagFilter || card.tags.includes(this.tagFilter)) &&
      (!this.searchText || (this.searchMatches !== null && this.searchMatches.has(card.path)))
    );
  }
  private clearRenders(path?: string): void {
    const targets = path ? [path] : [...this.renders.keys()];
    for (const key of targets) {
      for (const child of this.renders.get(key) ?? []) this.removeChild(child);
      this.renders.delete(key);
    }
  }
  private drawCards(): void {
    this.refreshToken++;
    this.observer?.disconnect();
    this.observer = null;
    this.clearRenders();
    this.pending = [];
    this.listEl.replaceChildren();
    const visible = this.visibleCards();
    this.statusEl.textContent = visible.length + " 条 Markdown 摘录";
    if (!visible.length) {
      this.listEl.append(el("p", "ex-empty", this.searchText || this.tagFilter
        ? "没有匹配的摘录。" : "文件夹中没有 Markdown 文件，可以新建或复制文件到此目录。"));
      return;
    }
    const token = this.refreshToken;
    if (typeof IntersectionObserver !== "undefined") {
      this.observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          this.observer?.unobserve(entry.target);
          const card = entry.target as HTMLElement;
          const item = visible.find(candidate => candidate.path === card.dataset.path);
          if (item) this.enqueue(() => this.hydrate(item,card,token));
        }
      }, { rootMargin: "350px 0px" });
    }
    for (const item of visible.slice(0, this.pageSize)) {
      const card = this.createCard(item);
      this.listEl.append(card);
      if (this.observer) this.observer.observe(card);
      else this.enqueue(() => this.hydrate(item,card,token));
    }
    if (this.pageSize < visible.length) this.listEl.append(button(
      "继续显示（剩余 " + (visible.length - this.pageSize) + " 条）",
      () => { this.pageSize += 40; this.drawCards(); }, "ex-load-more"
    ));
  }
  private enqueue(job: () => Promise<void>): void {
    this.pending.push(job);
    this.pump();
  }
  private pump(): void {
    while (this.reading < 4 && this.pending.length) {
      const task = this.pending.shift()!;
      this.reading++;
      void task().catch(notice).finally(() => { this.reading--; this.pump(); });
    }
  }
  private createCard(item: CardIndex): HTMLElement {
    const card = el("article", "ex-card");
    card.dataset.path = item.path;
    const head = el("div", "ex-card-heading");
    const title = el("h3", "ex-card-title", item.basename);
    head.append(title);
    head.append(iconButton(item.favorite ? "bookmark-check" : "bookmark",
      item.favorite ? "取消收藏" : "收藏", () => void this.toggleFavorite(item).catch(notice), "ex-favorite"));
    card.append(head);
    const content = el("div", "ex-card-content");
    content.append(el("div", "ex-placeholder", "正在加载 Markdown…"));
    card.append(content);
    const sectionMount = el("div", "ex-card-sections");
    card.append(sectionMount);
    const tags = el("div", "ex-chips");
    this.renderTags(tags, item);
    card.append(tags);
    const footer = el("div", "ex-card-footer");
    const location = el("div", "ex-card-location");
    location.append(el("time", "ex-date", dateLabel(item.mtime)));
    location.append(el("span", "ex-file-path", item.path.slice(this.workspace.rootFolder.length+1)));
    footer.append(location);
    footer.append(button("编辑 Markdown", () => void this.plugin.openMarkdown(item.path).catch(notice), "ex-edit-file"));
    card.append(footer);
    return card;
  }
  private async hydrate(item: CardIndex, card: HTMLElement, token: number): Promise<void> {
    const parsed = await this.repo.read(item.path);
    if (this.disposed || token !== this.refreshToken || !card.isConnected) return;
    const title = card.querySelector<HTMLElement>(".ex-card-title");
    if (title) title.textContent = parsed.title || item.basename;
    const content = card.querySelector<HTMLElement>(".ex-card-content")!;
    content.replaceChildren();
    this.renderMarkdown(content, parsed.body, item.path);
    this.renderSections(card.querySelector<HTMLElement>(".ex-card-sections")!, parsed, item);
  }
  private renderMarkdown(target: HTMLElement, markdown: string, path: string): void {
    if (!markdown.trim()) return;
    const child = new MarkdownRenderChild(target);
    this.addChild(child);
    const existing = this.renders.get(path) ?? [];
    existing.push(child); this.renders.set(path, existing);
    void MarkdownRenderer.render(this.plugin.app, markdown, target, path, child).catch(error => {
      target.append(el("p", "ex-warning", "Markdown 渲染失败：" + (error instanceof Error ? error.message : String(error))));
    });
  }
  private renderSections(mount: HTMLElement, parsed: ParsedMarkdown, item: CardIndex): void {
    mount.replaceChildren();
    const wanted = this.selected.get(item.path) ?? new Set<string>();
    if (!parsed.sections.length) return;
    const bar = el("div", "ex-section-bar");
    bar.append(el("span", "ex-section-caption", "章节"));
    for (const name of wanted) {
      if (!parsed.sections.some(s => s.name === name)) continue;
      bar.append(button(name + " ×", () => {
        wanted.delete(name); this.selected.set(item.path,wanted);
        this.clearRenders(item.path);
        this.redrawLoaded(item, mount.closest<HTMLElement>(".ex-card")!);
      }, "ex-section-chip"));
    }
    const picker = el("div", "ex-section-picker");
    picker.hidden = true;
    bar.append(button("＋ 选择章节", () => { picker.hidden = !picker.hidden; }, "ex-section-add"));
    mount.append(bar);
    for (const section of parsed.sections) {
      const on = wanted.has(section.name);
      const option = button((on ? "✓ " : "＋ ") + section.name, () => {
        if (wanted.has(section.name)) wanted.delete(section.name); else wanted.add(section.name);
        this.selected.set(item.path, wanted);
        this.clearRenders(item.path);
        this.redrawLoaded(item, mount.closest<HTMLElement>(".ex-card")!);
      }, "ex-section-option");
      picker.append(option);
    }
    mount.append(picker);
    for (const section of parsed.sections.filter(s => wanted.has(s.name))) {
      const group = el("section", "ex-group");
      group.append(el("h4", "ex-group-title", section.name));
      const body = el("div", "ex-group-content");
      this.renderMarkdown(body, section.markdown, item.path);
      group.append(body);
      mount.append(group);
    }
  }
  private redrawLoaded(item: CardIndex, card: HTMLElement): void {
    // Re-use the bounded repository cache, without rebuilding the entire feed.
    const content = card.querySelector<HTMLElement>(".ex-card-content")!;
    content.replaceChildren();
    const mount = card.querySelector<HTMLElement>(".ex-card-sections")!;
    mount.replaceChildren();
    void this.repo.read(item.path).then(parsed => {
      if (this.disposed || !card.isConnected) return;
      this.renderMarkdown(content, parsed.body, item.path);
      this.renderSections(mount, parsed, item);
    }).catch(notice);
  }
  private renderTags(target: HTMLElement, item: CardIndex): void {
    target.replaceChildren();
    for (const tag of item.tags) target.append(button("#" + tag, () => {
      this.tagFilter = this.tagFilter === tag ? "" : tag;
      this.updateTagFilters(); this.drawCards();
    }, "ex-tag"));
    const editor = el("div", "ex-tag-editor");
    editor.hidden = true;
    const all = [...new Set(this.items.flatMap(card => card.tags))].slice(0, 24);
    for (const tag of all) {
      editor.append(button((item.tags.includes(tag) ? "✓ " : "＋ ") + "#" + tag, () => {
        void this.changeTag(item,tag,!item.tags.includes(tag)).catch(notice);
      }, "ex-tag-option"));
    }
    const custom = el("input", "ex-tag-custom");
    custom.placeholder = "输入新标签并回车";
    custom.setAttribute("aria-label", "添加自定义标签");
    custom.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        void this.changeTag(item,custom.value,true).then(() => { custom.value=""; }).catch(notice);
      }
    });
    editor.append(custom);
    target.append(button("＋ 标签", () => { editor.hidden = !editor.hidden; }, "ex-add-tag"));
    target.append(editor);
  }
  private async changeTag(item: CardIndex, tag: string, add: boolean): Promise<void> {
    await this.repo.setTag(item.path,tag,add);
    if (add) item.tags = [...new Set([...item.tags,tag.replace(/^#/,"")])];
    else item.tags = item.tags.filter(t => t !== tag);
    this.updateTagFilters();
    this.drawCards();
  }
  private async toggleFavorite(item: CardIndex): Promise<void> {
    await this.repo.setFavorite(item.path,!item.favorite);
    item.favorite = !item.favorite;
    this.drawCards();
  }
}
