import { MarkdownRenderChild, MarkdownRenderer, Menu, Notice, setIcon } from "obsidian";
import { findSectionHeadingLine } from "./codec";
import type ExcerptsPlugin from "./main";
import { EntryRepository } from "./repository";
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
function dateLabel(timestamp: number): string {
  const date = new Date(timestamp || Date.now());
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "short", day: "numeric" });
}

/** Minimal Markdown-based excerpt homepage. */
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
  private openTagEditors = new Set<string>();
  private tagInputs = new Map<string, string>();
  private pendingTags = new Set<string>();
  private disposed = false;
  constructor(container: HTMLElement, private plugin: ExcerptsPlugin, public readonly workspace: Workspace,
    private repo: EntryRepository) { super(container); }
  onload(): void { this.build(); void this.reload(); }
  onunload(): void {
    this.disposed = true;
    this.refreshToken++; this.renderToken++; this.searchToken++;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.observer?.disconnect();
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
    const tagSearch = node("input", "ex-tags-input");
    tagSearch.type = "search";
    tagSearch.placeholder = "搜索或创建标签";
    tagSearch.setAttribute("aria-label", "搜索或创建摘录标签");
    const suggested = node("div", "ex-tag-suggestions");
    const selectedTags = new Set<string>();
    const selectedChips = node("div", "ex-capture-selected");
    const repaintSelected = () => {
      selectedChips.replaceChildren();
      for (const tag of selectedTags) {
        const pill = button("#" + tag + " ×", () => toggleTag(tag, false), "ex-tag ex-tag-remove");
        pill.setAttribute("aria-label", "移除标签：" + tag);
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
      tagSearch.value = "";
      repaintSelected();
      this.showSuggestions();
      if (!tagsPane.hidden) tagSearch.focus();
    };
    const tagToggle = iconButton("hash", "添加标签", () => {
      tagsPane.hidden = !tagsPane.hidden;
      tagToggle.setAttribute("aria-expanded", String(!tagsPane.hidden));
      if (!tagsPane.hidden) tagSearch.focus();
    });
    tagToggle.setAttribute("aria-expanded", "false");
    const composeActions = node("div", "ex-compose-actions");
    const options = node("div", "ex-capture-options");
    options.append(tagToggle, selectedChips);
    const saveButton = button("保存", () => void save(), "ex-btn-primary mod-cta");
    composeActions.append(options, saveButton);
    tagsPane.append(tagSearch, suggested);
    form.append(quote, tagsPane, composeActions);
    root.append(form);
    let saving = false;
    let resume = false;
    quote.addEventListener("keydown", event => {
      if (!event.isComposing && (event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault(); resume = true; void save();
      }
    });
    tagSearch.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        event.preventDefault();
        tagsPane.hidden = true;
        tagToggle.setAttribute("aria-expanded", "false");
        tagToggle.focus();
      } else if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        const value = tagSearch.value.trim().replace(/^#/, "");
        if (value) toggleTag(value, true);
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
        repaintSelected();
        tagsPane.hidden = true; fit();
        tagToggle.setAttribute("aria-expanded", "false");
        form.classList.remove("ex-is-composing");
        await this.reload();
        if (resume) quote.focus();
      } catch (error) { notify(error); }
      finally {
        saving = false; resume = false;
        quote.disabled = false; tagSearch.disabled = false; tagToggle.disabled = false; saveButton.disabled = false;
        selectedChips.querySelectorAll("button").forEach(btn => { btn.disabled = false; });
        saveButton.textContent = "保存";
      }
    };
    quote.addEventListener("blur", () => {
      if (!quote.value && !selectedTags.size && tagsPane.hidden) form.classList.remove("ex-is-composing");
    });
    this.showSuggestions = () =>
      this.paintTagChoices(tagSearch, suggested, selectedTags, toggleTag);
    tagSearch.addEventListener("input", this.showSuggestions);
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
    this.observer?.disconnect(); this.observer = null;
    this.queue = [];
    this.unmountMarkdown();
    const activeTagInput = document.activeElement as HTMLElement | null;
    const focusedTag = activeTagInput?.classList.contains("ex-tag-custom")
      ? activeTagInput.closest<HTMLElement>(".ex-card")?.dataset.path : undefined;
    this.listEl.replaceChildren();
    const visible = this.visibleItems();
    this.countEl.textContent = this.items.length ? visible.length + " / " + this.items.length : "0 条摘录";
    if (!visible.length) {
      const empty = node("section", "ex-empty");
      empty.append(node("div", "ex-empty-title", this.items.length ? "没有匹配的摘录" : "从第一段文字开始"));
      empty.append(node("p", "ex-empty-description", this.items.length ?
        "试试其他关键词，或清除筛选条件。" : "写下喜欢的句子，未来的某一天再读到它。"));
      this.listEl.append(empty); return;
    }
    if (typeof IntersectionObserver !== "undefined") {
      this.observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          this.observer?.unobserve(entry.target);
          const card = entry.target as HTMLElement;
          const item = visible.find(candidate => candidate.path === card.dataset.path);
          if (item) this.enqueue(() => this.hydrate(item, card, token));
        }
      }, { rootMargin: "350px 0px" });
    }
    for (const item of visible.slice(0, this.pageSize)) {
      const card = this.createCard(item);
      this.listEl.append(card);
      if (this.observer) this.observer.observe(card);
      else this.enqueue(() => this.hydrate(item, card, token));
    }
    if (focusedTag) {
      const card = Array.from(this.listEl.querySelectorAll<HTMLElement>(".ex-card")).find(el => el.dataset.path === focusedTag);
      card?.querySelector<HTMLInputElement>(".ex-tag-custom")?.focus();
    }
    if (visible.length > this.pageSize) this.listEl.append(button(
      "继续显示（剩余 " + (visible.length - this.pageSize) + " 条）",
      () => { this.pageSize += 40; this.drawCards(); }, "ex-loadmore"));
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
    const card = node("article", "ex-card");
    card.dataset.path = item.path;
    card.append(node("div", "ex-quote ex-markdown", ""));
    const tags = node("div", "ex-chips");
    this.renderTags(tags, item, this.openTagEditors.has(item.path));
    card.append(tags);
    const groups = node("div", "ex-extras");
    card.append(groups);
    const footer = node("div", "ex-card-top ex-card-footer");
    const info = node("div", "ex-card-meta");
    const date = node("time", "ex-date", dateLabel(item.ctime));
    date.dateTime = new Date(item.ctime).toISOString();
    info.append(date);
    footer.append(info);
    const actions = node("div", "ex-card-actions");
    const footerTag = button("＋ 标签", () => {
      tags.querySelector<HTMLButtonElement>(".ex-add-tag")?.click();
    }, "ex-footer-tag");
    footerTag.setAttribute("aria-label", "添加标签");
    actions.append(footerTag);
    const options = iconButton("ellipsis", "卡片选项", () =>
      void this.showCardMenu(item, options).catch(notify), "ex-card-options");
    options.setAttribute("aria-haspopup", "menu");
    actions.append(options);
    footer.append(actions);
    card.append(footer);
    card.classList.toggle("ex-card-no-tags", !item.tags.length && !this.openTagEditors.has(item.path));
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
    const parsed = await this.repo.read(item.path);
    if (this.disposed || token !== this.renderToken || !card.isConnected) return;
    this.renderContent(card, item, parsed);
  }
  private renderContent(card: HTMLElement, item: CardIndex, parsed: ParsedMarkdown): void {
    const body = card.querySelector<HTMLElement>(".ex-quote")!;
    body.replaceChildren();
    // Keep the original H1 unobtrusive. The basename is never forced above the quote.
    if (parsed.title) body.append(node("h4", "ex-note-heading", parsed.title));
    if (parsed.body) this.renderMarkdown(body, parsed.body, item.path);
    if (!parsed.body && !parsed.title && !parsed.sections.length) body.append(node("span", "ex-empty-card", "（空白摘录）"));
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
    const selected = this.sectionsShown.get(item.path) ?? new Set<number>();
    const summary = node("div", "ex-group-summary");
    parsed.sections.forEach((section, index) => {
      const active = selected.has(index);
      const chip = button(section.name, () => {
        if (selected.has(index)) selected.delete(index); else selected.add(index);
        this.sectionsShown.set(item.path, selected);
        this.redrawCard(item, mount.closest<HTMLElement>(".ex-card")!);
      }, "ex-group-trigger" + (active ? " ex-selected" : ""));
      chip.setAttribute("aria-expanded", String(active));
      chip.setAttribute("aria-label", (active ? "收起" : "展开") + "分组：" + section.name);
      const chevron = node("span", "ex-group-chevron");
      setIcon(chevron, active ? "chevron-down" : "chevron-right");
      chip.prepend(chevron);
      summary.append(chip);
    });
    mount.append(summary);
    parsed.sections.forEach((section, index) => {
      if (!selected.has(index)) return;
      const region = node("section", "ex-group-body");
      region.append(node("h4", "ex-group-title", section.name));
      if (section.markdown) this.renderMarkdown(region, section.markdown, item.path);
      mount.append(region);
    });
  }
  private redrawCard(item: CardIndex, card: HTMLElement): void {
    this.unmountMarkdown(item.path);
    void this.repo.read(item.path).then(parsed => {
      if (this.disposed || !card.isConnected) return;
      this.renderContent(card, item, parsed);
    }).catch(notify);
  }
  /** Identical search/select/create semantics for quick capture and card tags. */
  private paintTagChoices(input: HTMLInputElement, mount: HTMLElement,
    selected: ReadonlySet<string>, toggle: (tag: string, add: boolean) => void): void {
    mount.replaceChildren();
    const keyword = input.value.trim().replace(/^#/, "");
    const folded = keyword.toLocaleLowerCase();
    const all = [...new Set([...this.items.flatMap(item => item.tags), ...selected])]
      .sort((a, b) => a.localeCompare(b, "zh"));
    const matches = all.filter(tag => tag.toLocaleLowerCase().includes(folded)).slice(0, 8);
    for (const tag of matches) {
      const active = selected.has(tag);
      const choice = button("#" + tag + (active ? " ✓" : ""), () => toggle(tag, !active),
        "ex-tag-option" + (active ? " ex-selected" : ""));
      choice.setAttribute("aria-pressed", String(active));
      mount.append(choice);
    }
    if (keyword && !/\s/.test(keyword) && !all.some(tag => tag.toLocaleLowerCase() === folded)) {
      const create = button("＋ 创建 #" + keyword, () => toggle(keyword, true),
        "ex-tag-option ex-tag-create");
      mount.append(create);
    }
  }
  private renderTags(mount: HTMLElement, item: CardIndex, editorOpen = false): void {
    mount.replaceChildren();
    mount.classList.toggle("ex-tags-empty", !item.tags.length);
    for (const tag of item.tags) {
      const pill = button("#" + tag + (editorOpen ? " ×" : ""), () => {
        if (editorOpen) {
          void this.changeTag(item, tag, false).catch(notify);
        } else {
          this.tagFilter = this.tagFilter === tag ? "" : tag;
          this.renderTagsFilter(); this.drawCards();
        }
      }, "ex-tag" + (editorOpen ? " ex-tag-remove" : ""));
      pill.setAttribute("aria-label", (editorOpen ? "移除标签：" : "筛选标签：") + tag);
      pill.setAttribute("aria-pressed", String(!editorOpen && this.tagFilter === tag));
      mount.append(pill);
    }
    const editor = node("div", "ex-tag-editor");
    editor.hidden = !editorOpen;
    const input = node("input", "ex-tag-custom");
    input.type = "search";
    input.placeholder = "搜索或创建标签";
    input.value = this.tagInputs.get(item.path) ?? "";
    input.setAttribute("aria-label", "查找或创建标签");
    const optionRow = node("div", "ex-tag-suggestions");
    const paintOptions = () => this.paintTagChoices(input, optionRow, new Set(item.tags),
      (tag, add) => { void this.changeTag(item, tag, add).catch(notify); });
    input.addEventListener("input", () => {
      this.tagInputs.set(item.path, input.value);
      paintOptions();
    });
    input.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        event.preventDefault(); toggle.click();
      } else if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        const value = input.value.trim().replace(/^#/, "");
        if (value && !item.tags.includes(value))
          void this.changeTag(item, value, true).catch(notify);
      }
    });
    editor.append(input, optionRow);
    const toggle = button("＋ 标签", () => {
      const opened = editor.hidden;
      if (opened) this.openTagEditors.add(item.path);
      else this.openTagEditors.delete(item.path);
      const card = mount.closest<HTMLElement>(".ex-card");
      const noTags = !item.tags.length && !opened;
      card?.classList.toggle("ex-card-no-tags", noTags);
      // Rebuild pills so they switch between filter and remove behavior immediately.
      this.renderTags(mount, item, opened);
      if (opened) mount.querySelector<HTMLInputElement>(".ex-tag-custom")?.focus();
      else if (noTags) card?.querySelector<HTMLButtonElement>(".ex-footer-tag")?.focus();
    }, "ex-add-tag");
    toggle.setAttribute("aria-expanded", String(editorOpen));
    mount.append(toggle, editor);
    paintOptions();
  }
  private async changeTag(item: CardIndex, tag: string, add: boolean): Promise<void> {
    const value = tag.trim().replace(/^#/, "");
    if (this.pendingTags.has(item.path)) return;
    this.pendingTags.add(item.path);
    try {
      await this.repo.setTag(item.path, value, add);
      if (add) item.tags = [...new Set([...item.tags, value])];
      else item.tags = item.tags.filter(existing => existing !== value);
      this.tagInputs.delete(item.path);
      this.showSuggestions();
      this.renderTagsFilter();
      const card = Array.from(this.listEl.querySelectorAll<HTMLElement>(".ex-card"))
        .find(el => el.dataset.path === item.path);
      const mount = card?.querySelector<HTMLElement>(".ex-chips");
      if (mount) {
        this.renderTags(mount, item, this.openTagEditors.has(item.path));
        card?.classList.toggle("ex-card-no-tags", !item.tags.length && !this.openTagEditors.has(item.path));
        if (this.openTagEditors.has(item.path))
          mount.querySelector<HTMLInputElement>(".ex-tag-custom")?.focus();
      }
    } finally {
      this.pendingTags.delete(item.path);
    }
  }


}
