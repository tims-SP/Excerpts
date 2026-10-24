import { MarkdownRenderChild, MarkdownRenderer, Menu, Notice, TFile, setIcon } from "obsidian";
import { findSectionHeadingLine } from "./codec";
import type ExcerptsPlugin from "./main";
import { DeleteCandidate, DeleteProgress, EntryRepository } from "./repository";
import { DeleteExcerptModal, DeleteOutcome } from "./delete-modal";
import { TagPicker } from "./tag-picker";
import { CardIndex, ParsedMarkdown, Workspace, isExcerptPath } from "./model";
import { PageFilter, isFiltered } from "./page-config";
import { SavePageModal } from "./page-modal";

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
  private searchButton!: HTMLButtonElement;
  private searchWrap!: HTMLElement;
  private tagBar!: HTMLElement;
  private filterButton!: HTMLButtonElement;
  private searchText = "";
  private tagFilter = "";
  private filterOpen = false;
  private matches: Set<string> | null = null;
  private searchToken = 0;
  private scanStatus: "idle" | "blocked" | "scanning" | "done" | "stale" | "error" = "idle";
  private scanDirty = false;
  private homeInvalid = false;
  private homeInvalidCause: "path" | "configuration" = "path";
  private scanDone = 0;
  private scanTotal = 0;
  private lastScanCount: number | null = null;
  private scanVisible = false;
  private scanRevealTimer: ReturnType<typeof setTimeout> | null = null;
  private scanStatusEl!: HTMLElement;
  private pageHintEl!: HTMLElement;
  private scanTextEl!: HTMLElement;
  private scanIconEl!: HTMLElement;
  private scanProgressEl!: HTMLElement;
  private scanFillEl!: HTMLElement;
  private scanAnnouncementEl!: HTMLElement;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshToken = 0;
  private saveBusy = false;
  private updateComposerControls: () => void = () => {};
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
  private reflowCaptureTags: () => void = () => {};
  private openTagEditors = new Set<string>();
  private pendingTags = new Set<string>();
  private selectionMode: "normal" | "selecting" | "deleting" = "normal";
  private selectionScope = new Set<string>();
  private selectedPaths = new Set<string>();
  private selectedCandidates = new Map<string, DeleteCandidate>();
  private selectionToolbarEl!: HTMLElement;
  private selectionCountEl!: HTMLElement;
  private selectionAllButton!: HTMLButtonElement;
  private selectionDoneButton!: HTMLButtonElement;
  private selectionFooterEl!: HTMLElement;
  private selectedFooterCountEl!: HTMLElement;
  private deleteSelectedButton!: HTMLButtonElement;
  private deleteBusy = false;
  private selectionBusy = false;
  private selectionProcessed = 0;
  private selectionBatchTotal = 0;
  private searchReady = true;
  private disposed = false;
  constructor(container: HTMLElement, private plugin: ExcerptsPlugin, public readonly workspace: Workspace,
    private repo: EntryRepository, private savedFilter: PageFilter | null = null,
    private savedPageRaw: string | null = null) {
    super(container);
    this.tagFilter = savedFilter?.tag ?? "";
    this.searchText = savedFilter?.query ?? "";
  }
  onload(): void {
    this.build();
    if (typeof ResizeObserver !== "undefined") {
      this.tagResizeObserver = new ResizeObserver(() => {
        this.reflowVisibleTags();
        this.reflowCaptureTags();
      });
      this.tagResizeObserver.observe(this.containerEl);
    }
    void this.reload();
  }
  onunload(): void {
    this.disposed = true;
    this.refreshToken++; this.renderToken++; this.searchToken++;
    if (this.scanRevealTimer) clearTimeout(this.scanRevealTimer);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.observer?.disconnect();
    this.tagResizeObserver?.disconnect();
    this.selectedPaths.clear(); this.selectedCandidates.clear(); this.selectionScope.clear();
    this.unmountMarkdown();
    this.plugin.notifyActivityChange(this);
    this.queue = [];
  }
  /** Conflicting operations are refused, never queued or replayed. */
  isBusy(): boolean {
    return this.scanStatus === "scanning" || !this.searchReady || this.saveBusy ||
      this.deleteBusy || this.selectionMode !== "normal" ||
      this.openTagEditors.size > 0 || this.pendingTags.size > 0;
  }
  private reason(action: "save" | "refresh" | "search" | "filter" | "tag" | "select" | "delete" | "page"): string | null {
    if (this.disposed) return "页面已关闭";
    if (this.homeInvalid) return this.homeInvalidCause === "configuration"
      ? "摘录页配置已变化，请从文件列表重新打开" : "摘录页位置已变化，请从文件列表重新打开";
    if (this.plugin.isBusy(this)) return "另一个摘录页面正在操作，请完成后再试";
    if (this.scanStatus === "scanning") return "正在扫描，请完成后再操作";
    if (this.saveBusy) return "正在保存，请完成后再操作";
    if (this.deleteBusy) return "正在删除，请完成后再操作";
    if (this.selectionMode !== "normal") return "请先退出批量选择";
    if (this.pendingTags.size) return "正在保存标签，请完成后再操作";
    if (this.openTagEditors.size && action !== "tag") return "请先完成或取消标签编辑";
    if (!this.searchReady) return "正在搜索，请先清除搜索条件";
    // A blocked page has no index yet. Its persisted search is applied after manual scanning.
    if (action === "refresh" && this.scanStatus === "blocked") return null;
    if (this.searchText && ["select", "refresh", "tag", "delete", "filter"].includes(action))
      return "请先清除搜索条件，再进行此操作";
    if (this.scanStatus === "blocked" && action !== "refresh")
      return "本页尚未扫描，请先手动刷新";
    if (this.scanStatus === "stale" || this.scanStatus === "error" || this.scanStatus === "idle") {
      if (action === "select" || action === "search" || action === "filter" || action === "tag" || action === "delete")
        return "摘录索引需要刷新，请先手动刷新";
    }
    return null;
  }
  private guard(action: Parameters<ExcerptsRenderChild["reason"]>[0]): boolean {
    const blocked = this.reason(action);
    if (blocked) { new Notice(blocked); return false; }
    return true;
  }
  syncControls(): void { this.updateAvailability(false); }
  private updateAvailability(broadcast = true): void {
    if (this.disposed || !this.searchButton) return;
    const searching = !this.searchReady;
    this.searchInput.disabled = Boolean(this.reason("search")) || searching;
    const canClear = !this.homeInvalid && this.scanStatus !== "scanning" && Boolean(this.searchText) &&
      (searching || this.scanStatus === "stale" || this.scanStatus === "error");
    this.searchButton.disabled = !canClear && Boolean(this.reason("search"));
    this.searchButton.title = canClear ? "清除搜索条件" : (this.reason("search") ?? "搜索");
    this.filterButton.disabled = Boolean(this.reason("filter"));
    this.updateComposerControls();
    for (const button of Array.from(this.containerEl.querySelectorAll<HTMLButtonElement>(".ex-filter-tags button")))
      button.disabled = Boolean(this.reason("filter"));
    for (const el of Array.from(this.containerEl.querySelectorAll<HTMLButtonElement>(
      ".ex-card .ex-card-options, .ex-card .ex-add-tag, .ex-card .ex-tag"))) {
      const isTagFilter = el.classList.contains("ex-tag");
      const otherTagEditor = el.classList.contains("ex-add-tag") &&
        this.openTagEditors.size > 0 && !this.openTagEditors.has(el.closest<HTMLElement>(".ex-card")?.dataset.path ?? "");
      el.disabled = otherTagEditor || Boolean(this.reason(isTagFilter ? "filter" :
        el.classList.contains("ex-add-tag") ? "tag" : "page"));
    }
    if (broadcast) this.plugin.notifyActivityChange(this);
  }
  /** Mark cached results obsolete without scheduling any scan. */
  markStale(path?: string): void {
    if (this.disposed || this.homeInvalid || (path && path !== this.workspace.homePath &&
        !isExcerptPath(path, this.workspace))) return;
    const staleSelection = this.scanStatus === "done" && this.selectionMode === "selecting";
    if (this.scanStatus === "scanning") this.scanDirty = true;
    else this.scanStatus = "stale";
    if (!this.searchReady) {
      this.searchToken++;
      if (this.searchTimer) clearTimeout(this.searchTimer);
      this.searchTimer = null;
      this.searchReady = true;
      this.matches = null;
      if (this.listEl) this.drawCards();
    }
    this.renderScanStatus();
    if (this.selectionMode !== "normal") this.updateSelectionControls();
    this.updateAvailability();
    if (staleSelection) new Notice("摘录内容已变化，请退出批量选择后刷新");
  }
  requestRefresh(force = false): void {
    if (!this.guard("refresh")) return;
    this.workspace.recursive = this.plugin.settings.recursive;
    void this.reload(force);
  }
  /** A changed or relocated .excerpts page cannot safely continue using its old configuration. */
  invalidateHome(cause: "path" | "configuration" = "path"): void {
    if (this.disposed || this.homeInvalid) return;
    this.homeInvalid = true;
    this.homeInvalidCause = cause;
    this.refreshToken++; this.searchToken++;
    if (this.scanRevealTimer) clearTimeout(this.scanRevealTimer);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.scanRevealTimer = null; this.searchTimer = null;
    this.scanVisible = false;
    this.scanStatus = "stale";
    this.searchReady = true;
    if (!this.deleteBusy) {
      this.selectionMode = "normal";
      this.selectionScope.clear(); this.selectedPaths.clear(); this.selectedCandidates.clear();
      this.openTagEditors.clear();
      this.updateSelectionUI();
      // Leave the composer and its unsaved text intact, but discard in-place editors.
      for (const editor of Array.from(this.listEl.querySelectorAll<HTMLElement>(".ex-tag-editor"))) {
        editor.hidden = true;
        editor.replaceChildren();
      }
    }
    this.renderScanStatus();
    const message = cause === "configuration"
      ? "摘录页配置已变化，请从文件列表重新打开"
      : "摘录页位置已变化，请从文件列表重新打开";
    this.announceScan(message);
    this.updateAvailability();
    new Notice(message);
  }
  private renderScanStatus(): void {
    const status = this.homeInvalid ? "invalid" :
      this.scanStatus === "scanning" && !this.scanVisible
        ? (this.lastScanCount === null ? "idle" : "done") : this.scanStatus;
    const labels = {
      idle: "未扫描",
      blocked: "未扫描 · 请手动刷新",
      scanning: "扫描中 " + this.scanDone.toLocaleString("zh-CN") + "/" +
        this.scanTotal.toLocaleString("zh-CN"),
      done: "已扫描 · " + (this.lastScanCount ?? 0).toLocaleString("zh-CN") + " 条",
      stale: "待刷新 · " + (this.lastScanCount ?? 0).toLocaleString("zh-CN") + " 条",
      error: "扫描失败",
      invalid: "页面已失效 · 请重新打开"
    };
    this.scanStatusEl.dataset.state = status;
    this.scanTextEl.textContent = labels[status];
    const hint = this.homeInvalid
      ? this.homeInvalidCause === "configuration"
        ? "筛选配置已变化，当前页面无法继续操作。如有未保存的草稿，请先复制，再从文件列表重新打开摘录页。"
        : "当前页面已失效。如有未保存的草稿，请先复制，再从文件列表重新打开摘录页。"
      : this.scanStatus === "blocked"
        ? "因其他摘录页正在操作，本页未扫描。待操作结束后，请从页面选项手动刷新。"
        : "";
    this.scanStatusEl.title = hint;
    if (this.pageHintEl) {
      this.pageHintEl.textContent = hint;
      this.pageHintEl.dataset.state = status;
      this.pageHintEl.hidden = !hint;
    }
    setIcon(this.scanIconEl, status === "scanning" ? "loader-circle" :
      status === "done" ? "check" : status === "stale" ? "refresh-cw" :
      status === "error" || status === "invalid" ? "alert-circle" :
      status === "blocked" ? "info" : "circle-dashed");
    this.scanProgressEl.hidden = status !== "scanning";
    if (status === "scanning") {
      this.scanProgressEl.setAttribute("aria-valuenow", String(this.scanDone));
      this.scanProgressEl.setAttribute("aria-valuemax", String(this.scanTotal));
      this.scanFillEl.style.width = (this.scanTotal ? this.scanDone / this.scanTotal * 100 : 0) + "%";
    }
  }
  private announceScan(message: string): void {
    this.scanAnnouncementEl.textContent = message;
  }
  private build(): void {
    const root = this.containerEl;
    root.replaceChildren();
    root.classList.add("excerpts-root");
    const header = node("div", "ex-header");
    header.append(node("div", "ex-brand"));
    const fileName = this.workspace.homePath.split("/").pop()?.replace(/\.excerpts$/i, "") ?? "摘录";
    header.firstElementChild!.append(node("h2", "ex-title", this.savedFilter ? fileName : "摘录"));
    this.scanStatusEl = node("div", "ex-scan-status");
    const scanLine = node("div", "ex-scan-line");
    this.scanIconEl = node("span", "ex-scan-icon");
    this.scanTextEl = node("span", "ex-scan-text");
    scanLine.append(this.scanIconEl, this.scanTextEl);
    this.scanProgressEl = node("div", "ex-scan-progress");
    this.scanProgressEl.setAttribute("role", "progressbar");
    this.scanProgressEl.setAttribute("aria-label", "摘录索引扫描进度");
    this.scanProgressEl.setAttribute("aria-valuemin", "0");
    this.scanFillEl = node("div", "ex-scan-progress-fill");
    this.scanProgressEl.append(this.scanFillEl);
    this.scanAnnouncementEl = node("span", "ex-scan-announcement");
    this.scanAnnouncementEl.setAttribute("role", "status");
    this.scanAnnouncementEl.setAttribute("aria-live", "polite");
    this.scanStatusEl.append(scanLine, this.scanProgressEl, this.scanAnnouncementEl);
    header.append(this.scanStatusEl);
    this.pageHintEl = node("p", "ex-page-hint");
    this.pageHintEl.setAttribute("role", "status");
    root.append(header, this.pageHintEl);
    this.renderScanStatus();

    // The outer composer is the only rounded surface; textarea has no native chrome.
    const form = node("section", "ex-composer");
    form.setAttribute("aria-label", "快速摘录");
    const body = node("div", "ex-compose-body");
    const quote = node("textarea", "ex-compose-text");
    quote.placeholder = "现在想记录的是…";
    quote.rows = 3;
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
    quote.addEventListener("focus", () => { form.classList.add("ex-is-composing"); fit();
      if (!tagsPane.hidden) closeTagPanel(false);
    });

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
    const composeActions = node("div", "ex-compose-actions");
    const options = node("div", "ex-capture-options");
    const tagToggle = button("", () => {
      if (saving) return;
      if (tagsPane.hidden) openTagPanel();
      else closeTagPanel(true);
    }, "ex-capture-tag-toggle");
    tagToggle.setAttribute("aria-label", "添加标签");
    tagToggle.setAttribute("aria-expanded", "false");
    const updateTagToggle = () => {
      tagToggle.replaceChildren();
      const icon = node("span", "ex-capture-toggle-icon");
      setIcon(icon, selectedTags.size ? "plus" : "hash");
      tagToggle.append(icon);
      if (!selectedTags.size) tagToggle.append(node("span", "ex-capture-toggle-text", "标签"));
    };
    const openTagPanel = () => {
      if (saving) return;
      tagsPane.hidden = false;
      tagToggle.setAttribute("aria-expanded", "true");
      picker.focus();
    };
    const closeTagPanel = (restoreFocus: boolean) => {
      tagsPane.hidden = true;
      tagToggle.setAttribute("aria-expanded", "false");
      if (restoreFocus) tagToggle.focus();
    };
    const repaintSelected = () => {
      selectedChips.replaceChildren();
      for (const tag of selectedTags) {
        const pill = button("", openTagPanel, "ex-tag ex-capture-chip");
        pill.setAttribute("aria-label", "编辑标签：" + tag);
        pill.replaceChildren(node("span", "ex-tag-label", "#" + tag));
        pill.title = "#" + tag;
        selectedChips.append(pill);
      }
      if (selectedTags.size) {
        const more = button("", openTagPanel, "ex-capture-overflow");
        more.setAttribute("aria-label", "查看其余标签");
        more.hidden = true;
        selectedChips.append(more);
      }
      selectedChips.hidden = !selectedTags.size;
      updateTagToggle();
      const schedule = () => {
        if (typeof requestAnimationFrame === "function") requestAnimationFrame(this.reflowCaptureTags);
        else setTimeout(this.reflowCaptureTags, 0);
      };
      schedule();
    };
    this.reflowCaptureTags = () => {
      if (!selectedChips.isConnected || selectedChips.hidden || !selectedChips.clientWidth) return;
      const chips = Array.from(selectedChips.querySelectorAll<HTMLButtonElement>(".ex-capture-chip"));
      const more = selectedChips.querySelector<HTMLButtonElement>(".ex-capture-overflow");
      if (!more) return;
      chips.forEach(chip => { chip.hidden = false; });
      more.hidden = true;
      const width = selectedChips.clientWidth, gap = 5;
      let used = 0, visible = 0;
      for (let index = 0; index < chips.length; index++) {
        const chipWidth = chips[index].getBoundingClientRect().width;
        const reserve = index === chips.length - 1 ? 0 : 37;
        if (used + (visible ? gap : 0) + chipWidth + (reserve ? gap + reserve : 0) > width) break;
        used += (visible ? gap : 0) + chipWidth;
        visible++;
      }
      chips.forEach((chip, i) => { chip.hidden = i >= visible; });
      if (visible < chips.length) {
        more.textContent = "+" + (chips.length - visible);
        more.setAttribute("aria-label", "查看其余 " + (chips.length - visible) + " 个标签");
        more.hidden = false;
      }
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
      retryOpenPath = null;
      this.showSuggestions();
    };
    options.append(selectedChips, tagToggle);
    const editorButton = button("", () => void save(true), "ex-open-editor");
    editorButton.title = "进入 Markdown 编辑器";
    editorButton.setAttribute("aria-label", "编辑文档");
    const editorIcon = node("span", "ex-open-editor-icon");
    setIcon(editorIcon, "file-pen-line");
    editorButton.append(editorIcon, node("span", "ex-open-editor-label", "编辑文档"));
    const saveButton = button("保存", () => void save(false), "ex-btn-primary mod-cta");
    this.updateComposerControls = () => {
      const blocked = Boolean(this.reason("save"));
      saveButton.disabled = blocked || !quote.value.trim();
      editorButton.disabled = blocked;
      saveButton.title = blocked ? (this.reason("save") ?? "") : "保存摘录";
      editorButton.title = blocked ? (this.reason("save") ?? "") : "进入 Markdown 编辑器";
    };
    this.updateComposerControls();
    quote.addEventListener("input", () => { if (!saving) this.updateComposerControls(); });
    composeActions.append(options, editorButton, saveButton);
    const picker = new TagPicker({
      available: () => this.items.flatMap(item => item.tags),
      selected: () => selectedTags,
      onToggle: toggleTag,
      onEscape: () => closeTagPanel(true)
    }, "ex-tags-input");
    const tagSearch = picker.input;
    tagsPane.append(picker.element);
    body.append(quote);
    form.append(body, tagsPane, composeActions);
    root.append(form);
    let saving = false;
    let resume = false;
    let retryOpenPath: string | null = null;
    quote.addEventListener("input", () => { retryOpenPath = null; });
    quote.addEventListener("keydown", event => {
      if (!event.isComposing && (event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault(); resume = true; void save();
      }
    });

    const save = async (openEditor = false) => {
      if (!this.guard("save") || saving) return;
      const markdown = quote.value.trim();
      if (!openEditor && !markdown) { new Notice("请输入摘录内容"); return; }
      saving = true;
      this.saveBusy = true;
      this.updateAvailability();
      quote.disabled = true; picker.setDisabled(true); tagToggle.disabled = true;
      saveButton.disabled = true; editorButton.disabled = true;
      selectedChips.querySelectorAll("button").forEach(btn => { btn.disabled = true; });
      saveButton.textContent = "保存中…";
      let created = false;
      try {
        let file: TFile;
        if (openEditor && retryOpenPath) {
          const retry = this.plugin.app.vault.getAbstractFileByPath(retryOpenPath);
          if (!(retry instanceof TFile)) {
            retryOpenPath = null;
            throw new Error("已创建的 Markdown 文件不存在，请重新操作");
          }
          file = retry;
        } else {
          file = await this.repo.create(this.workspace, markdown, [...selectedTags]);
          created = true;
          if (openEditor) retryOpenPath = file.path;
        }

        // Once the file exists, the draft is saved even if opening the native tab fails.
        if (created) {
          quote.value = ""; tagSearch.value = ""; selectedTags.clear();
          picker.refresh(); repaintSelected(); persistDraft();
          closeTagPanel(false); fit(); form.classList.remove("ex-is-composing");
          this.markStale(file.path);
        }
        if (openEditor) {
          const initialRaw = await this.repo.readRaw(file.path);
          await this.plugin.openMarkdown(file.path, undefined, true);
          this.plugin.trackNewEditor(file, initialRaw);
          retryOpenPath = null;
        } else if (resume) quote.focus();
      } catch (error) {
        notify(error);
        if (openEditor && retryOpenPath)
          new Notice("文件已创建；再次点击「编辑文档」可重试打开");
      } finally {
        saving = false; resume = false;
        this.saveBusy = false;
        quote.disabled = false; picker.setDisabled(false); tagToggle.disabled = false;
        editorButton.disabled = false;
        saveButton.disabled = !quote.value.trim();
        selectedChips.querySelectorAll("button").forEach(btn => { btn.disabled = false; });
        saveButton.textContent = "保存";
        this.updateAvailability();
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
    this.searchWrap.hidden = !this.searchText;
    this.searchInput = node("input", "ex-input ex-search");
    this.searchInput.value = this.searchText;
    this.searchInput.type = "search";
    this.searchInput.placeholder = "搜索摘录内容或标签…";
    this.searchInput.setAttribute("aria-label", "搜索摘录");
    this.searchWrap.append(this.searchInput);
    const searchButton = iconButton("search", "搜索", () => {
      if (this.scanStatus === "scanning" || this.saveBusy || this.deleteBusy ||
          this.selectionMode !== "normal" || this.openTagEditors.size || this.plugin.isBusy(this)) {
        this.guard("search"); return;
      }
      if (!this.searchReady || (this.searchText &&
          (this.scanStatus === "stale" || this.scanStatus === "error"))) {
        this.searchText = ""; this.searchInput.value = "";
        this.scheduleSearch(); this.searchWrap.hidden = true;
        searchButton.setAttribute("aria-expanded", "false");
        return;
      }
      if (!this.guard("search")) return;
      this.searchWrap.hidden = !this.searchWrap.hidden;
      searchButton.setAttribute("aria-expanded", String(!this.searchWrap.hidden));
      if (!this.searchWrap.hidden) this.searchInput.focus();
      else if (this.searchText) { this.searchInput.value = ""; this.searchText = ""; this.scheduleSearch(); }
    });
    this.searchButton = searchButton;
    searchButton.setAttribute("aria-expanded", String(!this.searchWrap.hidden));
    this.searchInput.addEventListener("input", () => {
      if (!this.guard("search")) { this.searchInput.value = this.searchText; return; }
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
      if (!this.guard("filter")) return;
      this.filterOpen = !this.filterOpen;
      this.renderTagsFilter();
    });
    this.filterButton.setAttribute("aria-expanded", "false");
    actions.append(this.filterButton);
    const pageMenuButton = iconButton("ellipsis", "页面选项", () => this.showPageMenu(pageMenuButton),
      "ex-page-options");
    pageMenuButton.setAttribute("aria-haspopup", "menu");
    actions.append(pageMenuButton);
    toolbar.append(actions);
    this.selectionToolbarEl = node("div", "ex-toolbar ex-selection-toolbar");
    this.selectionToolbarEl.hidden = true;
    const selectionTitle = node("div", "ex-toolbar-title");
    this.selectionCountEl = node("span", "ex-selection-count");
    selectionTitle.append(this.selectionCountEl);
    const selectionActions = node("div", "ex-toolbar-actions");
    this.selectionAllButton = button("全选", () =>
      void this.toggleSelectAll().catch(notify), "ex-select-all");
    this.selectionDoneButton = button("完成", () => this.exitSelectionMode(), "ex-select-done");
    selectionActions.append(this.selectionAllButton, this.selectionDoneButton);
    this.selectionToolbarEl.append(selectionTitle, selectionActions);
    root.append(toolbar, this.selectionToolbarEl, this.searchWrap);
    this.containerEl.addEventListener("keydown", event => {
      if (event.key === "Escape" && this.selectionMode === "selecting") {
        event.preventDefault();
        this.exitSelectionMode();
      }
    });
    this.tagBar = node("div", "ex-filter-tags");
    root.append(this.tagBar);
    this.listEl = node("div", "ex-card-list");
    root.append(this.listEl);
    this.selectionFooterEl = node("div", "ex-selection-footer");
    this.selectionFooterEl.hidden = true;
    this.selectedFooterCountEl = node("span", "ex-selection-footer-count");
    const footerActions = node("div", "ex-selection-footer-actions");
    footerActions.append(button("取消", () => this.exitSelectionMode(), "ex-select-cancel"));
    this.deleteSelectedButton = button("删除 (0)", () => this.confirmBulkDelete(), "ex-delete-selected mod-warning");
    footerActions.append(this.deleteSelectedButton);
    this.selectionFooterEl.append(this.selectedFooterCountEl, footerActions);
    root.append(this.selectionFooterEl);
    this.updateAvailability();
  }
  private currentFilter(): PageFilter {
    return { tag: this.tagFilter.trim(), query: this.searchText.trim() };
  }
  private isPageDirty(): boolean {
    if (!this.savedFilter) return false;
    const current = this.currentFilter();
    return current.tag !== this.savedFilter.tag || current.query !== this.savedFilter.query;
  }
  private applyPageFilter(filter: PageFilter): void {
    if (!this.guard("filter")) return;
    this.searchToken++; // Cancel any previous async search before replacing its query.
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = null;
    this.matches = null;
    this.searchReady = !filter.query;
    this.pageSize = 40;
    this.tagFilter = filter.tag;
    this.searchText = filter.query;
    this.filterOpen = Boolean(filter.tag);
    this.searchInput.value = filter.query;
    this.searchWrap.hidden = !filter.query;
    this.searchButton.setAttribute("aria-expanded", String(Boolean(filter.query)));
    this.renderTagsFilter();
    if (filter.query) this.scheduleSearch();
    else { this.drawCards(); this.updateAvailability(); }
  }
  private showPageMenu(buttonEl: HTMLButtonElement): void {
    const current = this.currentFilter();
    const changed = this.isPageDirty();
    const menu = new Menu();
    menu.addItem(item => item.setTitle("刷新摘录").setIcon("refresh-cw")
      .setDisabled(Boolean(this.reason("refresh")))
      .onClick(() => this.requestRefresh(true)));
    menu.addSeparator();
    menu.addItem(item => item.setTitle("批量选择").setIcon("check-square")
      .setDisabled(Boolean(this.reason("select")) || !this.visibleItems().length)
      .onClick(() => this.enterSelectionMode()));
    menu.addSeparator();
    if (this.savedFilter && changed) {
      menu.addItem(item => item.setTitle("更新当前页面").setIcon("save")
        .setDisabled(Boolean(this.reason("page")))
        .onClick(() => void this.updateCurrentPage().catch(notify)));
    }
    menu.addItem(item => item
      .setTitle(this.savedFilter ? "另存为摘录页…" : "保存当前筛选…")
      .setIcon("bookmark-plus")
      .setDisabled(!isFiltered(current) || Boolean(this.reason("page")))
      .onClick(() => this.openSavePageModal()));
    if (this.savedFilter && changed) {
      menu.addItem(item => item.setTitle("恢复已保存的筛选").setIcon("undo-2")
        .setDisabled(Boolean(this.reason("filter")))
        .onClick(() => this.applyPageFilter(this.savedFilter!)));
    }
    menu.addItem(item => item.setTitle("清除筛选").setIcon("rotate-ccw")
      .setDisabled(!isFiltered(current) || Boolean(this.reason("filter")))
      .onClick(() => this.applyPageFilter({ tag: "", query: "" })));
    const rect = buttonEl.getBoundingClientRect();
    menu.showAtPosition({ x: rect.right, y: rect.bottom }, buttonEl.ownerDocument);
  }
  private openSavePageModal(): void {
    if (!this.guard("page")) return;
    const current = this.currentFilter();
    if (!isFiltered(current)) return;
    const stem = (current.tag ? current.tag + "摘录" : "摘录筛选")
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, "").slice(0, 60) || "摘录筛选";
    let suggested = stem;
    for (let index = 2; index <= 100; index++) {
      if (!this.plugin.savedPageNameIssue(this.workspace.homePath, suggested)) break;
      suggested = stem.slice(0, 54) + "-" + index;
    }
    const summary = "当前条件：" +
      (current.tag ? "#" + current.tag : "全部标签") +
      (current.query ? " · 搜索「" + current.query + "」" : "");
    new SavePageModal(this.plugin.app, suggested,
      name => this.reason("page") ?? this.plugin.savedPageNameIssue(this.workspace.homePath, name),
      async name => {
        if (!this.guard("page")) throw new Error("摘录页已失效，请重新打开");
        const file = await this.plugin.createSavedPage(this.workspace.homePath, name, current);
        new Notice("已创建摘录页：" + file.basename);
        await this.plugin.openHome(file.path);
      }, summary).open();
  }
  private async updateCurrentPage(): Promise<void> {
    if (!this.guard("page") || !this.savedFilter || this.savedPageRaw === null || !this.isPageDirty()) return;
    const filter = this.currentFilter();
    await this.plugin.updateSavedPage(this.workspace.homePath, this.savedPageRaw, filter);
    // Do not keep using an in-memory filter after its underlying .excerpts file has changed.
    this.invalidateHome("configuration");
  }
  /** Freeze the current filtered result set; no Markdown bodies are read for selection. */
  private enterSelectionMode(): void {
    // A menu can remain open when a scan starts; recheck at invocation time.
    if (!this.guard("select") || !this.visibleItems().length) return;
    this.selectionScope = new Set(this.visibleItems().map(item => item.path));
    this.selectedPaths.clear();
    this.selectedCandidates.clear();
    this.selectionMode = "selecting";
    this.updateSelectionUI();
    this.updateAvailability();
  }
  private exitSelectionMode(): void {
    if (this.selectionMode !== "selecting" || this.selectionBusy) return;
    this.selectionMode = "normal";
    this.selectionScope.clear();
    this.selectedPaths.clear();
    this.selectedCandidates.clear();
    this.updateSelectionUI();
    this.drawCards();
    this.updateAvailability();
  }
  private paintCardSelection(card: HTMLElement, path: string): void {
    const active = this.selectionMode !== "normal";
    const checked = this.selectedPaths.has(path);
    card.classList.toggle("ex-is-selected", active && checked);
    if (active) {
      card.setAttribute("role", "checkbox");
      card.setAttribute("tabindex", "0");
      card.setAttribute("aria-checked", String(checked));
      card.setAttribute("aria-label", (checked ? "取消选择：" : "选择：") +
        (this.items.find(item => item.path === path)?.basename ?? path));
    } else {
      card.removeAttribute("role"); card.removeAttribute("tabindex");
      card.removeAttribute("aria-checked"); card.removeAttribute("aria-label");
    }
    for (const selector of [".ex-quote", ".ex-extras", ".ex-tag-editor", ".ex-chips"]) {
      const element = card.querySelector<HTMLElement>(selector);
      if (element) element.inert = active;
    }
    const mark = card.querySelector<HTMLElement>(".ex-selection-indicator");
    if (mark) setIcon(mark, checked ? "check-circle-2" : "circle");
  }
  private updateSelectionControls(): void {
    if (this.selectionMode === "normal") return;
    const chosen = this.selectedPaths.size, total = this.selectionScope.size;
    this.containerEl.classList.toggle("ex-is-selecting-busy", this.selectionBusy);
    this.selectionCountEl.textContent = this.selectionBusy ?
      "正在选择 " + this.selectionProcessed + " / " + this.selectionBatchTotal :
      "已选 " + chosen + " / " + total;
    this.selectedFooterCountEl.textContent = this.selectionBusy ?
      "正在选择…" : "已选择 " + chosen + " 条";
    this.selectionAllButton.textContent = chosen === total && total > 0 ? "取消全选" : "全选";
    this.selectionAllButton.disabled = this.homeInvalid || this.deleteBusy || this.selectionBusy || total === 0;
    this.selectionDoneButton.disabled = this.deleteBusy || this.selectionBusy;
    const cancel = this.selectionFooterEl.querySelector<HTMLButtonElement>(".ex-select-cancel");
    if (cancel) cancel.disabled = this.deleteBusy || this.selectionBusy;
    this.deleteSelectedButton.textContent = "删除 (" + chosen + ")";
    this.deleteSelectedButton.disabled = this.deleteBusy || this.selectionBusy || chosen === 0 ||
      this.scanStatus !== "done" || Boolean(this.plugin.isBusy(this));
  }
  private updateSelectionUI(): void {
    const active = this.selectionMode !== "normal";
    this.containerEl.classList.toggle("ex-is-selecting", active);
    const ordinary = this.containerEl.querySelector<HTMLElement>(".ex-toolbar:not(.ex-selection-toolbar)");
    if (ordinary) ordinary.hidden = active;
    this.selectionToolbarEl.hidden = !active;
    this.selectionFooterEl.hidden = !active;
    for (const card of Array.from(this.listEl.querySelectorAll<HTMLElement>(".ex-card")))
      this.paintCardSelection(card, card.dataset.path ?? "");
    this.updateSelectionControls();
  }
  private toggleSelection(path: string): void {
    if (this.homeInvalid || this.selectionMode !== "selecting" || this.selectionBusy || !this.selectionScope.has(path)) return;
    if (this.selectedPaths.has(path)) {
      this.selectedPaths.delete(path);
      this.selectedCandidates.delete(path);
    } else {
      const snapshot = this.repo.snapshotForDelete(path, this.workspace);
      if (!snapshot) {
        this.selectionScope.delete(path);
        this.selectedPaths.delete(path);
        this.selectedCandidates.delete(path);
        this.items = this.items.filter(item => item.path !== path);
        this.matches?.delete(path);
        this.showSuggestions();
        this.renderTagsFilter();
        this.drawCards();
        this.updateSelectionControls();
        new Notice("该摘录已不存在，已从选择范围移除");
        return;
      }
      this.selectedPaths.add(path);
      this.selectedCandidates.set(path, snapshot);
    }
    const card = Array.from(this.listEl.querySelectorAll<HTMLElement>(".ex-card"))
      .find(element => element.dataset.path === path);
    if (card) this.paintCardSelection(card, path);
    this.updateSelectionControls();
  }
  private async toggleSelectAll(): Promise<void> {
    if (this.homeInvalid || this.selectionMode !== "selecting" || this.selectionBusy || this.deleteBusy) return;
    const allSelected = this.selectedPaths.size === this.selectionScope.size;
    this.selectedPaths.clear(); this.selectedCandidates.clear();
    if (allSelected) {
      this.updateSelectionUI();
      return;
    }
    const paths = [...this.selectionScope];
    this.selectionBusy = paths.length > 200;
    this.selectionProcessed = 0;
    this.selectionBatchTotal = paths.length;
    const prunedPaths = new Set<string>();
    if (this.selectionBusy) this.updateSelectionControls();
    try {
      for (let start = 0; start < paths.length; start += 200) {
        if (this.disposed || this.selectionMode !== "selecting") return;
        for (const path of paths.slice(start, start + 200)) {
          if (!this.selectionScope.has(path)) continue;
          const snapshot = this.repo.snapshotForDelete(path, this.workspace);
          if (snapshot) {
            this.selectedPaths.add(path);
            this.selectedCandidates.set(path, snapshot);
          } else {
            // A file removed externally is no longer part of this frozen selection.
            this.selectionScope.delete(path);
            prunedPaths.add(path);
          }
        }
        this.selectionProcessed = Math.min(start + 200, paths.length);
        if (this.selectionBusy) {
          this.updateSelectionControls();
          if (this.selectionProcessed < paths.length)
            await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
      }
    } finally {
      this.selectionBusy = false;
      if (!this.disposed) {
        if (prunedPaths.size) {
          this.items = this.items.filter(item => !prunedPaths.has(item.path));
          for (const path of prunedPaths) this.matches?.delete(path);
          this.showSuggestions();
          this.renderTagsFilter();
          this.drawCards();
        }
        this.updateSelectionUI();
      }
    }
  }
  private confirmSingleDelete(path: string): void {
    if (!this.guard("delete")) return;
    const snapshot = this.repo.snapshotForDelete(path, this.workspace);
    if (!snapshot) { new Notice("该摘录已不存在"); return; }
    new DeleteExcerptModal(this.plugin.app, [path],
      async onProgress => this.performDeletion([snapshot], false, onProgress)).open();
  }
  private confirmBulkDelete(): void {
    if (this.deleteBusy || this.selectionBusy || this.selectionMode !== "selecting" || !this.selectedPaths.size) return;
    if (this.scanStatus !== "done" || this.homeInvalid) {
      new Notice("摘录内容已变化，请退出批量选择后刷新");
      return;
    }
    if (this.plugin.isBusy(this)) {
      new Notice("另一个摘录页面正在操作，请完成后再试");
      return;
    }
    const candidates = [...this.selectedPaths].map(path => this.selectedCandidates.get(path))
      .filter((candidate): candidate is DeleteCandidate => Boolean(candidate));
    if (!candidates.length) return;
    new DeleteExcerptModal(this.plugin.app, candidates.map(candidate => candidate.path),
      async onProgress => this.performDeletion(candidates, true, onProgress)).open();
  }
  private async performDeletion(candidates: readonly DeleteCandidate[], bulk: boolean,
    onProgress: (progress: DeleteProgress) => void): Promise<DeleteOutcome> {
    if (this.deleteBusy || this.scanStatus !== "done" || this.plugin.isBusy(this))
      throw new Error("当前操作未完成，请先结束后再删除");
    this.deleteBusy = true;
    if (bulk) this.selectionMode = "deleting";
    this.updateSelectionUI();
    this.updateAvailability();
    try {
      const result = await this.repo.deleteEntries(this.workspace, candidates, onProgress);
      const removed = new Set(result.deleted);
      for (const path of removed) {
        this.selectedPaths.delete(path); this.selectedCandidates.delete(path);
        this.selectionScope.delete(path); this.matches?.delete(path);
        this.sectionsShown.delete(path); this.expandedBodies.delete(path);
        this.expandedTagRows.delete(path); this.openTagEditors.delete(path);
      }
      for (const failed of result.failed) {
        if (failed.reason.includes("已被修改") || failed.reason.includes("已不存在")) {
          this.selectedPaths.delete(failed.path); this.selectedCandidates.delete(failed.path);
        }
      }
      if (bulk && !result.failed.length) {
        this.selectionMode = "normal";
        this.selectionScope.clear(); this.selectedPaths.clear(); this.selectedCandidates.clear();
      }
      this.items = this.items.filter(item => !removed.has(item.path));
      if (result.deleted.length) this.markStale();
      this.drawCards();
      this.updateSelectionUI();
      const details = result.failed.map(item => item.path.split("/").pop() + "：" + item.reason);
      if (!bulk && result.failed.length) new Notice(details[0] ?? "摘录删除失败", 9000);
      return { deleted: result.deleted.length, failed: result.failed.length, details };
    } finally {
      this.deleteBusy = false;
      if (this.selectionMode === "deleting") this.selectionMode = "selecting";
      if (!this.disposed) { this.updateSelectionUI(); this.updateAvailability(); }
    }
  }
  private showSuggestions: () => void = () => {};
  private async reload(force = false): Promise<void> {
    if (this.disposed || this.homeInvalid || this.isBusy()) return;
    if (this.plugin.isBusy(this)) {
      // The initial scan is refused, not queued. The user must refresh explicitly.
      if (this.scanStatus === "idle") {
        this.scanStatus = "blocked";
        this.renderScanStatus();
        this.updateAvailability();
      }
      return;
    }
    const token = ++this.refreshToken;
    const cancelled = () => this.disposed || token !== this.refreshToken;
    // Supersede in-flight full-text searches immediately, not after the scan completes.
    this.searchToken++;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = null;
    this.searchReady = !this.searchText;
    this.matches = null;
    if (this.scanRevealTimer) clearTimeout(this.scanRevealTimer);
    this.scanDirty = false;
    this.scanStatus = "scanning";
    this.scanDone = 0;
    this.scanTotal = 0;
    this.scanVisible = false;
    this.renderScanStatus();
    this.updateAvailability();
    this.scanRevealTimer = setTimeout(() => {
      if (cancelled()) return;
      this.scanVisible = true;
      this.renderScanStatus();
    }, 150);
    try {
      if (force) this.repo.invalidate();
      const cards = await this.repo.scan(this.workspace, this.plugin.settings.scanBatchSize,
        (done, total) => {
          if (cancelled()) return;
          this.scanDone = done;
          this.scanTotal = total;
          if (this.scanVisible) this.renderScanStatus();
        }, cancelled);
      if (cancelled() || !cards) return;
      cards.sort((a, b) => b.ctime - a.ctime);
      this.items = cards;
      this.lastScanCount = cards.length;
      this.scanStatus = this.scanDirty ? "stale" : "done";
      this.showSuggestions();
      this.renderTagsFilter();
      // Scanning is prohibited during selection; there is no scope to reconcile.
      if (this.searchText && !this.scanDirty) this.scheduleSearch();
      else { this.searchReady = true; this.matches = null; this.drawCards(); }
      this.announceScan("摘录扫描完成，共 " + cards.length + " 条");
    } catch (error) {
      if (!cancelled()) {
        this.scanStatus = "error";
        this.announceScan("摘录扫描失败");
        // The old feed remains usable after a failed scan.
        this.searchReady = true;
        notify(error);
      }
    } finally {
      if (!cancelled()) {
        if (this.scanRevealTimer) clearTimeout(this.scanRevealTimer);
        this.scanRevealTimer = null;
        this.scanVisible = false;
        this.renderScanStatus();
        this.updateAvailability();
      }
    }
  }
  private scheduleSearch(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    const token = ++this.searchToken;
    // Search only against a committed index; keep the latest query for scan completion.
    if (!this.searchText) {
      this.searchReady = true; this.matches = null; this.drawCards();
      this.updateAvailability(); return;
    }
    if (this.scanStatus !== "done" || this.plugin.isBusy(this)) return;
    this.searchReady = false;
    this.countEl.textContent = "搜索准备中…";
    this.updateAvailability();
    this.searchTimer = setTimeout(() => void this.search(token), 350);
  }
  private async search(token: number): Promise<void> {
    try {
      const matches = await this.repo.search(this.items, this.searchText,
        () => this.disposed || token !== this.searchToken,
        done => { if (token === this.searchToken) this.countEl.textContent = "搜索中 " + done + "/" + this.items.length; });
      if (this.disposed || token !== this.searchToken) return;
      this.matches = matches;
      this.searchReady = true;
      this.pageSize = 40;
      this.drawCards();
      this.updateAvailability();
    } catch (error) {
      if (!this.disposed && token === this.searchToken) {
        this.searchReady = true;
        this.countEl.textContent = "搜索失败，请重试";
        this.updateAvailability();
        notify(error);
      }
    }
  }
  private visibleItems(): CardIndex[] {
    if (this.selectionMode !== "normal")
      return this.items.filter(item => this.selectionScope.has(item.path));
    return this.items.filter(item =>
      (!this.tagFilter || item.tags.includes(this.tagFilter)) &&
      (!this.searchText || (this.matches !== null && this.matches.has(item.path)))
    );
  }
  private renderTagsFilter(): void {
    this.tagBar.replaceChildren();
    this.tagBar.hidden = !this.filterOpen && !this.tagFilter;
    this.filterButton.setAttribute("aria-expanded", String(!this.tagBar.hidden));
    this.filterButton.disabled = !this.items.some(item => item.tags.length) && !this.tagFilter;
    if (this.tagBar.hidden) return;
    const all = button("全部", () => { if (!this.guard("filter")) return; this.tagFilter = ""; this.renderTagsFilter(); this.drawCards(); },
      this.tagFilter ? "ex-btn-quiet" : "ex-selected");
    this.tagBar.append(all);
    const tags = [...new Set(this.items.flatMap(item => item.tags))].sort((a,b) => a.localeCompare(b, "zh"));
    const limit = 8;
    for (const tag of tags.slice(0, limit)) this.tagBar.append(button("#" + tag, () => {
      if (!this.guard("filter")) return;
      this.tagFilter = this.tagFilter === tag ? "" : tag;
      this.renderTagsFilter(); this.drawCards();
    }, this.tagFilter === tag ? "ex-selected" : "ex-btn-quiet"));
    if (tags.length > limit) {
      const more = button("更多标签 · " + (tags.length-limit), () => {
        if (!this.guard("filter")) return;
        const menu = new Menu();
        for (const tag of tags.slice(limit)) menu.addItem(item => item.setTitle("#" + tag).onClick(() => {
          if (!this.guard("filter")) return;
          this.tagFilter = tag; this.renderTagsFilter(); this.drawCards();
        }));
        const rect = more.getBoundingClientRect(); menu.showAtPosition({ x: rect.left, y: rect.bottom }, more.ownerDocument);
      }, "ex-btn-quiet");
      this.tagBar.append(more);
    }
    this.updateAvailability();
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
      if (this.selectionMode !== "normal") this.updateSelectionControls();
      this.updateAvailability();
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
    if (this.selectionMode !== "normal") this.updateSelectionControls();
    this.updateAvailability();
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
    const indicator = node("span", "ex-selection-indicator");
    indicator.setAttribute("aria-hidden", "true");
    setIcon(indicator, "circle");
    actions.append(options, indicator);
    footer.append(actions);
    card.append(footer);
    this.renderTags(tags, item, this.openTagEditors.has(item.path));
    card.addEventListener("click", event => {
      if (this.selectionMode !== "selecting") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.toggleSelection(item.path);
    }, true);
    card.addEventListener("keydown", event => {
      if (this.selectionMode !== "selecting" || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.toggleSelection(item.path);
    }, true);
    this.paintCardSelection(card, item.path);
    return card;
  }
  private async showCardMenu(item: CardIndex, anchor: HTMLButtonElement): Promise<void> {
    if (!this.guard("page")) return;
    let parsed: ParsedMarkdown | null = null;
    try { parsed = await this.repo.read(item.path); } catch { /* Deletion remains available if parsing fails. */ }
    if (this.disposed || !anchor.isConnected || !this.guard("page")) return;
    const menu = new Menu();
    menu.addItem(entry => entry.setTitle("编辑原文").onClick(() => {
      if (!this.guard("page")) return;
      void this.plugin.openMarkdown(item.path).catch(notify);
    }));
    const seen = new Map<string, number>();
    for (let index = 0; index < (parsed?.sections.length ?? 0); index++) {
      const section = parsed!.sections[index];
      const count = (seen.get(section.name) ?? 0) + 1;
      seen.set(section.name, count);
      const suffix = parsed!.sections.filter(part => part.name === section.name).length > 1
        ? "（第 " + count + " 个）" : "";
      menu.addItem(entry => entry.setTitle("编辑分组：" + section.name + suffix).onClick(() => {
        if (!this.guard("page")) return;
        void this.openSection(item.path, index).catch(notify);
      }));
    }
    menu.addSeparator();
    menu.addItem(entry => {
      entry.setTitle("删除摘录").setIcon("trash-2")
        .setDisabled(Boolean(this.reason("delete")))
        .onClick(() => this.confirmSingleDelete(item.path));
      // Obsidian's warning styling exists in some releases but is not part of the public MenuItem API.
      (entry as typeof entry & { setWarning?: (warning: boolean) => void }).setWarning?.(true);
    });
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
        if (editorOpen || !this.guard("filter")) return;
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
        if (this.openTagEditors.size && !this.openTagEditors.has(item.path)) {
          new Notice("请先完成或取消当前卡片的标签编辑");
          return;
        }
        if (!this.guard("tag")) return;
        this.openTagEditors.add(item.path);
        this.updateAvailability();
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
    this.updateAvailability();
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
      ? node("div", "ex-tag-inline-hint",
          "正文标签请在 Markdown 原文中修改。先结束标签编辑，再从卡片选项进入原文。") : null;
    const commit = async () => {
      if (this.pendingTags.has(item.path) || !this.guard("tag")) return;
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
        this.markStale(item.path);
      } catch (error) {
        notify(error);
        if (editor.isConnected) {
          picker.setDisabled(false); cancel.disabled = false; done.disabled = false;
          done.textContent = "完成";
          picker.focus();
        }
      } finally {
        this.pendingTags.delete(item.path);
        this.updateAvailability();
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
