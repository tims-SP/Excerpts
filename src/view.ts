import { MarkdownRenderChild, Notice, Menu, Modal, setIcon } from "obsidian";
import type ExcerptsPlugin from "./main";
import { EntryRepository, TrashedEntry } from "./repository";
import { Entry, Extra, ExtraKind, EXTRA_KINDS, EXTRA_LABELS, Workspace, makeId } from "./model";
import { DraftRepository, SavedDraft } from "./drafts";

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
  const el = node("input", "ex-input"); el.type = "text"; el.placeholder = placeholder; el.value = value; return el;
}
function textarea(placeholder: string, value = "", cls = ""): HTMLTextAreaElement {
  const el = node("textarea", `ex-textarea ${cls}`); el.placeholder = placeholder; el.value = value; el.rows = 3; return el;
}
function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : value;
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
  private expanded = new Set<string>();
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
  private draftPending = new Map<string, { kind: "capture" | "quote"; entryId: string; base: string; text: string; tags: string }>();
  private draftQueues = new Map<string, Promise<void>>();
  private captureRecoveryButton: HTMLButtonElement | null = null;
  private captureInput: HTMLTextAreaElement | null = null;
  private captureTags: HTMLInputElement | null = null;
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
    actions.append(iconButton("shuffle", "随机回顾", () => this.recallRandom()));
    actions.append(iconButton("refresh-cw", "刷新", () => void this.reload()));
    header.append(brand, actions); root.append(header);
    const form = node("div", "ex-composer");
    const composeLabel = node("div", "ex-section-label", "随手收藏");
    form.append(composeLabel);
    const quote = textarea("一句话、一段文字，或刚刚闪现的灵感……", "", "ex-compose-text");
    this.captureInput = quote;
    const tags = inputBox("标签（用逗号分隔，可选）");
    tags.classList.add("ex-tags-input");
    this.captureTags = tags;
    const recovery = button("恢复未保存输入", () => this.restoreCapture(), "ex-btn-quiet");
    recovery.hidden = true;
    this.captureRecoveryButton = recovery;
    form.append(recovery);
    const queueCapture = () => this.queueDraft("capture", { kind: "capture", entryId: "", base: "", text: quote.value, tags: tags.value });
    quote.addEventListener("input", queueCapture);
    tags.addEventListener("input", queueCapture);
    const composeActions = node("div", "ex-compose-actions");
    const saveButton = button("保存摘录", () => void save(), "mod-cta ex-btn-primary");
    composeActions.append(tags, saveButton);
    form.append(quote, composeActions); root.append(form);
    quote.addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); void save(); } });
    let saving = false;
    const save = async () => {
      if (saving) return;
      const text = quote.value.trim(); if (!text) { new Notice("请输入摘录内容"); return; }
      // Lock input while Vault.create runs: two rapid clicks must never create duplicates.
      saving = true; saveButton.disabled = true; quote.disabled = true; tags.disabled = true;
      saveButton.textContent = "保存中…";
      try {
        const parsedTags = tags.value.split(/[,，]/).map(s => s.trim().replace(/^#/, "")).filter(Boolean);
        await this.repo.create(this.workspace, text, [...new Set(parsedTags)]);
        quote.value = ""; tags.value = "";
        void this.resolveDraft("capture");
        await this.reload();
      } catch(e) { new Notice(`保存失败：${errorMessage(e)}`); }
      finally {
        saving = false; saveButton.disabled = false; quote.disabled = false; tags.disabled = false;
        saveButton.textContent = "保存摘录";
      }
    };
    const toolbar = node("div", "ex-toolbar");
    const toolbarTitle = node("div", "ex-toolbar-title");
    toolbarTitle.append(node("h3", "ex-list-heading", "最近收藏"));
    this.countEl = node("span", "ex-count", "0 条收藏");
    toolbarTitle.append(this.countEl);
    const searchWrap = node("div", "ex-search-wrap");
    const searchIcon = node("span", "ex-search-icon");
    setIcon(searchIcon, "search");
    const search = inputBox("搜索摘录、来源、变种或批注…");
    search.setAttribute("aria-label", "搜索摘录");
    search.addEventListener("input", () => { this.searchText = search.value.toLocaleLowerCase(); this.drawCards(); });
    searchWrap.append(searchIcon, search);
    toolbar.append(toolbarTitle, searchWrap); root.append(toolbar);
    this.listEl = node("div", "ex-card-list"); root.append(this.listEl);
  }
  private queueDraft(key: string, value: { kind: "capture" | "quote"; entryId: string; base: string; text: string; tags: string }): void {
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
      if (old) this.savedDrafts.set(key, await this.draftRepo.update(this.workspace, old, { text: value.text, tags: value.tags }));
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
    if (quote.value || tags.value) { new Notice("输入框已有内容，请先保存或清空再恢复草稿"); return; }
    quote.value = draft.text; tags.value = draft.tags;
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
    wrap.empty();
    const visible = this.visibleItems();
    if (this.countEl) this.countEl.textContent = `${visible.length} / ${this.items.length} 条收藏`;
    const tagBar = node("div", "ex-filter-tags");
    tagBar.setAttribute("aria-label", "按标签筛选");
    const all = button("全部", () => { this.tagFilter = ""; this.drawCards(); }, !this.tagFilter ? "ex-selected" : "ex-btn-quiet");
    tagBar.append(all);
    const tags = [...new Set(this.items.flatMap(x => x.tags))].sort((a,b) => a.localeCompare(b, "zh"));
    for (const tag of tags.slice(0, 40)) tagBar.append(button(`#${tag}`, () => { this.tagFilter = tag; this.drawCards(); }, this.tagFilter === tag ? "ex-selected" : "ex-btn-quiet"));
    wrap.append(tagBar);
    if (!visible.length) { wrap.append(node("div", "ex-empty", this.items.length ? "没有找到匹配的摘录" : "还没有摘录，从上方添加第一条。")); return; }
    // Progressive page; avoids creating thousands of DOM cards on mobile.
    const shown = visible.slice(0, this.pageSize);
    for (const item of shown) wrap.append(this.card(item));
    if (shown.length < visible.length) wrap.append(button(`继续显示（剩余 ${visible.length - shown.length} 条）`, () => { this.pageSize += 40; this.drawCards(); }, "ex-loadmore"));
  }
  private pageSize = 40;
  private card(entry: Entry): HTMLElement {
    const card = node("article", "ex-card");
    card.setAttribute("aria-label", "摘录卡片");
    if (entry.id === this.recalledId) card.classList.add("ex-recalled");
    const top = node("div", "ex-card-top");
    if (entry.id === this.recalledId) top.append(node("span", "ex-recall-hint", "随机回顾"));
    top.append(node("span", "ex-date", dateLabel(entry.created)));
    const tools = node("div", "ex-card-actions");
    if (!entry.readOnly) {
      const favorite = iconButton(entry.favorite ? "bookmark-check" : "bookmark", entry.favorite ? "取消珍藏" : "珍藏", () => void this.saveEdit(entry, x => ({...x, favorite: !x.favorite})), entry.favorite ? "ex-is-favorite" : "");
      favorite.setAttribute("aria-pressed", entry.favorite ? "true" : "false");
      tools.append(favorite);
      tools.append(iconButton("pencil", "编辑", () => {
        if (this.editing !== entry.id && !this.quoteBases.has(entry.id)) this.quoteBases.set(entry.id, revision(entry));
        this.editing = this.editing === entry.id ? null : entry.id;
        this.drawCards();
      }));
      if (this.recoverableDrafts.some(d => d.kind === "quote" && d.entryId === entry.id)) {
        tools.append(button("恢复草稿", () => this.restoreQuote(entry), "ex-btn-quiet"));
      }
      const more = iconButton("ellipsis", "更多摘录操作", () => {
        const menu = new Menu();
        menu.addItem(item => item.setTitle("移至回收站").onClick(() => this.confirmTrash(entry)));
        const rect = more.getBoundingClientRect();
        menu.showAtPosition({ x: rect.left, y: rect.bottom }, more.ownerDocument);
      });
      tools.append(more);
    }
    top.append(tools); card.append(top);
    if (this.editing === entry.id) this.renderQuoteEditor(card, entry);
    else card.append(node("div", "ex-quote", entry.text));
    const chips = node("div", "ex-chips");
    for (const tag of entry.tags) chips.append(button(`#${tag}`, () => { this.tagFilter = tag; this.drawCards(); }, "ex-tag"));
    card.append(chips);
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
      const add = button("添加内容", () => {
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
      add.setAttribute("aria-label", "为摘录添加附属内容");
      extras.append(add);
    }
    if (extras.childElementCount) card.append(extras);
    return card;
  }
  private renderQuoteEditor(card: HTMLElement, entry: Entry) {
    if (!this.quoteBases.has(entry.id)) this.quoteBases.set(entry.id, revision(entry));
    const edit = node("div", "ex-edit-panel");
    const draft = this.quoteDrafts.get(entry.id) || { text: entry.text, tags: entry.tags.join(", ") };
    const content = textarea("摘录正文", draft.text); content.rows = 5;
    const tags = inputBox("标签（逗号分隔）", draft.tags);
    const keepDraft = () => this.quoteDrafts.set(entry.id, { text: content.value, tags: tags.value });
    const queueQuote = () => {
      keepDraft();
      this.queueDraft("quote:" + entry.id, { kind: "quote", entryId: entry.id, base: revision(entry), text: content.value, tags: tags.value });
    };
    content.addEventListener("input", queueQuote);
    tags.addEventListener("input", queueQuote);
    const actions = node("div", "ex-actions");
    actions.append(button("取消", () => {
      this.quoteDrafts.delete(entry.id);
      this.quoteBases.delete(entry.id);
      void this.resolveDraft("quote:" + entry.id);
      this.editing = null; this.drawCards();
    }, "ex-btn-quiet"));
    actions.append(button("保存修改", () => {
      if (this.quoteBases.get(entry.id) !== revision(entry)) {
        new Notice("摘录在编辑期间已发生变化，请复制草稿并重新打开编辑器，拒绝覆盖");
        return;
      }
      void this.saveEdit(entry, previous => ({
      ...previous, text: content.value.trim(), tags: [...new Set(tags.value.split(/[,，]/).map(s => s.trim().replace(/^#/, "")).filter(Boolean))]
    }), () => {
      this.quoteDrafts.delete(entry.id);
      this.quoteBases.delete(entry.id);
      void this.resolveDraft("quote:" + entry.id);
      this.editing = null;
    });
    }, "ex-btn-primary"));
    edit.append(content, tags, actions); card.append(edit);
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
    group.append(line);
    if (isOpen) {
      const body = node("div", "ex-group-body");
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
    const pane = node("div", "ex-edit-panel");
    const draftKey = `${entry.id}:${original?.id || "new:" + kind}`;
    if (!this.extraBases.has(draftKey)) this.extraBases.set(draftKey, revision(entry));
    const draft = this.extraDrafts.get(draftKey) || { title: original?.title || "", content: original?.content || "" };
    const title = inputBox("标题，例如：原始出处 / 精简版", draft.title);
    const text = textarea("补充内容（支持存储 Markdown 文本）", draft.content); text.rows = 4;
    const keepDraft = () => this.extraDrafts.set(draftKey, { title: title.value, content: text.value });
    title.addEventListener("input", keepDraft);
    text.addEventListener("input", keepDraft);
    const actions = node("div", "ex-actions");
    actions.append(button("取消", () => {
      this.extraDrafts.delete(draftKey); this.extraBases.delete(draftKey);
      this.editingExtra = null; this.drawCards();
    }, "ex-btn-quiet"));
    actions.append(button("保存", () => {
      if (this.extraBases.get(draftKey) !== revision(entry)) {
        new Notice("附属条目在编辑期间已发生变化，请复制草稿后刷新，拒绝覆盖");
        return;
      }
      void this.saveEdit(entry, previous => ({
      ...previous, extras: original ? previous.extras.map(x => x.id === original.id ? { ...x, title: title.value.trim(), content: text.value } : x)
        : [...previous.extras, { id: makeId("x"), kind, title: title.value.trim() || EXTRA_LABELS[kind], content: text.value }]
    }), () => {
      this.extraDrafts.delete(draftKey); this.extraBases.delete(draftKey);
      this.editingExtra = null;
    });
    }, "ex-btn-primary"));
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
          this.editingExtra = null;
        });
      }, "ex-btn-danger");
      actions.append(del);
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
