import { MarkdownRenderChild, Notice, Menu, Modal, setIcon } from "obsidian";
import type ExcerptsPlugin from "./main";
import { EntryRepository, TrashedEntry } from "./repository";
import { Entry, Extra, ExtraKind, EXTRA_KINDS, EXTRA_LABELS, Workspace, makeId } from "./model";
import { DraftRepository, SavedDraft } from "./drafts";
type PendingDraft = Omit<SavedDraft, "id" | "collectionId" | "created" | "updated">;

function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  return el;
}
function button(label: string, action: () => void, cls = ""): HTMLButtonElement {
  const b = node("button", `ex-btn ${cls}`, label);
  b.type = "button"; b.addEventListener("click", action); return b;
}
/** Use Obsidian's clickable-icon affordance and native Lucide icon registry. */
function iconButton(icon: string, label: string, action: () => void, cls = ""): HTMLButtonElement {
  const b = node("button", `clickable-icon ex-icon-button ${cls}`);
  b.type = "button";
  b.setAttribute("aria-label", label);
  b.setAttribute("title", label);
  setIcon(b, icon);
  b.addEventListener("click", action);
  return b;
}
function inputBox(placeholder: string, value = ""): HTMLInputElement {
  const el = node("input", "ex-input"); el.type = "text"; el.placeholder = placeholder; el.setAttribute("aria-label", placeholder); el.value = value; return el;
}
function textarea(placeholder: string, value = "", cls = ""): HTMLTextAreaElement {
  const el = node("textarea", `ex-textarea ${cls}`); el.placeholder = placeholder; el.setAttribute("aria-label", placeholder); el.value = value; el.rows = 3; return el;
}
/** Auto-sizing textarea shared by quick capture and both editors. */
function autoGrow(field: HTMLTextAreaElement, min = 48, max = 340): () => void {
  const fit = () => {
    field.style.height = "auto";
    const desired = field.scrollHeight || min;
    field.style.height = Math.max(min, Math.min(max, desired)) + "px";
    field.style.overflowY = desired > max ? "auto" : "hidden";
  };
  field.addEventListener("input", fit);
  fit();
  return fit;
}


/** The same lightweight tagging control is used by capture and by an open card editor. */
function parseTags(raw: string): string[] {
  return [...new Set(raw.split(/[,，]/).map(s => s.trim().replace(/^#/, "")).filter(Boolean))];
}
interface TagEditor {
  element: HTMLElement;
  input: HTMLInputElement;
  entry: HTMLElement;
  read(): string[];
  draftValue(): string;
  setValue(raw: string): void;
  setExpanded(expanded: boolean): void;
  setDisabled(disabled: boolean): void;
}
let tagEditorSerial = 0;
function makeTagEditor(
  initial: string, available: () => string[], onChange: () => void,
  options: { showInlineToggle?: boolean; onExpandedChange?: (expanded: boolean) => void } = {}
): TagEditor {
  const element = node("div", "ex-tag-editor");
  const line = node("div", "ex-tag-selected-line");
  const chips = node("div", "ex-tag-pills");
  chips.setAttribute("aria-label", "已选标签");
  const entry = node("div", "ex-tag-entry");
  entry.id = "ex-tag-picker-" + ++tagEditorSerial;
  const input = inputBox("搜索或新建标签…");
  input.classList.add("ex-tags-input");
  input.setAttribute("aria-label", "输入标签");
  input.autocomplete = "off";
  const suggestions = node("div", "ex-tag-suggestions");
  suggestions.setAttribute("aria-label", "已有标签推荐");
  const done = button("完成", () => setExpanded(false), "ex-btn-quiet ex-tag-done");
  let selected = parseTags(initial);
  let composing = false;
  let disabled = false;
  const read = () => parseTags([...selected, input.value].join(","));
  const draftValue = () => [...selected, input.value.trim()].filter(Boolean).join(", ");
  const toggle = button("添加标签", () => setExpanded(entry.hidden), "ex-tag-add");
  toggle.setAttribute("aria-controls", entry.id);
  if (!options.showInlineToggle) toggle.hidden = true;
  const render = () => {
    chips.replaceChildren();
    for (const tag of selected) {
      const remove = button("", () => {
        if (disabled) return;
        selected = selected.filter(item => item !== tag);
        render(); onChange();
      }, "ex-tag-chip");
      remove.append(node("span", "", "#" + tag), node("span", "ex-tag-remove", "×"));
      remove.setAttribute("aria-label", "移除标签：" + tag);
      remove.disabled = disabled;
      chips.append(remove);
    }
    suggestions.replaceChildren();
    const match = input.value.trim().replace(/^#/, "").toLocaleLowerCase();
    const counts = new Map<string, number>();
    for (const tag of available()) counts.set(tag, (counts.get(tag) || 0) + 1);
    const candidates = [...counts.keys()]
      .filter(tag => !selected.includes(tag) && (!match || tag.toLocaleLowerCase().includes(match)))
      .sort((a, b) => (counts.get(b)! - counts.get(a)!) || a.localeCompare(b, "zh"))
      .slice(0, 5);
    if (candidates.length) suggestions.append(node("div", "ex-tag-hint", "已有标签"));
    for (const tag of candidates) {
      const suggestion = button("#" + tag, () => {
        if (disabled) return;
        selected = parseTags([...selected, tag].join(","));
        input.value = "";
        render(); onChange(); input.focus();
      }, "ex-tag-suggestion");
      suggestion.setAttribute("aria-label", "添加已有标签：" + tag);
      suggestion.disabled = disabled;
      suggestions.append(suggestion);
    }
    const candidate = input.value.trim().replace(/^#/, "");
    if (candidate && !selected.includes(candidate) && !counts.has(candidate)) {
      const create = button('新建标签「' + candidate + '」', () => commit(), "ex-tag-create");
      create.disabled = disabled;
      suggestions.append(create);
    }
    if (!suggestions.childElementCount) suggestions.append(node("div", "ex-tag-hint", "输入文字创建新标签"));
  };
  const setExpanded = (expanded: boolean) => {
    entry.hidden = !expanded;
    toggle.setAttribute("aria-expanded", String(expanded));
    options.onExpandedChange?.(expanded);
    if (expanded) { render(); input.focus(); }
  };
  const commit = () => {
    if (disabled || !input.value.trim()) return;
    selected = parseTags([...selected, input.value].join(","));
    input.value = "";
    render(); onChange();
  };
  input.addEventListener("compositionstart", () => { composing = true; });
  input.addEventListener("compositionend", () => {
    composing = false;
    if (/[,，]/.test(input.value)) commit();
    else { render(); onChange(); }
  });
  input.addEventListener("input", () => {
    if (composing) { onChange(); return; }
    if (/[,，]/.test(input.value)) commit();
    else { render(); onChange(); }
  });
  input.addEventListener("keydown", e => {
    if (e.isComposing || composing || e.keyCode === 229) return;
    if (e.key === "Escape") {
      e.preventDefault(); e.stopPropagation(); setExpanded(false); toggle.focus();
    } else if (!(e.ctrlKey || e.metaKey || e.altKey) && (e.key === "Enter" || e.key === "," || e.key === "，")) {
      e.preventDefault(); commit();
    }
  });
  entry.append(input, suggestions, done);
  line.append(chips, toggle);
  element.append(line, entry);
  setExpanded(false);
  render();
  return {
    element, input, entry, read, draftValue,
    setValue(raw) { selected = parseTags(raw); input.value = ""; render(); onChange(); },
    setExpanded,
    setDisabled(value) {
      disabled = value;
      input.disabled = value; toggle.disabled = value; done.disabled = value;
      render();
    }
  };
}

function dateLabel(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString("zh-CN", {
    ...(sameYear ? {} : { year: "numeric" as const }), month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
  });
}
function errorMessage(e: unknown): string { return e instanceof Error ? e.message : String(e); }
function revision(entry: Entry): string {
  return JSON.stringify([entry.id, entry.collectionId, entry.created, entry.updated, entry.favorite, entry.tags, entry.text, entry.extras]);
}

export class ExcerptsRenderChild extends MarkdownRenderChild {
  private items: Entry[] = [];
  private searchText = "";
  private recalledId: string | null = null;
  private tagFilter = "";
  private filterOpen = false;
  private expanded = new Set<string>();
  private expandedText = new Set<string>();
  private editing: string | null = null;
  private editingExtra: string | null = null;
  private lastTrash: TrashedEntry | null = null;
  private lastExtraRemoval: { after: Entry; removed: Extra; index: number } | null = null;
  private undoExtraButton: HTMLButtonElement | null = null;
  private undoButton: HTMLButtonElement | null = null;
  private deletionInFlight = false;
  private quoteDrafts = new Map<string, { text: string; tags: string }>();
  private extraDrafts = new Map<string, { title: string; content: string }>();
  private quoteBases = new Map<string, string>();
  private extraBases = new Map<string, string>();
  private readonly draftRepo: DraftRepository;
  private savedDrafts = new Map<string, SavedDraft>();
  private recoverableDrafts: SavedDraft[] = [];
  private draftTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private draftPending = new Map<string, PendingDraft>();
  private draftQueues = new Map<string, Promise<void>>();
  private captureRecoveryButton: HTMLButtonElement | null = null;
  private captureInput: HTMLTextAreaElement | null = null;
  private captureTags: HTMLInputElement | null = null;
  private captureTagEditor: TagEditor | null = null;
  private listEl: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private disposed = false;
  constructor(container: HTMLElement, private plugin: ExcerptsPlugin, public readonly workspace: Workspace, private repo: EntryRepository) {
    super(container);
    this.draftRepo = new DraftRepository(plugin.app);
  }
  onload(): void { this.build(); void this.reload(); void this.loadDrafts(); }
  onunload(): void {
    // A final attempt is made without blocking Obsidian's component teardown.
    for (const [key, timer] of this.draftTimers) {
      clearTimeout(timer); void this.flushDraft(key);
    }
    this.draftTimers.clear();
    this.disposed = true;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
  }
  requestRefresh(): void {
    if (this.disposed) return;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.reload(), 220);
  }
  private async reload(): Promise<void> {
    const generation = ++this.generation;
    try {
      const fresh = await this.repo.list(this.workspace);
      if (this.disposed || generation !== this.generation) return;
      this.items = fresh;
      this.drawCards();
    } catch(e) { if (!this.disposed) new Notice(`摘录读取失败：${errorMessage(e)}`); }
  }
  private build(): void {
    const root = this.containerEl;
    root.empty(); root.addClass("excerpts-root");
    const header = node("div", "ex-header");
    const brand = node("div", "ex-brand");
    brand.append(node("h2", "ex-title", this.workspace.name));
    const actions = node("div", "ex-actions");
    const undoButton = button("撤销删除", () => void this.undoTrash(), "ex-btn-quiet");
    undoButton.hidden = true;
    this.undoButton = undoButton;
    actions.append(undoButton);
    const undoExtraButton = button("撤销附属删除", () => void this.undoExtraRemoval(), "ex-btn-quiet");
    undoExtraButton.hidden = true;
    this.undoExtraButton = undoExtraButton;
    actions.append(undoExtraButton);
    header.append(brand, actions); root.append(header);
    const form = node("div", "ex-composer");
    form.setAttribute("role", "group");
    form.setAttribute("aria-label", "快速收藏");
    const quote = textarea("记录你想留下的文字……", "", "ex-compose-text");
    quote.rows = 2;
    quote.setAttribute("aria-label", "摘录正文");
    quote.setAttribute("aria-keyshortcuts", "Control+Enter Meta+Enter");
    // One line when empty; grow with actual writing, never a huge empty form.
    const fitComposer = autoGrow(quote);
    // Focus expands the minimal composer; blur only contracts when no draft remains.
    quote.addEventListener("focus", () => form.classList.add("ex-is-composing"));
    quote.addEventListener("blur", () => {
      if (!quote.value.trim() && !tagEditor.read().length) form.classList.remove("ex-is-composing");
    });
    this.captureInput = quote;
    let tagsToggle: HTMLButtonElement | null = null;
    const tagEditor = makeTagEditor("", () => this.items.flatMap(item => item.tags), () => queueCapture(), {
      onExpandedChange: expanded => tagsToggle?.setAttribute("aria-expanded", String(expanded))
    });
    const tags = tagEditor.input;
    this.captureTags = tags;
    this.captureTagEditor = tagEditor;
    const recovery = button("恢复未保存输入", () => this.restoreCapture(), "ex-btn-quiet");
    recovery.hidden = true;
    this.captureRecoveryButton = recovery;
    form.append(recovery);
    const queueCapture = () => this.queueDraft("capture", { kind: "capture", entryId: "", base: "", text: quote.value, tags: tagEditor.draftValue() });
    quote.addEventListener("input", queueCapture);
    const composeActions = node("div", "ex-compose-actions");
    const captureOptions = node("div", "ex-capture-options");
    tagsToggle = iconButton("hash", "添加标签", () => tagEditor.setExpanded(tagEditor.entry.hidden));
    tagsToggle.setAttribute("aria-expanded", "false");
    const tagsId = "ex-tags-" + this.workspace.id.replace(/[^a-zA-Z0-9_-]/g, "");
    tags.id = tagsId;
    tagsToggle.setAttribute("aria-controls", tagsId);
    tagEditor.setExpanded(false);
    captureOptions.append(tagsToggle, recovery);
    const saveButton = button("保存", () => void save(), "mod-cta ex-btn-primary");
    composeActions.append(captureOptions, saveButton);
    form.append(quote, tagEditor.element, composeActions); root.append(form);
    let resumeTyping = false;
    quote.addEventListener("keydown", e => { if (!e.isComposing && e.keyCode !== 229 && (e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); resumeTyping = true; void save(); } });
    let saving = false;
    const save = async () => {
      if (saving) return;
      const text = quote.value.trim(); if (!text) { new Notice("请输入摘录内容"); return; }
      // Lock input while Vault.create runs: two rapid clicks must never create duplicates.
      saving = true; saveButton.disabled = true; quote.disabled = true; tagEditor.setDisabled(true);
      saveButton.textContent = "保存中…";
      try {
        await this.repo.create(this.workspace, text, tagEditor.read());
        quote.value = ""; tagEditor.setValue(""); tagEditor.setExpanded(false);
        fitComposer();
        form.classList.remove("ex-is-composing");
        tagsToggle.setAttribute("aria-expanded", "false");
        void this.resolveDraft("capture");
        await this.reload();
      } catch(e) { new Notice(`保存失败：${errorMessage(e)}`); }
      finally {
        saving = false; saveButton.disabled = false; quote.disabled = false; tagEditor.setDisabled(false);
        saveButton.textContent = "保存";
        if (resumeTyping) { quote.focus(); resumeTyping = false; }
      }
    };
    const toolbar = node("div", "ex-toolbar");
    const toolbarTitle = node("div", "ex-toolbar-title");
    toolbarTitle.append(node("h3", "ex-list-heading", "最近收藏"));
    this.countEl = node("span", "ex-count", "0 条收藏");
    this.countEl.setAttribute("role", "status");
    this.countEl.setAttribute("aria-live", "polite");
    toolbarTitle.append(this.countEl);
    const toolbarActions = node("div", "ex-toolbar-actions");
    const searchWrap = node("div", "ex-search-wrap");
    const search = inputBox("搜索摘录、来源、变种或批注…");
    search.setAttribute("aria-label", "搜索摘录");
    search.addEventListener("keydown", e => {
      if (e.key === "Escape") { e.preventDefault(); search.value = ""; this.searchText = ""; searchWrap.hidden = true; searchToggle.setAttribute("aria-expanded", "false"); this.drawCards(); searchToggle.focus(); }
    });
    search.addEventListener("input", () => { this.searchText = search.value.toLocaleLowerCase(); this.drawCards(); });
    const searchToggle = iconButton("search", "搜索", () => {
      const show = searchWrap.hidden;
      searchWrap.hidden = !show;
      searchToggle.setAttribute("aria-expanded", String(show));
      if (show) search.focus();
      else if (search.value) { search.value = ""; this.searchText = ""; this.drawCards(); }
    });
    searchToggle.setAttribute("aria-expanded", "false");
    const searchId = "ex-search-" + this.workspace.id.replace(/[^a-zA-Z0-9_-]/g, "");
    searchWrap.id = searchId;
    searchToggle.setAttribute("aria-controls", searchId);
    searchWrap.hidden = true;
    const moreActions = iconButton("ellipsis", "列表选项", () => {
      const menu = new Menu();
      menu.addItem(item => item.setTitle(this.filterOpen ? "收起标签筛选" : "标签筛选").onClick(() => {
        this.filterOpen = !this.filterOpen; this.drawCards();
      }));
      menu.addItem(item => item.setTitle("刷新").onClick(() => void this.reload()));
      const rect = moreActions.getBoundingClientRect();
      menu.showAtPosition({ x: rect.left, y: rect.bottom }, moreActions.ownerDocument);
    });
    toolbarActions.append(searchToggle, iconButton("shuffle", "随机回顾", () => this.recallRandom()), moreActions);
    searchWrap.append(search);
    toolbar.append(toolbarTitle, toolbarActions);
    root.append(toolbar, searchWrap);
    this.listEl = node("div", "ex-card-list"); root.append(this.listEl);
  }
  private queueDraft(key: string, value: PendingDraft): void {
    this.draftPending.set(key, value);
    const previous = this.draftTimers.get(key);
    if (previous) clearTimeout(previous);
    this.draftTimers.set(key, setTimeout(() => { void this.flushDraft(key); }, 350));
  }
  private async flushDraft(key: string): Promise<void> {
    const value = this.draftPending.get(key);
    this.draftPending.delete(key);
    if (!value || (!value.text && !value.tags)) return;
    const previous = this.draftQueues.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      const old = this.savedDrafts.get(key);
      if (old) this.savedDrafts.set(key, await this.draftRepo.update(this.workspace, old, { text: value.text, tags: value.tags, title: value.title }));
      else this.savedDrafts.set(key, await this.draftRepo.create(this.workspace, value));
    });
    this.draftQueues.set(key, next);
    try { await next; }
    catch(e) { new Notice(`草稿备份失败：${errorMessage(e)}；输入尚未丢失，请手动复制保存`); }
  }
  private async resolveDraft(key: string): Promise<void> {
    const timer = this.draftTimers.get(key);
    if (timer) clearTimeout(timer);
    this.draftTimers.delete(key);
    this.draftPending.delete(key);
    try {
      await this.draftQueues.get(key)?.catch(() => {});
      const stored = this.savedDrafts.get(key);
      if (stored) await this.draftRepo.resolve(this.workspace, stored);
      this.savedDrafts.delete(key);
      if (stored) {
        this.recoverableDrafts = this.recoverableDrafts.filter(d => d.id !== stored.id);
        this.updateRecoveryButton();
      }
    } catch(e) { new Notice(`内容已处理，但草稿备份未归档：${errorMessage(e)}`); }
  }
  private async loadDrafts(): Promise<void> {
    try {
      const drafts = await this.draftRepo.list(this.workspace);
      if (this.disposed) return;
      this.recoverableDrafts = drafts;
      this.updateRecoveryButton();
      this.drawCards();
    } catch(e) { new Notice(`无法扫描草稿备份：${errorMessage(e)}`); }
  }
  private updateRecoveryButton(): void {
    if (this.captureRecoveryButton) {
      this.captureRecoveryButton.hidden = !this.recoverableDrafts.some(d => d.kind === "capture");
    }
  }
  private restoreCapture(): void {
    const draft = this.recoverableDrafts.find(d => d.kind === "capture");
    const quote = this.captureInput, tags = this.captureTags;
    if (!draft || !quote || !tags) return;
    if (quote.value || this.captureTagEditor?.read().length) { new Notice("输入框已有内容，请先保存或清空再恢复草稿"); return; }
    quote.value = draft.text; this.captureTagEditor?.setValue(draft.tags);
    quote.style.height = "auto";
    quote.style.height = Math.max(48, Math.min(340, quote.scrollHeight || 48)) + "px";
    if (draft.tags) this.captureTagEditor?.setExpanded(true);
    this.savedDrafts.set("capture", draft);
    this.captureRecoveryButton!.hidden = true;
    quote.focus();
    new Notice("已加载草稿，保存前不会修改其他笔记");
  }
  private restoreQuote(entry: Entry): void {
    const draft = this.recoverableDrafts.find(d => d.kind === "quote" && d.entryId === entry.id);
    if (!draft) return;
    if (draft.base !== revision(entry)) {
      const modal = new Modal(this.plugin.app);
      modal.contentEl.empty();
      modal.contentEl.append(node("h3", "", "草稿与当前摘录存在版本冲突"));
      modal.contentEl.append(node("p", "", "摘录可能已被同步或其他窗口修改。请手动复制下面的草稿内容，不会自动覆盖现有 Markdown。"));
      const content = textarea("只读草稿", draft.text);
      content.readOnly = true; content.rows = 8;
      modal.contentEl.append(content, node("p", "", "原草稿文件仍保存在 Excerpts-Drafts 目录。"));
      modal.contentEl.append(button("关闭", () => modal.close(), "ex-btn-quiet"));
      modal.open();
      return;
    }
    if (this.quoteDrafts.has(entry.id)) { new Notice("当前存在未保存的编辑，请先处理后再恢复"); return; }
    this.savedDrafts.set("quote:" + entry.id, draft);
    this.quoteDrafts.set(entry.id, { text: draft.text, tags: draft.tags });
    this.quoteBases.set(entry.id, draft.base);
    this.editing = entry.id;
    this.drawCards();
    new Notice("已加载原有编辑草稿");
  }

  private recallRandom(): void {
    const visible = this.visibleItems();
    if (!visible.length) { new Notice("当前筛选下没有可以回顾的摘录"); return; }
    const alternatives = visible.filter(item => item.id !== this.recalledId);
    const pool = alternatives.length ? alternatives : visible;
    this.recalledId = pool[Math.floor(Math.random() * pool.length)].id;
    this.drawCards();
    this.listEl?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  private visibleItems(): Entry[] {
    const q = this.searchText;
    const items = this.items.filter(item => {
      if (this.tagFilter && !item.tags.includes(this.tagFilter)) return false;
      if (!q) return true;
      return [item.text, ...item.tags, ...item.extras.flatMap(x => [x.title, x.content])].join("\n").toLocaleLowerCase().includes(q);
    });
    const direction = this.plugin.settings.defaultSort === "oldest" ? 1 : -1;
    items.sort((a,b) => direction * a.created.localeCompare(b.created));
    const recalled = items.findIndex(item => item.id === this.recalledId);
    if (recalled > 0) items.unshift(items.splice(recalled, 1)[0]);
    return items;
  }
  private drawCards(): void {
    const wrap = this.listEl;
    if (!wrap) return;
    // An Obsidian Vault event may redraw the feed while an icon has keyboard
    // focus. Keep that control focused if it still exists after reconciliation.
    const focused = wrap.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    const focusedCardId = focused?.closest<HTMLElement>(".ex-card")?.dataset.entryId;
    const focusedLabel = focused?.getAttribute("aria-label") || focused?.textContent?.trim();
    const editingField = focused?.matches("input,textarea") ? focused as HTMLInputElement | HTMLTextAreaElement : null;
    const editingPanel = editingField?.closest(".ex-entry-editor") ? ".ex-entry-editor" : editingField?.closest(".ex-extra-editor") ? ".ex-extra-editor" : "";
    const editingSelector = editingField ? editingField.tagName.toLowerCase() : "";
    const editingStart = editingField?.selectionStart;
    const editingEnd = editingField?.selectionEnd;
    const editingScroll = editingField?.scrollTop || 0;
    wrap.empty();
    const visible = this.visibleItems();
    if (this.countEl) this.countEl.textContent = this.items.length ? `${visible.length} / ${this.items.length}` : "";
    const tagBar = node("div", "ex-filter-tags");
    tagBar.setAttribute("aria-label", "按标签筛选");
    const all = button("全部", () => { this.tagFilter = ""; this.drawCards(); }, !this.tagFilter ? "ex-selected" : "ex-btn-quiet");
    all.setAttribute("aria-pressed", this.tagFilter ? "false" : "true");
    tagBar.append(all);
    const tags = [...new Set(this.items.flatMap(x => x.tags))].sort((a,b) => a.localeCompare(b, "zh"));
    for (const tag of tags.slice(0, 8)) {
      const option = button(`#${tag}`, () => { this.tagFilter = tag; this.drawCards(); }, this.tagFilter === tag ? "ex-selected" : "ex-btn-quiet");
      option.setAttribute("aria-pressed", this.tagFilter === tag ? "true" : "false");
      tagBar.append(option);
    }
    if (tags.length > 8) {
      const more = button(`更多标签 · ${tags.length - 8}`, () => {
        const menu = new Menu();
        for (const tag of tags.slice(8)) menu.addItem(item => item.setTitle(`#${tag}`).onClick(() => {
          this.tagFilter = tag; this.filterOpen = false;
          this.drawCards();
        }));
        const rect = more.getBoundingClientRect();
        menu.showAtPosition({ x: rect.left, y: rect.bottom }, more.ownerDocument);
      }, "ex-btn-quiet");
      tagBar.append(more);
    }
    if (tags.length > 0 && (this.filterOpen || this.tagFilter)) wrap.append(tagBar);
    if (!visible.length) {
      const empty = node("section", "ex-empty");
      const symbol = node("div", "ex-empty-icon");
      setIcon(symbol, this.items.length ? "search-x" : "book-open");
      const title = node("div", "ex-empty-title", this.items.length ? "没有匹配的摘录" : "从第一段文字开始");
      const description = node("p", "ex-empty-description", this.items.length ? "试试其他关键词，或清除筛选条件。" : "写下喜欢的句子，未来的某一天再读到它。");
      empty.append(symbol, title, description);
      if (this.items.length) empty.append(button("清除筛选", () => {
        this.searchText = ""; this.tagFilter = "";
        const search = this.containerEl.querySelector<HTMLInputElement>(".ex-search-wrap input");
        if (search) search.value = "";
        this.drawCards();
      }, "ex-btn-quiet"));
      wrap.append(empty); return;
    }
    // Progressive page; avoids creating thousands of DOM cards on mobile.
    const shown = visible.slice(0, this.pageSize);
    for (const item of shown) wrap.append(this.card(item));
    if (shown.length < visible.length) wrap.append(button(`继续显示（剩余 ${visible.length - shown.length} 条）`, () => { this.pageSize += 40; this.drawCards(); }, "ex-loadmore"));
    if (focusedCardId && editingField && editingPanel && editingSelector) {
      const scope = Array.from(wrap.querySelectorAll<HTMLElement>(".ex-card")).find(el => el.dataset.entryId === focusedCardId);
      const restored = scope?.querySelector<HTMLInputElement | HTMLTextAreaElement>(`${editingPanel} ${editingSelector}`);
      if (restored) {
        restored.focus();
        if (typeof editingStart === "number" && typeof editingEnd === "number") restored.setSelectionRange(editingStart, editingEnd);
        restored.scrollTop = editingScroll;
      }
    } else if (focused && focusedLabel) {
      const scope: HTMLElement | undefined = focusedCardId ? Array.from(wrap.querySelectorAll<HTMLElement>(".ex-card")).find(el => el.dataset.entryId === focusedCardId) : wrap;
      const buttons = scope ? Array.from(scope.querySelectorAll<HTMLButtonElement>("button")) : [];
      const replacement = buttons.find(b => (b.getAttribute("aria-label") || b.textContent?.trim()) === focusedLabel);
      replacement?.focus();
    }
  }
  private pageSize = 40;
  private card(entry: Entry): HTMLElement {
    const card = node("article", "ex-card");
    card.dataset.entryId = entry.id;
    const headingId = `ex-entry-${entry.id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
    card.setAttribute("aria-labelledby", headingId);
    if (entry.id === this.recalledId) card.classList.add("ex-recalled");
    const top = node("div", "ex-card-top");
    if (entry.id === this.recalledId) top.append(node("span", "ex-recall-hint", "随机回顾"));
    const created = node("time", "ex-date", dateLabel(entry.created));
    created.dateTime = entry.created;
    top.append(created);
    const tools = node("div", "ex-card-actions");
    if (!entry.readOnly) {
      const favorite = iconButton(entry.favorite ? "bookmark-check" : "bookmark", entry.favorite ? "取消珍藏" : "珍藏", () => void this.saveEdit(entry, x => ({...x, favorite: !x.favorite})), entry.favorite ? "ex-is-favorite" : "");
      favorite.setAttribute("aria-pressed", entry.favorite ? "true" : "false");
      favorite.classList.add("ex-quick-action");
      tools.append(favorite);
      const editButton = iconButton("pencil", "编辑", () => this.openQuoteEditor(entry));
      editButton.classList.add("ex-edit-action");
      editButton.setAttribute("aria-pressed", this.editing === entry.id ? "true" : "false");
      tools.append(editButton);
      if (this.recoverableDrafts.some(d => d.kind === "quote" && d.entryId === entry.id)) {
        tools.append(button("恢复草稿", () => this.restoreQuote(entry), "ex-btn-quiet"));
      }
      const more = iconButton("ellipsis", "更多摘录操作", () => {
        const menu = new Menu();
        menu.addItem(item => item.setTitle(entry.favorite ? "取消珍藏" : "珍藏").onClick(() => void this.saveEdit(entry, x => ({ ...x, favorite: !x.favorite }))));
        menu.addItem(item => item.setTitle("编辑摘录").onClick(() => this.openQuoteEditor(entry)));
        menu.addItem(item => item.setTitle("复制正文").onClick(() => void this.copyBody(entry.text)));
        menu.addItem(item => item.setTitle("移至回收站").onClick(() => this.confirmTrash(entry)));
        const rect = more.getBoundingClientRect();
        menu.showAtPosition({ x: rect.left, y: rect.bottom }, more.ownerDocument);
      });
      tools.append(more);
    }
    top.append(tools);
    top.classList.add("ex-card-footer");
    if (this.editing === entry.id) this.renderQuoteEditor(card, entry);
    else {
      const characters = Array.from(entry.text);
      const long = characters.length > 420;
      const open = this.expandedText.has(entry.id);
      const shown = long && !open ? characters.slice(0, 420).join("").trimEnd() + "…" : entry.text;
      const quote = node("div", "ex-quote", shown);
      quote.id = headingId;
      card.append(quote);
      if (long) {
        const toggle = button(open ? "收起全文" : "展开全文", () => {
          if (open) this.expandedText.delete(entry.id); else this.expandedText.add(entry.id);
          this.drawCards();
        }, "ex-long-toggle ex-btn-quiet");
        toggle.setAttribute("aria-controls", headingId);
        toggle.setAttribute("aria-expanded", String(open));
        card.append(toggle);
      }
    }
    if (this.editing !== entry.id) {
      const chips = node("div", "ex-chips");
      for (const tag of entry.tags) {
        const b = button(`#${tag}`, () => { this.tagFilter = tag; this.drawCards(); }, "ex-tag");
        b.setAttribute("aria-label", `筛选标签：${tag}`);
        chips.append(b);
      }
      card.append(chips);
    }
    if (entry.readOnly) card.append(node("div", "ex-warning", `文件结构存在问题，仅能阅读：${entry.problem || "未知错误"}`));
    const extras = node("div", "ex-extras");
    for (const kind of EXTRA_KINDS) {
      const key = `${entry.id}:${kind}`;
      // Empty groups do not consume space. Only the active composer is revealed.
      if (entry.extras.some(x => x.kind === kind) || this.editingExtra === `new:${key}`) {
        this.renderExtraGroup(extras, entry, kind);
      }
    }
    if (!entry.readOnly) {
      const add = iconButton("plus", "添加内容", () => {
        const menu = new Menu();
        for (const kind of EXTRA_KINDS) {
          menu.addItem(item => item.setTitle(EXTRA_LABELS[kind]).onClick(() => {
            const key = `${entry.id}:${kind}`;
            this.editingExtra = `new:${key}`;
            if (this.plugin.settings.collapseExtras) this.expanded.add(key);
            else this.expanded.delete(key);
            this.drawCards();
          }));
        }
        const rect = add.getBoundingClientRect();
        menu.showAtPosition({ x: rect.left, y: rect.bottom }, add.ownerDocument);
      }, "ex-add-extra");
      add.setAttribute("aria-label", "添加内容");
      tools.prepend(add); // A single discoverable affordance, not a footer of form fields.
    }
    if (extras.childElementCount) card.append(extras);
    card.append(top); // Date/actions follow the excerpt: the text always leads.
    return card;
  }
  private async copyBody(text: string): Promise<void> {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("当前环境未提供剪贴板写入权限");
      await navigator.clipboard.writeText(text);
      new Notice("已复制摘录正文");
    } catch (e) { new Notice(`复制失败：${errorMessage(e)}`); }
  }
  private openQuoteEditor(entry: Entry): void {
    if (this.editing && this.editing !== entry.id) {
      const previous = this.items.find(item => item.id === this.editing);
      const draft = this.quoteDrafts.get(this.editing);
      if (previous && draft && (draft.text !== previous.text ||
          JSON.stringify(parseTags(draft.tags)) !== JSON.stringify(previous.tags))) {
        new Notice("请先保存或取消当前摘录的修改");
        return;
      }
      this.quoteBases.delete(this.editing);
      this.quoteDrafts.delete(this.editing);
    }
    if (!this.quoteBases.has(entry.id)) this.quoteBases.set(entry.id, revision(entry));
    this.editing = entry.id;
    this.drawCards();
    const card = Array.from(this.listEl?.querySelectorAll<HTMLElement>(".ex-card") || [])
      .find(item => item.dataset.entryId === entry.id);
    card?.querySelector<HTMLTextAreaElement>(".ex-entry-editor textarea")?.focus();
  }

  private renderQuoteEditor(card: HTMLElement, entry: Entry) {
    if (!this.quoteBases.has(entry.id)) this.quoteBases.set(entry.id, revision(entry));
    const edit = node("div", "ex-edit-panel ex-entry-editor");
    edit.setAttribute("role", "group"); edit.setAttribute("aria-label", "编辑摘录");
    edit.append(node("div", "ex-editor-heading", "正文"));
    const draft = this.quoteDrafts.get(entry.id) || { text: entry.text, tags: entry.tags.join(", ") };
    const content = textarea("摘录正文", draft.text, "ex-editor-text"); content.rows = 3;
    autoGrow(content, 88, 520);
    content.setAttribute("aria-keyshortcuts", "Control+Enter Meta+Enter");
    const tagEditor = makeTagEditor(draft.tags, () => this.items.flatMap(item => item.tags), () => queueQuote(), { showInlineToggle: true });
    const tags = tagEditor.input;
    const keepDraft = () => this.quoteDrafts.set(entry.id, { text: content.value, tags: tagEditor.draftValue() });
    const queueQuote = () => {
      keepDraft();
      this.queueDraft("quote:" + entry.id, { kind: "quote", entryId: entry.id, base: revision(entry), text: content.value, tags: tagEditor.draftValue() });
    };
    content.addEventListener("input", queueQuote);
    // Consistent quick-save shortcut in capture and detail editing.
    const shortcutSave = (e: KeyboardEvent) => {
      if (!e.isComposing && e.keyCode !== 229 && (e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); saveEditButton.click(); }
    };
    content.addEventListener("keydown", shortcutSave);
    tags.addEventListener("keydown", shortcutSave);
    const status = node("span", "ex-editor-status", "未修改");
    status.setAttribute("role", "status");
    const isDirty = () => content.value !== entry.text || JSON.stringify(tagEditor.read()) !== JSON.stringify(entry.tags);
    const updateStatus = () => { status.textContent = isDirty() ? "未保存" : "未修改"; };
    content.addEventListener("input", updateStatus);
    tags.addEventListener("input", updateStatus);
    tagEditor.element.addEventListener("click", () => updateStatus());
    const actions = node("div", "ex-actions");
    const discard = () => {
      this.quoteDrafts.delete(entry.id);
      this.quoteBases.delete(entry.id);
      void this.resolveDraft("quote:" + entry.id);
      this.editing = null; this.drawCards();
    };
    const cancel = button("取消", () => {
      if (!isDirty()) { discard(); return; }
      const modal = new Modal(this.plugin.app);
      modal.contentEl.empty();
      modal.contentEl.append(node("h3", "", "放弃未保存的修改？"));
      modal.contentEl.append(node("p", "", "正文和标签的修改都将丢弃。"));
      const modalActions = node("div", "ex-actions");
      modalActions.append(
        button("继续编辑", () => modal.close(), "ex-btn-quiet"),
        button("放弃更改", () => { modal.close(); discard(); }, "ex-btn-danger")
      );
      modal.contentEl.append(modalActions);
      modal.open();
    }, "ex-btn-quiet");
    const saveEditButton = button("保存修改", async () => {
      if (saveEditButton.disabled) return;
      if (!content.value.trim()) { new Notice("摘录正文不能为空"); return; }
      if (this.quoteBases.get(entry.id) !== revision(entry)) {
        status.textContent = "检测到版本冲突";
        new Notice("摘录在编辑期间已发生变化，已保留草稿并拒绝覆盖");
        return;
      }
      saveEditButton.disabled = true;
      cancel.disabled = true;
      content.disabled = true;
      tagEditor.setDisabled(true);
      saveEditButton.textContent = "保存中…";
      status.textContent = "保存中";
      const nextText = content.value.trim();
      const nextTags = tagEditor.read();
      try {
        await this.repo.update(entry, previous => ({ ...previous, text: nextText, tags: nextTags }));
        this.quoteDrafts.delete(entry.id);
        this.quoteBases.delete(entry.id);
        void this.resolveDraft("quote:" + entry.id);
        this.editing = null;
        await this.reload();
      } catch (e) {
        status.textContent = "保存失败，修改已保留";
        new Notice(`修改失败：${errorMessage(e)}`);
      } finally {
        saveEditButton.disabled = false;
        cancel.disabled = false;
        content.disabled = false;
        tagEditor.setDisabled(false);
        saveEditButton.textContent = "保存修改";
      }
    }, "ex-btn-primary");
    actions.append(status, cancel, saveEditButton);
    updateStatus();
    edit.append(content, node("div", "ex-editor-heading", "标签"), tagEditor.element, actions); card.append(edit);
  }
  private renderExtraGroup(target: HTMLElement, entry: Entry, kind: ExtraKind) {
    const group = node("section", "ex-extra-group");
    const key = `${entry.id}:${kind}`;
    const data = entry.extras.filter(x => x.kind === kind);
    const isOpen = this.plugin.settings.collapseExtras ? this.expanded.has(key) : !this.expanded.has(key);
    const line = button(`${EXTRA_LABELS[kind]} ${data.length}`, () => {
      if (this.expanded.has(key)) this.expanded.delete(key); else this.expanded.add(key);
      this.drawCards();
    }, "ex-group-trigger");
    const disclosure = node("span", "ex-disclosure-icon");
    setIcon(disclosure, isOpen ? "chevron-up" : "chevron-down");
    line.prepend(disclosure);
    line.setAttribute("aria-expanded", isOpen ? "true" : "false");
    const panelId = `ex-extra-${entry.id}-${kind}`.replace(/[^a-zA-Z0-9_-]/g, "");
    line.setAttribute("aria-controls", panelId);
    group.append(line);
    if (isOpen) {
      const body = node("div", "ex-group-body");
      body.id = panelId;
      for (const extra of data) {
        const row = node("div", "ex-extra-item");
        row.append(node("div", "ex-extra-title", extra.title));
        row.append(node("div", "ex-extra-content", extra.content));
        if (!entry.readOnly) {
          row.append(button("修改", () => { this.editingExtra = extra.id; this.drawCards(); }, "ex-btn-quiet"));
          if (this.editingExtra === extra.id) this.extraEditor(row, entry, kind, extra);
        }
        body.append(row);
      }
      if (!entry.readOnly && this.editingExtra === `new:${key}`) this.extraEditor(body, entry, kind);
      group.append(body);
    }
    target.append(group);
  }
  private extraEditor(target: HTMLElement, entry: Entry, kind: ExtraKind, original?: Extra) {
    const pane = node("div", "ex-edit-panel ex-extra-editor");
    pane.setAttribute("role", "group"); pane.setAttribute("aria-label", original ? `编辑${EXTRA_LABELS[kind]}` : `添加${EXTRA_LABELS[kind]}`);
    pane.dataset.kind = kind;
    pane.append(node("div", "ex-editor-heading", original ? `编辑${EXTRA_LABELS[kind]}` : `添加${EXTRA_LABELS[kind]}`));
    const draftKey = `${entry.id}:${original?.id || "new:" + kind}`;
    if (!this.extraBases.has(draftKey)) this.extraBases.set(draftKey, revision(entry));
    const draft = this.extraDrafts.get(draftKey) || { title: original?.title || "", content: original?.content || "" };
    const placeholder = kind === "source" ? "作品、作者或原始出处" : kind === "variant" ? "译本、异文或个人改写" : "附属内容标题";
    const title = inputBox(placeholder, draft.title);
    const bodyPrompt = kind === "source" ? "来源说明、章节、页码或链接…" : kind === "variant" ? "记录另一种表达，注意与原文区分…" : "记录补充内容（支持 Markdown）…";
    const text = textarea(bodyPrompt, draft.content, "ex-editor-text"); text.rows = 3;
    autoGrow(text, 72, 440);
    text.setAttribute("aria-label", `${EXTRA_LABELS[kind]}内容`);
    text.setAttribute("aria-keyshortcuts", "Control+Enter Meta+Enter");
    const keepDraft = () => {
      this.extraDrafts.set(draftKey, { title: title.value, content: text.value });
      this.queueDraft("extra:" + draftKey, {
        kind: "extra", entryId: entry.id, base: revision(entry), extraKey: draftKey,
        title: title.value, text: text.value, tags: ""
      });
    };
    title.addEventListener("input", keepDraft);
    text.addEventListener("input", keepDraft);
    const shortcutSave = (e: KeyboardEvent) => {
      if (!e.isComposing && e.keyCode !== 229 && (e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); saveExtraButton.click(); }
    };
    title.addEventListener("keydown", shortcutSave);
    text.addEventListener("keydown", shortcutSave);
    const actions = node("div", "ex-actions");
    actions.append(button("取消", () => {
      this.extraDrafts.delete(draftKey); this.extraBases.delete(draftKey);
      void this.resolveDraft("extra:" + draftKey);
      this.editingExtra = null; this.drawCards();
    }, "ex-btn-quiet"));
    const saveExtraButton = button("保存", async () => {
      if (saveExtraButton.disabled) return;
      if (this.extraBases.get(draftKey) !== revision(entry)) {
        new Notice("附属条目在编辑期间已发生变化，请复制草稿后刷新，拒绝覆盖");
        return;
      }
      saveExtraButton.disabled = true;
      try { await this.saveEdit(entry, previous => ({
      ...previous, extras: original ? previous.extras.map(x => x.id === original.id ? { ...x, title: title.value.trim(), content: text.value } : x)
        : [...previous.extras, { id: makeId("x"), kind, title: title.value.trim() || EXTRA_LABELS[kind], content: text.value }]
    }), () => {
      this.extraDrafts.delete(draftKey); this.extraBases.delete(draftKey);
      void this.resolveDraft("extra:" + draftKey);
      this.editingExtra = null;
    }); } finally { saveExtraButton.disabled = false; }
    }, "ex-btn-primary");
    actions.append(saveExtraButton);
    if (original) {
      let confirm = false;
      const del = button("删除条目", () => {
        if (!confirm) { confirm = true; del.textContent = "确认删除"; return; }
        if (this.extraBases.get(draftKey) !== revision(entry)) {
          new Notice("文件已变化，拒绝用旧界面删除附属条目"); return;
        }
        void this.saveEdit(entry, previous => ({ ...previous, extras: previous.extras.filter(x => x.id !== original.id) }), saved => {
          this.lastExtraRemoval = { after: saved, removed: original, index: entry.extras.findIndex(x => x.id === original.id) };
          if (this.undoExtraButton) this.undoExtraButton.hidden = false;
          this.extraDrafts.delete(draftKey);
          this.extraBases.delete(draftKey);
          void this.resolveDraft("extra:" + draftKey);
          this.editingExtra = null;
        });
      }, "ex-btn-danger");
      actions.append(del);
    }
    const stored = this.recoverableDrafts.find(d => d.kind === "extra" && d.entryId === entry.id && d.extraKey === draftKey);
    if (stored) {
      const restore = button("恢复上次编辑", () => {
        if (stored.base !== revision(entry)) {
          const dialog = new Modal(this.plugin.app);
          dialog.contentEl.append(node("p", "", "原条目已更改，不能直接覆盖。以下草稿只供复制："));
          const readOnly = textarea("历史草稿", stored.text);
          readOnly.readOnly = true;
          dialog.contentEl.append(readOnly);
          dialog.open();
          return;
        }
        if (this.extraDrafts.has(draftKey)) { new Notice("当前已有未保存的内容，拒绝覆盖"); return; }
        title.value = stored.title || "";
        text.value = stored.text;
        text.dispatchEvent(new (text.ownerDocument.defaultView?.Event || Event)("input", { bubbles: true }));
        this.savedDrafts.set("extra:" + draftKey, stored);
        restore.remove();
        text.focus();
      }, "ex-btn-quiet");
      pane.append(restore);
    }
    pane.append(title, text, actions); target.append(pane);
  }
  private async undoExtraRemoval(): Promise<void> {
    const receipt = this.lastExtraRemoval;
    const button = this.undoExtraButton;
    if (!receipt || !button || button.disabled) return;
    button.disabled = true;
    try {
      await this.repo.update(receipt.after, previous => {
        if (previous.extras.some(x => x.id === receipt.removed.id)) {
          throw new Error("附属条目已存在，拒绝重复恢复");
        }
        const extras = [...previous.extras];
        extras.splice(receipt.index, 0, receipt.removed);
        return { ...previous, extras };
      });
      this.lastExtraRemoval = null;
      button.hidden = true;
      await this.reload();
      new Notice("附属内容已恢复");
    } catch(e) { new Notice(`恢复失败：${errorMessage(e)}`); }
    finally { button.disabled = false; }
  }

  private confirmTrash(entry: Entry): void {
    if (entry.readOnly || this.deletionInFlight) return;
    // Archiving a record while its unsaved editor is open would discard the
    // draft. Require the user to finish or explicitly cancel editing first.
    if (this.editing === entry.id || this.quoteDrafts.has(entry.id) ||
        [...this.extraDrafts.keys()].some(key => key.startsWith(entry.id + ":"))) {
      new Notice("此摘录存在未保存的编辑草稿，请先保存或取消后再删除");
      return;
    }
    const modal = new Modal(this.plugin.app);
    modal.contentEl.empty();
    modal.contentEl.append(node("h3", "", "将摘录移至回收站？"));
    modal.contentEl.append(node("p", "", "Markdown 文件将完整移至当前收藏集的 Excerpts-Recycle 文件夹，不会永久删除。可在此页面撤销最近一次操作。"));
    modal.contentEl.append(node("p", "ex-trash-preview", entry.text.slice(0, 180)));
    const actions = node("div", "ex-actions");
    const confirm = button("移至回收站", () => void run(), "ex-btn-danger");
    const cancel = button("取消", () => modal.close(), "ex-btn-quiet");
    actions.append(cancel, confirm);
    modal.contentEl.append(actions);
    const run = async () => {
      if (this.deletionInFlight) return;
      this.deletionInFlight = true;
      confirm.disabled = true; cancel.disabled = true;
      try {
        this.lastTrash = await this.repo.trash(this.workspace, entry);
        if (this.undoButton) this.undoButton.hidden = false;
        if (this.lastExtraRemoval?.after.id === entry.id) {
          this.lastExtraRemoval = null;
          if (this.undoExtraButton) this.undoExtraButton.hidden = true;
        }
        this.quoteDrafts.delete(entry.id);
        for (const key of this.extraDrafts.keys()) {
          if (key.startsWith(entry.id + ":")) this.extraDrafts.delete(key);
        }
        if (this.editing === entry.id) this.editing = null;
        modal.close();
        await this.reload();
        new Notice("摘录已移至收藏集回收目录，可撤销删除");
      } catch(e) { new Notice(`移动失败：${errorMessage(e)}`); }
      finally { this.deletionInFlight = false; confirm.disabled = false; cancel.disabled = false; }
    };
    modal.open();
  }
  private async undoTrash(): Promise<void> {
    const receipt = this.lastTrash;
    if (!receipt || !this.undoButton || this.undoButton.disabled) return;
    this.undoButton.disabled = true;
    try {
      await this.repo.restore(this.workspace, receipt);
      this.lastTrash = null;
      this.undoButton.hidden = true;
      await this.reload();
      new Notice("摘录已恢复原路径");
    } catch(e) { new Notice(`恢复失败：${errorMessage(e)}`); }
    finally { if (this.undoButton) this.undoButton.disabled = false; }
  }

  private async saveEdit(entry: Entry, change: (previous: Entry) => Entry, onSuccess?: (saved: Entry) => void): Promise<void> {
    if (entry.readOnly) { new Notice("文件结构有误，已禁止写入"); return; }
    try { const saved = await this.repo.update(entry, change); onSuccess?.(saved); await this.reload(); }
    catch(e) { new Notice(`修改失败：${errorMessage(e)}`); }
  }
}
