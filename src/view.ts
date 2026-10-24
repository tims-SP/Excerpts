import { MarkdownRenderChild, MarkdownRenderer, Menu, Notice, setIcon } from "obsidian";
import { findSectionHeadingLine } from "./codec";
import type ExcerptsPlugin from "./main";
import { EntryRepository } from "./repository";
import { TagPicker } from "./tag-picker";
import { CardIndex, ParsedMarkdown, Workspace } from "./model";

function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", value = ""): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  if (cls) result.className = cls;
  if (value) result.textContent = value;
  return result;
}
function button(label: string, click: () => void, cls = ""): HTMLButtonElement {
  const result = node("button", "ex-btn " + cls, label);
  result.type = "button";
  result.addEventListener("click", click);
  return result;
}
function iconButton(icon: string, label: string, click: () => void, cls = ""): HTMLButtonElement {
  const result = button("", click, "clickable-icon ex-icon-button " + cls);
  result.title = label;
  result.setAttribute("aria-label", label);
  setIcon(result, icon);
  return result;
}
function notify(error: unknown): void { new Notice(error instanceof Error ? error.message : String(error)); }
function dayKey(timestamp: number): string {
  const date = new Date(timestamp || Date.now());
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")].join("-");
}
function dayLabel(timestamp: number): { title: string; subtitle: string } {
  const date = new Date(timestamp || Date.now());
  const today = new Date();
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(today) - midnight(date)) / 86400000);
  const recent = days === 0 || days === 1;
  const title = days === 0 ? "今天" : days === 1 ? "昨天" :
    date.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
  const subtitle = recent ?
    date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }) :
    date.getFullYear() !== today.getFullYear() ? date.getFullYear() + "年" : "";
  return { title, subtitle };
}

/** Unsaved text survives view teardown within the current plugin session. */
const composerDrafts = new Map<string, { text: string; tags: string[] }>();

/** Obsidian Markdown excerpt homepage. */
export class ExcerptsRenderChild extends MarkdownRenderChild {
  private items: CardIndex[] = [];
  private listEl!: HTMLElement;
  private countEl!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private searchWrap!: HTMLElement;
  private tagBar!: HTMLElement;
  private filterButton!: HTMLButtonElement;
  private searchText = "";
  private tagFilter = "";
  private filterOpen = false;
  private matches: Set<string> | null = null;
  private searchToken = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshToken = 0;
  private renderToken = 0;
  private pageSize = 40;
  private observer: IntersectionObserver | null = null;
  private queue: Array<() => Promise<void>> = [];
  private reading = 0;
  private markdownChildren = new Map<string, MarkdownRenderChild[]>();
  private sectionsShown = new Map<string, Set<number>>();
  private expandedBodies = new Set<string>();
  private expandedTagRows = new Set<string>();
  private tagResizeObserver: ResizeObserver | null = null;
  private openTagEditors = new Set<string>();
  private pendingTags = new Set<string>();
  private disposed = false;
  constructor(container: HTMLElement, private plugin: ExcerptsPlugin, public readonly workspace: Workspace,
    private repo: EntryRepository) { super(container); }
  onload(): void {
    this.build();
    if (typeof ResizeObserver !== "undefined") {
      this.tagResizeObserver = new ResizeObserver(() => this.reflowVisibleTags());
      this.tagResizeObserver.observe(this.containerEl);
    }
    void this.reload();
  }
  onunload(): void {
    this.disposed = true;
    this.refreshToken++; this.renderToken++; this.searchToken++;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.observer?.disconnect();
    this.tagResizeObserver?.disconnect();
    this.unmountMarkdown();
    this.queue = [];
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
    const header = node("div", "ex-header");
    header.append(node("div", "ex-brand"));
    header.firstElementChild!.append(node("h2", "ex-title", "摘录"));
    root.append(header);

    // The outer composer is the only rounded surface; textarea has no native chrome.
    const form = node("section", "ex-composer");
    form.setAttribute("aria-label", "快速摘录");
    const quote = node("textarea", "ex-compose-text");
    quote.placeholder = "记录你想留下的文字……";
    quote.rows = 2;
    const priorDraft = composerDrafts.get(this.workspace.homePath);
    if (priorDraft) quote.value = priorDraft.text;
    quote.setAttribute("aria-label", "摘录正文");
    const fit = () => {
      // Let CSS enforce its responsive max-height; no competing JS viewport limit.
      quote.style.height = "auto";
      quote.style.height = Math.max(quote.scrollHeight, 0) + "px";
    };
    quote.addEventListener("input", fit);
    quote.addEventListener("compositionend", fit);
    quote.addEventListener("focus", () => { form.classList.add("ex-is-composing"); fit(); });

    const tagsPane = node("div", "ex-capture-tags");
    tagsPane.hidden = true;
    const selectedTags = new Set<string>(priorDraft?.tags ?? []);
    const persistDraft = () => {
      if (quote.value || selectedTags.size)
        composerDrafts.set(this.workspace.homePath, { text: quote.value, tags: [...selectedTags] });
      else composerDrafts.delete(this.workspace.homePath);
    };
    quote.addEventListener("input", persistDraft);
    const selectedChips = node("div", "ex-capture-selected");
    const repaintSelected = () => {
      selectedChips.replaceChildren();
      for (const tag of selectedTags) {
        const pill = button("#" + tag + " ×", () => toggleTag(tag, false), "ex-tag ex-tag-remove");
        pill.setAttribute("aria-label", "移除标签：" + tag);
        pill.replaceChildren(node("span", "ex-tag-label", "#" + tag + " ×"));
        selectedChips.append(pill);
      }
      selectedChips.hidden = !selectedTags.size;
    };
    const toggleTag = (tag: string, add: boolean) => {
      const value = tag.trim().replace(/^#/, "");
      if (saving) return;
      if (!value || /\s/.test(value)) {
        new Notice("标签不能为空或包含空格");
        return;
      }
      const canonical = [...new Set([...this.items.flatMap(item => item.tags), ...selectedTags])]
        .find(t => t.toLocaleLowerCase() === value.toLocaleLowerCase()) ?? value;
      if (add) selectedTags.add(canonical);
      else selectedTags.delete(canonical);
      repaintSelected();
      persistDraft();
      this.showSuggestions();
    };
    const tagToggle = iconButton("hash", "添加标签", () => {
      if (saving) return;
      tagsPane.hidden = !tagsPane.hidden;
      tagToggle.setAttribute("aria-expanded", String(!tagsPane.hidden));
      if (!tagsPane.hidden) picker.focus();
      else tagToggle.focus();
    });
    tagToggle.setAttribute("aria-expanded", "false");
    const composeActions = node("div", "ex-compose-actions");
    const options = node("div", "ex-capture-options");
    options.append(selectedChips, tagToggle);
    const saveButton = button("保存", () => void save(), "ex-btn-primary mod-cta");
    saveButton.disabled = !quote.value.trim();
    quote.addEventListener("input", () => { if (!saving) saveButton.disabled = !quote.value.trim(); });
    composeActions.append(options, saveButton);
    const picker = new TagPicker({
      available: () => this.items.flatMap(item => item.tags),
      selected: () => selectedTags,
      onToggle: toggleTag,
      onEscape: () => {
        tagsPane.hidden = true;
        tagToggle.setAttribute("aria-expanded", "false");
        tagToggle.focus();
      }
    }, "ex-tags-input");
    const tagSearch = picker.input;
    tagsPane.append(picker.element);
    form.append(quote, tagsPane, composeActions);
    root.append(form);
    let saving = false;
    let resume = false;
    quote.addEventListener("keydown", event => {
      if (!event.isComposing && (event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault(); resume = true; void save();
      }
    });

    const save = async () => {
      if (saving) return;
      const markdown = quote.value.trim();
      if (!markdown) { new Notice("请输入摘录内容"); return; }
      saving = true;
      quote.disabled = true; tagSearch.disabled = true; tagToggle.disabled = true; saveButton.disabled = true;
      selectedChips.querySelectorAll("button").forEach(btn => { btn.disabled = true; });
      saveButton.textContent = "保存中…";
      try {
        await this.repo.create(this.workspace, markdown, [...selectedTags]);
        quote.value = ""; tagSearch.value = ""; selectedTags.clear();
        picker.refresh();
        repaintSelected();
        persistDraft();
        tagsPane.hidden = true; fit();
        tagToggle.setAttribute("aria-expanded", "false");
        form.classList.remove("ex-is-composing");
        await this.reload();
        if (resume) quote.focus();
      } catch (error) { notify(error); }
      finally {
        saving = false; resume = false;
        quote.disabled = false; tagSearch.disabled = false; tagToggle.disabled = false;
        saveButton.disabled = !quote.value.trim();
        selectedChips.querySelectorAll("button").forEach(btn => { btn.disabled = false; });
        saveButton.textContent = "保存";
      }
    };
    quote.addEventListener("blur", () => {
      if (!quote.value && !selectedTags.size && tagsPane.hidden) form.classList.remove("ex-is-composing");
    });
    this.showSuggestions = () => picker.refresh();
    repaintSelected();
    fit();
    this.showSuggestions();

    const toolbar = node("div", "ex-toolbar");
    const title = node("div", "ex-toolbar-title");
    title.append(node("h3", "ex-list-heading", "最近摘录"));
    this.countEl = node("span", "ex-count");
    this.countEl.setAttribute("role", "status");
    title.append(this.countEl);
    toolbar.append(title);
    const actions = node("div", "ex-toolbar-actions");
    this.searchWrap = node("div", "ex-search-wrap");
    this.searchWrap.hidden = true;
    this.searchInput = node("input", "ex-input ex-search");
    this.searchInput.type = "search";
    this.searchInput.placeholder = "搜索摘录内容或标签…";
    this.searchInput.setAttribute("aria-label", "搜索摘录");
    this.searchWrap.append(this.searchInput);
    const searchButton = iconButton("search", "搜索", () => {
      this.searchWrap.hidden = !this.searchWrap.hidden;
      searchButton.setAttribute("aria-expanded", String(!this.searchWrap.hidden));
      if (!this.searchWrap.hidden) this.searchInput.focus();
      else if (this.searchText) { this.searchInput.value = ""; this.searchText = ""; this.scheduleSearch(); }
    });
    searchButton.setAttribute("aria-expanded", "false");
    this.searchInput.addEventListener("input", () => {
      this.searchText = this.searchInput.value.trim();
      this.scheduleSearch();
    });
    this.searchInput.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      event.preventDefault(); this.searchText = ""; this.searchInput.value = "";
      this.searchWrap.hidden = true; searchButton.setAttribute("aria-expanded", "false");
      this.scheduleSearch(); searchButton.focus();
    });
    actions.append(searchButton);
    this.filterButton = iconButton("tags", "筛选标签", () => {
      this.filterOpen = !this.filterOpen;
      this.renderTagsFilter();
    });
    this.filterButton.setAttribute("aria-expanded", "false");
    actions.append(this.filterButton);
    toolbar.append(actions);
    root.append(toolbar, this.searchWrap);
    this.tagBar = node("div", "ex-filter-tags");
    root.append(this.tagBar);
    this.listEl = node("div", "ex-card-list");
    root.append(this.listEl);
  }
  private showSuggestions: () => void = () => {};
  private async reload(): Promise<void> {
    const token = ++this.refreshToken;
    const cards = this.repo.list(this.workspace);
    cards.sort((a, b) => b.ctime - a.ctime);
    if (this.disposed || token !== this.refreshToken) return;
    this.items = cards;
    this.showSuggestions();
    this.renderTagsFilter();
    if (this.searchText) this.scheduleSearch();
    else { this.matches = null; this.drawCards(); }
  }
  private scheduleSearch(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    const token = ++this.searchToken;
    if (!this.searchText) { this.matches = null; this.drawCards(); return; }
    this.countEl.textContent = "搜索准备中…";
    this.searchTimer = setTimeout(() => void this.search(token), 350);
  }
  private async search(token: number): Promise<void> {
    try {
      const matches = await this.repo.search(this.items, this.searchText,
        () => this.disposed || token !== this.searchToken,
        done => { if (token === this.searchToken) this.countEl.textContent = "搜索中 " + done + "/" + this.items.length; });
      if (this.disposed || token !== this.searchToken) return;
      this.matches = matches;
      this.pageSize = 40;
      this.drawCards();
    } catch (error) { if (!this.disposed) notify(error); }
  }
  private visibleItems(): CardIndex[] {
    const found = this.items.filter(item =>
      (!this.tagFilter || item.tags.includes(this.tagFilter)) &&
      (!this.searchText || (this.matches !== null && this.matches.has(item.path)))
    );
    return found;
  }
  private renderTagsFilter(): void {
    this.tagBar.replaceChildren();
    this.tagBar.hidden = !this.filterOpen && !this.tagFilter;
    this.filterButton.setAttribute("aria-expanded", String(!this.tagBar.hidden));
    this.filterButton.disabled = !this.items.some(item => item.tags.length) && !this.tagFilter;
    if (this.tagBar.hidden) return;
    const all = button("全部", () => { this.tagFilter = ""; this.renderTagsFilter(); this.drawCards(); },
      this.tagFilter ? "ex-btn-quiet" : "ex-selected");
    this.tagBar.append(all);
    const tags = [...new Set(this.items.flatMap(item => item.tags))].sort((a,b) => a.localeCompare(b, "zh"));
    const limit = 8;
    for (const tag of tags.slice(0, limit)) this.tagBar.append(button("#" + tag, () => {
      this.tagFilter = this.tagFilter === tag ? "" : tag;
      this.renderTagsFilter(); this.drawCards();
    }, this.tagFilter === tag ? "ex-selected" : "ex-btn-quiet"));
    if (tags.length > limit) {
      const more = button("更多标签 · " + (tags.length-limit), () => {
        const menu = new Menu();
        for (const tag of tags.slice(limit)) menu.addItem(item => item.setTitle("#" + tag).onClick(() => {
          this.tagFilter = tag; this.renderTagsFilter(); this.drawCards();
        }));
        const rect = more.getBoundingClientRect(); menu.showAtPosition({ x: rect.left, y: rect.bottom }, more.ownerDocument);
      }, "ex-btn-quiet");
      this.tagBar.append(more);
    }
  }
  private unmountMarkdown(path?: string): void {
    const paths = path ? [path] : [...this.markdownChildren.keys()];
    for (const current of paths) {
      for (const child of this.markdownChildren.get(current) ?? []) this.removeChild(child);
      this.markdownChildren.delete(current);
    }
  }
  private drawCards(): void {
    const token = ++this.renderToken;
    this.observer?.disconnect();
    this.observer = null;
    this.queue = [];
    this.unmountMarkdown();
    this.listEl.replaceChildren();
    const visible = this.visibleItems();
    this.countEl.textContent = this.items.length ? visible.length + " / " + this.items.length : "0 条摘录";
    if (!visible.length) {
      const empty = node("section", "ex-empty");
      empty.append(node("div", "ex-empty-title", this.items.length ? "没有匹配的摘录" : "从第一段文字开始"));
      empty.append(node("p", "ex-empty-description", this.items.length ?
        "试试其他关键词，或清除筛选条件。" : "写下喜欢的句子，未来的某一天再读到它。"));
      this.listEl.append(empty);
      return;
    }
    if (typeof IntersectionObserver !== "undefined") {
      this.observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          this.observer?.unobserve(entry.target);
          const card = entry.target as HTMLElement;
          const item = this.items.find(candidate => candidate.path === card.dataset.path);
          if (item) this.enqueue(() => this.hydrate(item, card, token));
        }
      }, { rootMargin: "350px 0px" });
    }
    this.appendPage(visible, 0, Math.min(this.pageSize, visible.length), token);
  }
  private appendPage(visible: CardIndex[], start: number, end: number, token: number): void {
    if (this.disposed || token !== this.renderToken) return;
    this.listEl.querySelector(".ex-loadmore")?.remove();
    let group = this.listEl.lastElementChild as HTMLElement | null;
    for (const item of visible.slice(start, end)) {
      const key = dayKey(item.ctime);
      if (!group || group.dataset.day !== key) {
        group = node("section", "ex-day-group");
        group.dataset.day = key;
        const label = dayLabel(item.ctime);
        const rail = node("header", "ex-day-rail");
        rail.append(node("h4", "ex-day-title", label.title));
        if (label.subtitle) rail.append(node("span", "ex-day-subtitle", label.subtitle));
        const cards = node("div", "ex-day-cards");
        group.append(rail, cards);
        this.listEl.append(group);
      }
      const card = this.createCard(item);
      group.querySelector(".ex-day-cards")!.append(card);
      if (this.observer) this.observer.observe(card);
      else this.enqueue(() => this.hydrate(item, card, token));
    }
    this.reflowVisibleTags();
    if (end < visible.length) {
      const load = button("加载更多 · 剩余 " + (visible.length - end) + " 条", () => {
        this.pageSize = end + 40;
        this.appendPage(visible, end, Math.min(end + 40, visible.length), token);
      }, "ex-loadmore");
      this.listEl.append(load);
    }
  }
  private enqueue(task: () => Promise<void>): void { this.queue.push(task); this.pump(); }
  private pump(): void {
    while (this.reading < 4 && this.queue.length) {
      const task = this.queue.shift()!;
      this.reading++;
      void task().catch(error => { if (!this.disposed) notify(error); }).finally(() => {
        this.reading--; this.pump();
      });
    }
  }
  private createCard(item: CardIndex): HTMLElement {
    const card = node("article", "ex-card ex-card-loading");
    card.dataset.path = item.path;
    const quote = node("div", "ex-quote ex-markdown");
    const skeleton = node("div", "ex-card-placeholder");
    skeleton.setAttribute("aria-hidden", "true");
    skeleton.append(node("span", "ex-placeholder-line"), node("span", "ex-placeholder-line ex-placeholder-short"));
    quote.append(skeleton);
    card.append(quote);
    card.append(node("div", "ex-extras"));
    const editor = node("div", "ex-tag-editor");
    editor.hidden = true;
    card.append(editor);
    const footer = node("div", "ex-card-footer");
    const tags = node("div", "ex-chips");
    footer.append(tags);
    const actions = node("div", "ex-card-actions");
    const options = iconButton("ellipsis", "卡片选项", () =>
      void this.showCardMenu(item, options).catch(notify), "ex-card-options");
    options.setAttribute("aria-haspopup", "menu");
    actions.append(options);
    footer.append(actions);
    card.append(footer);
    this.renderTags(tags, item, this.openTagEditors.has(item.path));
    return card;
  }
  private async showCardMenu(item: CardIndex, anchor: HTMLButtonElement): Promise<void> {
    const parsed = await this.repo.read(item.path);
    if (this.disposed || !anchor.isConnected) return;
    const menu = new Menu();
    menu.addItem(entry => entry.setTitle("编辑原文").onClick(() =>
      void this.plugin.openMarkdown(item.path).catch(notify)));
    const seen = new Map<string, number>();
    for (let index = 0; index < parsed.sections.length; index++) {
      const section = parsed.sections[index];
      const count = (seen.get(section.name) ?? 0) + 1;
      seen.set(section.name, count);
      const suffix = parsed.sections.filter(part => part.name === section.name).length > 1
        ? "（第 " + count + " 个）" : "";
      menu.addItem(entry => entry.setTitle("编辑分组：" + section.name + suffix).onClick(() =>
        void this.openSection(item.path, index).catch(notify)));
    }
    const rect = anchor.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom }, anchor.ownerDocument);
  }
  private async openSection(path: string, index: number): Promise<void> {
    const raw = await this.repo.readRaw(path);
    const line = findSectionHeadingLine(raw, index);
    if (line === null) throw new Error("无法定位该分组，请重新打开卡片选项");
    await this.plugin.openMarkdown(path, line);
  }
  private async hydrate(item: CardIndex, card: HTMLElement, token: number): Promise<void> {
    try {
      const parsed = await this.repo.read(item.path);
      if (this.disposed || token !== this.renderToken || !card.isConnected) return;
      this.renderContent(card, item, parsed);
      card.classList.remove("ex-card-loading");
    } catch (error) {
      if (!this.disposed && token === this.renderToken && card.isConnected) {
        card.querySelector<HTMLElement>(".ex-quote")?.replaceChildren(node("p", "ex-warning", "摘录加载失败"));
        card.classList.remove("ex-card-loading");
      }
      throw error;
    }
  }
  private renderContent(card: HTMLElement, item: CardIndex, parsed: ParsedMarkdown): void {
    const body = card.querySelector<HTMLElement>(".ex-quote")!;
    body.replaceChildren();
    // Only a standalone leading embed gains the media-first card treatment.
    // Complex/mixed content retains the original Markdown flow.
    const mediaFirst = !parsed.title &&
      /^\s*(?:!\[\[[^\]]+\]\]|!\[[^\]]*\]\([^)]+\)|<img\b[^>]*>|<video\b[^>]*>)(?:\s*\n\s*\n|\s*$)/.test(parsed.body);
    card.classList.toggle("ex-media-first", mediaFirst);
    if (parsed.title) body.append(node("h4", "ex-note-heading", parsed.title));
    const content = node("div", "ex-content-viewport");
    const plain = !/(?:!\[|\[\[|\[[^\]]+\]\(|^\s*(?:>|[-*+]\s|\d+\.\s|#{1,6}\s|`{3}|~{3}|\|)|<\w+)/m.test(parsed.body);
    const eligible = plain && parsed.body.length > 280;
    if (eligible && !this.expandedBodies.has(item.path)) content.classList.add("ex-content-clamped");
    body.append(content);
    if (parsed.body) this.renderMarkdown(content, parsed.body, item.path);
    if (!parsed.body && !parsed.title && !parsed.sections.length)
      body.append(node("span", "ex-empty-card", "（空白摘录）"));
    if (eligible) {
      const expand = button(this.expandedBodies.has(item.path) ? "收起正文" : "展开全文", () => {
        const expanded = content.classList.toggle("ex-content-clamped");
        if (expanded) this.expandedBodies.delete(item.path);
        else this.expandedBodies.add(item.path);
        expand.textContent = expanded ? "展开全文" : "收起正文";
        expand.setAttribute("aria-expanded", String(!expanded));
      }, "ex-expand-body");
      expand.setAttribute("aria-expanded", String(!content.classList.contains("ex-content-clamped")));
      body.append(expand);
    }
    this.renderSections(card.querySelector<HTMLElement>(".ex-extras")!, item, parsed);
  }
  private renderMarkdown(container: HTMLElement, markdown: string, path: string): void {
    const mount = node("div", "ex-native-markdown markdown-rendered");
    container.append(mount);
    const child = new MarkdownRenderChild(mount);
    this.addChild(child);
    const list = this.markdownChildren.get(path) ?? [];
    list.push(child); this.markdownChildren.set(path, list);
    void MarkdownRenderer.render(this.plugin.app, markdown, mount, path, child).catch(error => {
      if (mount.isConnected) mount.append(node("p", "ex-warning", String(error)));
    });
  }
  private renderSections(mount: HTMLElement, item: CardIndex, parsed: ParsedMarkdown): void {
    mount.replaceChildren();
    if (!parsed.sections.length) return;
    const shown = this.sectionsShown.get(item.path) ?? new Set<number>();
    parsed.sections.forEach((section, index) => {
      const wrapper = node("section", "ex-section");
      const expanded = shown.has(index);
      const trigger = button("", () => {
        const opened = region.hidden;
        region.hidden = !opened;
        trigger.setAttribute("aria-expanded", String(opened));
        trigger.setAttribute("aria-label", (opened ? "收起" : "展开") + "分组：" + section.name);
        trigger.querySelector(".ex-group-chevron")?.replaceChildren();
        setIcon(trigger.querySelector(".ex-group-chevron") as HTMLElement, opened ? "chevron-down" : "chevron-right");
        if (opened) {
          shown.add(index);
          if (!region.childElementCount && section.markdown) this.renderMarkdown(region, section.markdown, item.path);
        } else shown.delete(index);
        this.sectionsShown.set(item.path, shown);
      }, "ex-group-trigger");
      trigger.setAttribute("aria-expanded", String(expanded));
      trigger.setAttribute("aria-label", (expanded ? "收起" : "展开") + "分组：" + section.name);
      const chevron = node("span", "ex-group-chevron");
      setIcon(chevron, expanded ? "chevron-down" : "chevron-right");
      trigger.append(chevron, node("span", "ex-group-name", section.name));
      const region = node("div", "ex-group-body");
      region.hidden = !expanded;
      if (expanded && section.markdown) this.renderMarkdown(region, section.markdown, item.path);
      wrapper.append(trigger, region);
      mount.append(wrapper);
    });
  }


  private renderTags(mount: HTMLElement, item: CardIndex, editorOpen = false): void {
    mount.replaceChildren();
    const card = mount.closest<HTMLElement>(".ex-card");
    const editor = card?.querySelector<HTMLElement>(".ex-tag-editor");
    mount.classList.toggle("ex-tags-empty", !item.tags.length);
    mount.classList.toggle("ex-tags-editing", editorOpen);
    mount.classList.toggle("ex-tags-expanded", !editorOpen && this.expandedTagRows.has(item.path));
    for (const tag of item.tags) {
      const pill = button("", () => {
        if (editorOpen) return;
        this.tagFilter = this.tagFilter === tag ? "" : tag;
        this.pageSize = 40;
        this.renderTagsFilter(); this.drawCards();
      }, "ex-tag");
      pill.setAttribute("aria-label", "筛选标签：" + tag);
      pill.replaceChildren(node("span", "ex-tag-label", "#" + tag));
      pill.setAttribute("aria-pressed", String(!editorOpen && this.tagFilter === tag));
      if (!editorOpen && this.tagFilter === tag) pill.classList.add("ex-selected");
      mount.append(pill);
    }
    if (!editorOpen && !this.expandedTagRows.has(item.path)) {
      const more = button("", () => {
        this.expandedTagRows.add(item.path);
        this.renderTags(mount, item, false);
      }, "ex-tag-overflow");
      more.hidden = true;
      mount.append(more);
    }
    if (!editorOpen && this.expandedTagRows.has(item.path)) {
      const collapse = button("收起", () => {
        this.expandedTagRows.delete(item.path);
        this.renderTags(mount, item, false);
      }, "ex-tag-collapse");
      collapse.setAttribute("aria-label", "收起标签");
      mount.append(collapse);
    }
    const toggle = button(item.tags.length ? "+" : "＋ 标签", () => {
      if (this.pendingTags.has(item.path)) return;
      if (this.openTagEditors.has(item.path)) this.closeTagEditor(item, card);
      else {
        this.openTagEditors.add(item.path);
        this.renderTags(mount, item, true);
        if (editor) this.renderTagEditor(editor, item);
      }
    }, "ex-add-tag");
    toggle.setAttribute("aria-label", editorOpen ? "取消标签编辑" : "添加标签");
    toggle.setAttribute("aria-expanded", String(editorOpen));
    mount.append(toggle);
    if (!editorOpen) this.scheduleTagReflow(mount);
  }

  private closeTagEditor(item: CardIndex, card: HTMLElement | null | undefined): void {
    this.openTagEditors.delete(item.path);
    const editor = card?.querySelector<HTMLElement>(".ex-tag-editor");
    if (editor) { editor.hidden = true; editor.replaceChildren(); }
    const mount = card?.querySelector<HTMLElement>(".ex-chips");
    if (mount) {
      this.renderTags(mount, item, false);
      mount.querySelector<HTMLButtonElement>(".ex-add-tag")?.focus();
    }
  }

  private renderTagEditor(editor: HTMLElement, item: CardIndex): void {
    // One DOM instance per edit session. Selecting a row never recreates the input.
    editor.replaceChildren();
    editor.hidden = false;
    const selected = new Set(item.frontmatterTags);
    const original = [...item.frontmatterTags];
    const card = editor.closest<HTMLElement>(".ex-card");
    const heading = node("div", "ex-tag-editor-head");
    const title = node("strong", "ex-tag-editor-title", "编辑标签");
    const counter = node("span", "ex-tag-editor-count");
    const updateCount = () => { counter.textContent = "已选 " + selected.size; };
    heading.append(title, counter);
    updateCount();
    const controls = node("div", "ex-tag-editor-actions");
    const cancel = button("取消", () => this.closeTagEditor(item, card), "ex-tag-cancel");
    const done = button("完成", () => void commit(), "ex-tag-done");
    controls.append(cancel, done);
    const picker = new TagPicker({
      available: () => this.items.flatMap(entry => entry.tags),
      selected: () => selected,
      readonlyTags: () => new Set(item.inlineTags),
      onToggle: (tag, add) => {
        if (this.pendingTags.has(item.path)) return;
        if (add) selected.add(tag);
        else selected.delete(tag);
        updateCount();
      },
      onEscape: () => { if (!this.pendingTags.has(item.path)) this.closeTagEditor(item, card); }
    });
    const inlineInfo = item.inlineTags.length
      ? node("div", "ex-tag-inline-hint", "正文标签仅能在 Markdown 原文中修改。") : null;
    if (inlineInfo) {
      const openOriginal = button("编辑原文", () =>
        void this.plugin.openMarkdown(item.path).catch(notify), "ex-tag-source");
      inlineInfo.append(openOriginal);
    }
    const commit = async () => {
      if (this.pendingTags.has(item.path)) return;
      if (original.length === selected.size && original.every(tag => selected.has(tag))) {
        this.closeTagEditor(item, card); return;
      }
      this.pendingTags.add(item.path);
      picker.setDisabled(true); cancel.disabled = true; done.disabled = true;
      done.textContent = "保存中…";
      try {
        await this.repo.setFrontmatterTags(item.path, [...selected], original);
        item.frontmatterTags = [...selected];
        item.tags = [...new Set([...selected, ...item.inlineTags])];
        this.closeTagEditor(item, card);
        this.showSuggestions(); this.renderTagsFilter();
      } catch (error) {
        notify(error);
        if (editor.isConnected) {
          picker.setDisabled(false); cancel.disabled = false; done.disabled = false;
          done.textContent = "完成";
          picker.focus();
        }
      } finally {
        this.pendingTags.delete(item.path);
      }
    };
    editor.append(heading, picker.element);
    if (inlineInfo) editor.append(inlineInfo);
    editor.append(controls);
    picker.focus();
  }
  private scheduleTagReflow(mount: HTMLElement): void {
    const work = () => { if (!this.disposed && mount.isConnected) this.reflowTagRow(mount); };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(work);
    else setTimeout(work, 0);
  }
  private reflowVisibleTags(): void {
    for (const row of Array.from(this.listEl.querySelectorAll<HTMLElement>(".ex-chips"))) this.reflowTagRow(row);
  }
  private reflowTagRow(mount: HTMLElement): void {
    if (mount.classList.contains("ex-tags-editing")) return;
    const card = mount.closest<HTMLElement>(".ex-card");
    if (!card || this.expandedTagRows.has(card.dataset.path ?? "")) return;
    const pills = Array.from(mount.querySelectorAll<HTMLButtonElement>(".ex-tag"));
    const overflow = mount.querySelector<HTMLButtonElement>(".ex-tag-overflow");
    const add = mount.querySelector<HTMLButtonElement>(".ex-add-tag");
    if (!overflow || !add || !mount.clientWidth) return;
    pills.forEach(pill => { pill.hidden = false; });
    overflow.hidden = true;
    const width = mount.clientWidth;
    const gap = 5;
    const addWidth = add.getBoundingClientRect().width;
    let used = addWidth;
    let count = 0;
    for (let i = 0; i < pills.length; i++) {
      const pillWidth = Math.min(pills[i].getBoundingClientRect().width, width);
      const reserve = i < pills.length - 1 ? 38 : 0;
      if (used + gap + pillWidth + (reserve ? gap + reserve : 0) > width) break;
      used += gap + pillWidth;
      count++;
    }
    for (let i = count; i < pills.length; i++) pills[i].hidden = true;
    if (count < pills.length) {
      overflow.textContent = "+" + (pills.length - count);
      overflow.setAttribute("aria-label", "展开剩余 " + (pills.length - count) + " 个标签");
      overflow.hidden = false;
    }
  }




}
