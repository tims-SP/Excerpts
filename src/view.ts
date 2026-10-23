import { MarkdownRenderChild, Notice, Menu, Modal } from "obsidian";
import type ExcerptsPlugin from "./main";
import { EntryRepository, TrashedEntry } from "./repository";
import { Entry, Extra, ExtraKind, EXTRA_KINDS, EXTRA_LABELS, Workspace, makeId } from "./model";

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

export class ExcerptsRenderChild extends MarkdownRenderChild {
  private items: Entry[] = [];
  private searchText = "";
  private recalledId: string | null = null;
  private tagFilter = "";
  private expanded = new Set<string>();
  private editing: string | null = null;
  private editingExtra: string | null = null;
  private lastTrash: TrashedEntry | null = null;
  private undoButton: HTMLButtonElement | null = null;
  private deletionInFlight = false;
  private quoteDrafts = new Map<string, { text: string; tags: string }>();
  private extraDrafts = new Map<string, { title: string; content: string }>();
  private listEl: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private disposed = false;
  constructor(container: HTMLElement, private plugin: ExcerptsPlugin, public readonly workspace: Workspace, private repo: EntryRepository) {
    super(container);
  }
  onload(): void { this.build(); void this.reload(); }
  onunload(): void { this.disposed = true; if (this.refreshTimer) clearTimeout(this.refreshTimer); }
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
    brand.append(node("div", "ex-eyebrow", "EXCERPTS / COLLECTION"), node("h2", "ex-title", this.workspace.name));
    const actions = node("div", "ex-actions");
    const undoButton = button("撤销删除", () => void this.undoTrash(), "ex-btn-quiet");
    undoButton.hidden = true;
    this.undoButton = undoButton;
    actions.append(undoButton);
    actions.append(button("随机回顾", () => this.recallRandom(), "ex-btn-quiet"));
    actions.append(button("刷新", () => void this.reload(), "ex-btn-quiet"));
    header.append(brand, actions); root.append(header);
    const form = node("div", "ex-composer");
    form.append(node("div", "ex-section-label", "收藏一段喜欢的文字"));
    const quote = textarea("一句话、一段文字，或刚刚闪现的灵感……", "", "ex-compose-text");
    const tags = inputBox("标签（用逗号分隔，可选）");
    tags.classList.add("ex-tags-input");
    const composeActions = node("div", "ex-compose-actions");
    const saveButton = button("保存摘录", () => void save(), "ex-btn-primary");
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
        quote.value = ""; tags.value = ""; await this.reload();
      } catch(e) { new Notice(`保存失败：${errorMessage(e)}`); }
      finally {
        saving = false; saveButton.disabled = false; quote.disabled = false; tags.disabled = false;
        saveButton.textContent = "保存摘录";
      }
    };
    const toolbar = node("div", "ex-toolbar");
    const search = inputBox("搜索摘录、来源、变种或批注…");
    search.setAttribute("aria-label", "搜索摘录");
    search.addEventListener("input", () => { this.searchText = search.value.toLocaleLowerCase(); this.drawCards(); });
    this.countEl = node("span", "ex-count", "0 条收藏");
    toolbar.append(search, this.countEl); root.append(toolbar);
    this.listEl = node("div", "ex-card-list"); root.append(this.listEl);
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
    if (entry.id === this.recalledId) card.classList.add("ex-recalled");
    const top = node("div", "ex-card-top");
    if (entry.id === this.recalledId) top.append(node("span", "ex-recall-hint", "随机回顾"));
    top.append(node("span", "ex-date", dateLabel(entry.created)));
    const tools = node("div", "ex-card-actions");
    if (!entry.readOnly) {
      tools.append(button(entry.favorite ? "★ 已珍藏" : "☆ 珍藏", () => void this.saveEdit(entry, x => ({...x, favorite: !x.favorite})), "ex-btn-quiet"));
      tools.append(button("编辑", () => { this.editing = this.editing === entry.id ? null : entry.id; this.drawCards(); }, "ex-btn-quiet"));
      const more = button("更多", () => {
        const menu = new Menu();
        menu.addItem(item => item.setTitle("移至回收站").onClick(() => this.confirmTrash(entry)));
        const rect = more.getBoundingClientRect();
        menu.showAtPosition({ x: rect.left, y: rect.bottom }, more.ownerDocument);
      }, "ex-btn-quiet");
      more.setAttribute("aria-label", "更多摘录操作");
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
      const add = button("＋ 添加内容", () => {
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
    const edit = node("div", "ex-edit-panel");
    const draft = this.quoteDrafts.get(entry.id) || { text: entry.text, tags: entry.tags.join(", ") };
    const content = textarea("摘录正文", draft.text); content.rows = 5;
    const tags = inputBox("标签（逗号分隔）", draft.tags);
    const keepDraft = () => this.quoteDrafts.set(entry.id, { text: content.value, tags: tags.value });
    content.addEventListener("input", keepDraft);
    tags.addEventListener("input", keepDraft);
    const actions = node("div", "ex-actions");
    actions.append(button("取消", () => { this.quoteDrafts.delete(entry.id); this.editing = null; this.drawCards(); }, "ex-btn-quiet"));
    actions.append(button("保存修改", () => void this.saveEdit(entry, previous => ({
      ...previous, text: content.value.trim(), tags: [...new Set(tags.value.split(/[,，]/).map(s => s.trim().replace(/^#/, "")).filter(Boolean))]
    }), () => { this.quoteDrafts.delete(entry.id); this.editing = null; }), "ex-btn-primary"));
    edit.append(content, tags, actions); card.append(edit);
  }
  private renderExtraGroup(target: HTMLElement, entry: Entry, kind: ExtraKind) {
    const group = node("section", "ex-extra-group");
    const key = `${entry.id}:${kind}`;
    const data = entry.extras.filter(x => x.kind === kind);
    const isOpen = this.plugin.settings.collapseExtras ? this.expanded.has(key) : !this.expanded.has(key);
    const line = button(`${isOpen ? "▾" : "▸"}  ${EXTRA_LABELS[kind]}  ${data.length}`, () => {
      if (this.expanded.has(key)) this.expanded.delete(key); else this.expanded.add(key);
      this.drawCards();
    }, "ex-group-trigger");
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
    const draft = this.extraDrafts.get(draftKey) || { title: original?.title || "", content: original?.content || "" };
    const title = inputBox("标题，例如：原始出处 / 精简版", draft.title);
    const text = textarea("补充内容（支持存储 Markdown 文本）", draft.content); text.rows = 4;
    const keepDraft = () => this.extraDrafts.set(draftKey, { title: title.value, content: text.value });
    title.addEventListener("input", keepDraft);
    text.addEventListener("input", keepDraft);
    const actions = node("div", "ex-actions");
    actions.append(button("取消", () => { this.extraDrafts.delete(draftKey); this.editingExtra = null; this.drawCards(); }, "ex-btn-quiet"));
    actions.append(button("保存", () => void this.saveEdit(entry, previous => ({
      ...previous, extras: original ? previous.extras.map(x => x.id === original.id ? { ...x, title: title.value.trim(), content: text.value } : x)
        : [...previous.extras, { id: makeId("x"), kind, title: title.value.trim() || EXTRA_LABELS[kind], content: text.value }]
    }), () => { this.extraDrafts.delete(draftKey); this.editingExtra = null; }), "ex-btn-primary"));
    if (original) {
      let confirm = false;
      const del = button("删除条目", () => {
        if (!confirm) { confirm = true; del.textContent = "确认删除"; return; }
        void this.saveEdit(entry, previous => ({ ...previous, extras: previous.extras.filter(x => x.id !== original.id) }), () => { this.extraDrafts.delete(draftKey); this.editingExtra = null; });
      }, "ex-btn-danger");
      actions.append(del);
    }
    pane.append(title, text, actions); target.append(pane);
  }
  private confirmTrash(entry: Entry): void {
    if (entry.readOnly || this.deletionInFlight) return;
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

  private async saveEdit(entry: Entry, change: (previous: Entry) => Entry, onSuccess?: () => void): Promise<void> {
    if (entry.readOnly) { new Notice("文件结构有误，已禁止写入"); return; }
    try { await this.repo.update(entry, change); onSuccess?.(); await this.reload(); }
    catch(e) { new Notice(`修改失败：${errorMessage(e)}`); }
  }
}
