import { MarkdownRenderChild, MarkdownRenderer, Menu, Modal, Notice, setIcon } from "obsidian";
import type ExcerptsPlugin from "./main";
import { EntryRepository } from "./repository";
import { CardIndex, ParsedMarkdown, Workspace } from "./model";
import { TagPicker, createTagPicker } from "./tag-editor";

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

/** beta.6 homepage chrome, with normal Markdown files and native Markdown rendering. */
export class ExcerptsRenderChild extends MarkdownRenderChild {
  private items: CardIndex[] = [];
  private listEl!: HTMLElement;
  private countEl!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private searchWrap!: HTMLElement;
  private tagBar!: HTMLElement;
  private searchText = "";
  private tagFilter = "";
  private filterOpen = false;
  private recalledPath = "";
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
  private sectionsShown = new Map<string, Set<string>>();
  private editor: {path: string; raw: string; body: string; tags: string[]; initialTags: string[]; saving: boolean; focus?: "body" | "tags"; caret?: [number, number]} | null = null;
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

    // A compact flomo-style capture surface, not a detached 'New file' button.
    const form = node("section", "ex-composer");
    form.setAttribute("aria-label", "快速收藏");
    const quote = node("textarea", "ex-compose-text");
    quote.placeholder = "记录你想留下的文字……";
    quote.rows = 2;
    quote.setAttribute("aria-label", "摘录正文");
    const fit = () => {
      quote.style.height = "auto";
      quote.style.height = Math.max(48, Math.min(340, quote.scrollHeight || 48)) + "px";
    };
    quote.addEventListener("input", fit);
    quote.addEventListener("focus", () => form.classList.add("ex-is-composing"));
    let tagToggle: HTMLButtonElement;
    const tagArea = node("div", "ex-capture-tags");
    tagArea.hidden = true;
    const picker = createTagPicker([], () => this.items.flatMap(item => item.tags),
      () => { tagArea.hidden = !picker.isExpanded() && !picker.getTags().length; },
      expanded => {
        tagToggle?.setAttribute("aria-expanded", String(expanded));
        tagArea.hidden = !expanded && !picker.getTags().length;
      },
      () => tagToggle);
    tagArea.append(picker.element);
    tagToggle = iconButton("hash", "添加标签", () => picker.setExpanded(!picker.isExpanded()));
    tagToggle.setAttribute("aria-expanded", "false");
    const composeActions = node("div", "ex-compose-actions");
    const options = node("div", "ex-capture-options");
    options.append(tagToggle);
    const saveButton = button("保存", () => void save(), "ex-btn-primary mod-cta");
    composeActions.append(options, saveButton);
    form.append(quote, tagArea, composeActions);
    root.append(form);
    let saving = false;
    let resume = false;
    quote.addEventListener("keydown", event => {
      if (!event.isComposing && event.keyCode !== 229 && (event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault(); resume = true; void save();
      }
    });
    const save = async () => {
      if (saving) return;
      const markdown = quote.value.trim();
      if (!markdown) { new Notice("请输入摘录内容"); return; }
      saving = true; quote.disabled = true; picker.setDisabled(true); saveButton.disabled = true;
      saveButton.textContent = "保存中…";
      try {
        await this.repo.create(this.workspace, markdown, picker.getTags());
        quote.value = ""; picker.setTags([]); picker.setExpanded(false); fit();
        form.classList.remove("ex-is-composing");
        await this.reload();
        if (resume) quote.focus();
      } catch (error) { notify(error); }
      finally {
        saving = false; resume = false; quote.disabled = false; picker.setDisabled(false);
        saveButton.disabled = false; saveButton.textContent = "保存";
      }
    };
    quote.addEventListener("blur", () => {
      if (!quote.value && !picker.getTags().length) form.classList.remove("ex-is-composing");
    });

    const toolbar = node("div", "ex-toolbar");
    const title = node("div", "ex-toolbar-title");
    title.append(node("h3", "ex-list-heading", "最近收藏"));
    this.countEl = node("span", "ex-count");
    this.countEl.setAttribute("role", "status");
    title.append(this.countEl);
    toolbar.append(title);
    const actions = node("div", "ex-toolbar-actions");
    this.searchWrap = node("div", "ex-search-wrap");
    this.searchWrap.hidden = true;
    this.searchInput = node("input", "ex-input ex-search");
    this.searchInput.type = "search";
    this.searchInput.placeholder = "搜索摘录、来源、变种或批注…";
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
    actions.append(iconButton("shuffle", "随机回顾", () => this.recallRandom()));
    const moreButton = iconButton("ellipsis", "列表选项", () => {
      const menu = new Menu();
      menu.addItem(item => item.setTitle(this.filterOpen ? "收起标签筛选" : "标签筛选")
        .onClick(() => { this.filterOpen = !this.filterOpen; this.renderTagsFilter(); }));
      menu.addItem(item => item.setTitle("刷新").onClick(() => this.requestRefresh(true)));
      const rect = moreButton.getBoundingClientRect();
      menu.showAtPosition({ x: rect.left, y: rect.bottom }, moreButton.ownerDocument);
    });
    actions.append(moreButton);
    toolbar.append(actions);
    root.append(toolbar, this.searchWrap);
    this.tagBar = node("div", "ex-filter-tags");
    root.append(this.tagBar);
    this.listEl = node("div", "ex-card-list");
    root.append(this.listEl);
  }
  private async reload(): Promise<void> {
    const token = ++this.refreshToken;
    const cards = this.repo.list(this.workspace);
    const direction = this.plugin.settings.defaultSort === "oldest" ? 1 : -1;
    cards.sort((a, b) => direction * (a.ctime - b.ctime));
    if (this.disposed || token !== this.refreshToken) return;
    this.items = cards;
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
        this.plugin.settings.batchSize, () => this.disposed || token !== this.searchToken,
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
    if (this.recalledPath) {
      const index = found.findIndex(item => item.path === this.recalledPath);
      if (index > 0) found.unshift(found.splice(index, 1)[0]);
    }
    return found;
  }
  private recallRandom(): void {
    const items = this.visibleItems();
    if (!items.length) { new Notice("没有可回顾的摘录"); return; }
    const index = Math.floor(Math.random() * items.length);
    this.recalledPath = items[index].path;
    this.pageSize = Math.max(this.pageSize, 40);
    this.drawCards();
    this.listEl.querySelector<HTMLElement>(".ex-recalled")?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }
  private renderTagsFilter(): void {
    this.tagBar.replaceChildren();
    this.tagBar.hidden = !this.filterOpen && !this.tagFilter;
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
    if (this.editor) {
      const active = document.activeElement as HTMLElement | null;
      if (active?.classList.contains("ex-editor-text")) {
        this.editor.focus = "body";
        const textarea = active as HTMLTextAreaElement;
        this.editor.caret = [textarea.selectionStart, textarea.selectionEnd];
      } else if (active?.classList.contains("ex-tags-input") && active.closest(".ex-card")) {
        this.editor.focus = "tags";
      }
    }
    const token = ++this.renderToken;
    this.observer?.disconnect(); this.observer = null;
    this.queue = [];
    this.unmountMarkdown();
    this.listEl.replaceChildren();
    const visible = this.visibleItems();
    this.countEl.textContent = this.items.length ? visible.length + " / " + this.items.length : "0 条收藏";
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
    if (item.path === this.recalledPath) card.classList.add("ex-recalled");
    card.append(node("div", "ex-quote ex-markdown", ""));
    const tags = node("div", "ex-chips");
    this.renderTags(tags, item);
    card.append(tags);
    const groups = node("div", "ex-extras");
    card.append(groups);
    const footer = node("div", "ex-card-top ex-card-footer");
    const info = node("div", "ex-card-meta");
    if (item.path === this.recalledPath) info.append(node("span", "ex-recall-hint", "随机回顾"));
    const date = node("time", "ex-date", dateLabel(item.ctime));
    date.dateTime = new Date(item.ctime).toISOString();
    info.append(date);
    footer.append(info);
    const actions = node("div", "ex-card-actions");
    actions.append(iconButton(item.favorite ? "bookmark-check" : "bookmark",
      item.favorite ? "取消珍藏" : "珍藏", () => void this.toggleFavorite(item).catch(notify),
      item.favorite ? "ex-is-favorite" : ""));
    actions.append(iconButton("pencil", "编辑摘录", () => void this.startEdit(item, card).catch(notify)));
    const more = iconButton("ellipsis", "更多摘录操作", () => {
      const menu = new Menu();
      menu.addItem(entry => entry.setTitle("打开原始 Markdown（添加章节）")
        .onClick(() => void this.plugin.openMarkdown(item.path).catch(notify)));
      menu.addItem(entry => entry.setTitle("复制正文").onClick(() => {
        void this.repo.read(item.path).then(parsed => {
          if (!navigator.clipboard?.writeText) throw new Error("当前环境不支持剪贴板");
          return navigator.clipboard.writeText(parsed.body);
        }).then(() => new Notice("已复制正文")).catch(notify);
      }));
      menu.addItem(entry => entry.setTitle("刷新").onClick(() => this.requestRefresh(true)));
      const rect = more.getBoundingClientRect();
      menu.showAtPosition({ x: rect.left, y: rect.bottom }, more.ownerDocument);
    });
    actions.append(more);
    footer.append(actions);
    card.append(footer);
    return card;
  }
  private async hydrate(item: CardIndex, card: HTMLElement, token: number): Promise<void> {
    const parsed = await this.repo.read(item.path);
    if (this.disposed || token !== this.renderToken || !card.isConnected) return;
    this.renderContent(card, item, parsed);
  }
  private renderContent(card: HTMLElement, item: CardIndex, parsed: ParsedMarkdown): void {
    if (this.editor?.path === item.path) { this.renderInlineEditor(card, item); return; }
    card.classList.remove("ex-is-editing");
    this.renderTags(card.querySelector<HTMLElement>(".ex-chips")!, item);
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
    const selected = this.sectionsShown.get(item.path) ?? new Set<string>();
    const summary = node("div", "ex-group-summary");
    for (const section of parsed.sections) {
      const active = selected.has(section.id);
      const chip = button(section.name, () => {
        if (active) selected.delete(section.id); else selected.add(section.id);
        this.sectionsShown.set(item.path, selected);
        this.redrawCard(item, mount.closest<HTMLElement>(".ex-card")!);
      }, "ex-group-trigger" + (active ? " ex-selected" : ""));
      chip.setAttribute("aria-expanded", String(active));
      const chevron = node("span", "ex-chevron");
      setIcon(chevron, active ? "chevron-down" : "chevron-right");
      chip.prepend(chevron);
      summary.append(chip);
    }
    mount.append(summary);
    for (const section of parsed.sections.filter(value => selected.has(value.id) && value.markdown)) {
      const region = node("section", "ex-group-body");
      region.append(node("h4", "ex-group-title", section.name));
      this.renderMarkdown(region, section.markdown, item.path);
      mount.append(region);
    }
  }
  private redrawCard(item: CardIndex, card: HTMLElement): void {
    this.unmountMarkdown(item.path);
    void this.repo.read(item.path).then(parsed => {
      if (this.disposed || !card.isConnected) return;
      this.renderContent(card, item, parsed);
    }).catch(notify);
  }
  private renderTags(mount: HTMLElement, item: CardIndex): void {
    mount.replaceChildren();
    for (const tag of item.tags) mount.append(button("#" + tag, () => {
      this.tagFilter = this.tagFilter === tag ? "" : tag;
      this.renderTagsFilter(); this.drawCards();
    }, "ex-tag"));
  }
  private editorDirty(): boolean {
    const session = this.editor;
    return !!session && (session.body !== this.repo.editorBody(session.raw) ||
      JSON.stringify(session.tags) !== JSON.stringify(session.initialTags));
  }
  private async startEdit(item: CardIndex, card: HTMLElement): Promise<void> {
    if (this.editor?.path === item.path) {
      card.querySelector<HTMLTextAreaElement>(".ex-editor-text")?.focus();
      return;
    }
    if (this.editor) {
      if (this.editorDirty()) {
        new Notice("请先保存或取消当前摘录的修改");
        return;
      }
      const previous = this.items.find(value => value.path === this.editor!.path);
      const previousCard = [...this.listEl.querySelectorAll<HTMLElement>(".ex-card")]
        .find(value => value.dataset.path === this.editor!.path);
      if (previous && previousCard) this.finishEdit(previous, previousCard);
      else this.editor = null;
    }
    const raw = await this.repo.readSource(item.path);
    if (this.disposed || !card.isConnected) return;
    this.editor = {
      path: item.path, raw, body: this.repo.editorBody(raw),
      tags: [...item.propertyTags], initialTags: [...item.propertyTags], saving: false,
      focus: "body"
    };
    this.renderInlineEditor(card, item);
  }
  private finishEdit(item: CardIndex, card: HTMLElement): void {
    this.editor = null;
    card.classList.remove("ex-is-editing");
    this.redrawCard(item, card);
  }
  private renderInlineEditor(card: HTMLElement, item: CardIndex): void {
    const session = this.editor;
    if (!session || session.path !== item.path) return;
    this.unmountMarkdown(item.path);
    card.classList.add("ex-is-editing");
    const body = card.querySelector<HTMLElement>(".ex-quote")!;
    body.replaceChildren();
    const edit = node("div", "ex-entry-editor");
    edit.setAttribute("role", "group");
    edit.setAttribute("aria-label", "卡片内编辑摘录");
    const textArea = node("textarea", "ex-editor-text");
    textArea.value = session.body;
    textArea.setAttribute("aria-label", "Markdown 正文");
    textArea.setAttribute("aria-keyshortcuts", "Control+Enter Meta+Enter");
    textArea.rows = 4;
    const fit = () => {
      textArea.style.height = "auto";
      textArea.style.height = Math.max(104, Math.min(520, textArea.scrollHeight || 104)) + "px";
    };
    const status = node("span", "ex-editor-status", "未修改");
    status.setAttribute("role", "status");
    const updateStatus = () => { status.textContent = this.editorDirty() ? "未保存" : "未修改"; };
    textArea.addEventListener("input", () => {
      session.body = textArea.value;
      session.focus = "body";
      session.caret = [textArea.selectionStart, textArea.selectionEnd];
      fit(); updateStatus();
    });
    textArea.addEventListener("keydown", event => {
      if (event.isComposing || event.keyCode === 229) return;
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault(); saveButton.click();
      }
    });
    const caption = node("div", "ex-editor-label", "标签");
    let tagToggle: HTMLButtonElement;
    const picker: TagPicker = createTagPicker(session.tags, () => this.items.flatMap(x => x.tags),
      () => { session.tags = picker.getTags(); updateStatus(); },
      open => tagToggle?.setAttribute("aria-expanded", String(open)),
      () => tagToggle);
    tagToggle = button("＋ 添加标签", () => picker.setExpanded(!picker.isExpanded()), "ex-tag-add");
    tagToggle.setAttribute("aria-expanded", "false");
    if (item.inlineTags.length) {
      const note = node("div", "ex-tag-hint", "正文中的行内标签请直接修改 Markdown 文本");
      caption.append(note);
    }
    const actions = node("div", "ex-edit-actions");
    const cancel = button("取消", () => {
      if (!this.editorDirty()) { this.finishEdit(item, card); return; }
      const modal = new Modal(this.plugin.app);
      modal.contentEl.empty();
      modal.contentEl.append(node("h3", "", "放弃未保存的修改？"));
      modal.contentEl.append(node("p", "", "正文和标签的更改将被丢弃。"));
      const row = node("div", "ex-modal-actions");
      row.append(button("继续编辑", () => modal.close(), "ex-btn-quiet"));
      row.append(button("放弃更改", () => { modal.close(); this.finishEdit(item, card); }, "ex-btn-danger"));
      modal.contentEl.append(row);
      modal.open();
    }, "ex-btn-quiet");
    const saveButton = button("保存修改", () => void save(), "ex-btn-primary mod-cta");
    const save = async () => {
      if (session.saving || this.editor !== session) return;
      if (!session.body.trim()) { new Notice("正文不能为空"); return; }
      session.saving = true;
      textArea.disabled = true; picker.setDisabled(true); tagToggle.disabled = true;
      saveButton.disabled = true; cancel.disabled = true; saveButton.textContent = "保存中…";
      status.textContent = "保存中";
      try {
        await this.repo.saveMarkdown(item.path, session.raw, session.body,
          session.tags, session.initialTags);
        if (this.editor === session) this.editor = null;
        await this.reload();
      } catch (error) {
        status.textContent = "保存失败，修改仍在编辑器中";
        notify(error);
      } finally {
        session.saving = false;
        textArea.disabled = false; picker.setDisabled(false); tagToggle.disabled = false;
        saveButton.disabled = false; cancel.disabled = false; saveButton.textContent = "保存修改";
      }
    };
    actions.append(status, cancel, saveButton);
    edit.append(node("div", "ex-editor-label", "Markdown 正文"), textArea,
      caption, tagToggle, picker.element, actions);
    body.append(edit);
    updateStatus();
    fit();
    if (session.focus === "body") {
      textArea.focus();
      if (session.caret) textArea.setSelectionRange(session.caret[0], session.caret[1]);
    } else if (session.focus === "tags") {
      picker.setExpanded(true);
    }
    session.focus = undefined;
  }
  private async toggleFavorite(item: CardIndex): Promise<void> {
    await this.repo.setFavorite(item.path, !item.favorite);
    item.favorite = !item.favorite;
    this.drawCards();
  }
}
