import { MarkdownRenderChild, MarkdownRenderer, Menu, Notice, TFile, setIcon } from "obsidian";
import { findSectionHeadingLine, parseMarkdown } from "./codec";
import type ExcerptsPlugin from "./main";
import { DeleteCandidate, DeleteProgress, EntryRepository } from "./repository";
import { DeleteExcerptModal, DeleteOutcome } from "./delete-modal";
import { TagPicker } from "./tag-picker";
import { CardIndex, ParsedMarkdown, Workspace, isExcerptPath } from "./model";
import { PageFilter, isFiltered } from "./page-config";
import { classifyPreview, previewAction, previewPolicy } from "./card-preview";
import { ScrollPolicy, TimelineRow, VirtualTimeline } from "./virtual-list";
import { SavePageModal } from "./page-modal";
import { ExcerptsCalendarView } from "./calendar-view";

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

type RecoveryAction = "none" | "refresh" | "clear-search" | "exit-selection";
type RecoveryInfo = {
  kind: string;
  title: string;
  description: string;
  action: RecoveryAction;
  actionLabel?: string;
};

/** Unsaved text survives view teardown within the current plugin session. */
const composerDrafts = new Map<string, { text: string; tags: string[] }>();

/** Obsidian Markdown excerpt homepage. */
export class ExcerptsRenderChild extends MarkdownRenderChild {
  private items: CardIndex[] = [];
  private pageMode: "feed" | "calendar" = "feed";
  private calendarView: ExcerptsCalendarView | null = null;
  private feedEl!: HTMLElement;
  private pageMenuButton!: HTMLButtonElement;
  private feedScrollTop = 0;
  private feedRenderPending = false;
  private feedPendingPolicy: ScrollPolicy = "keep";
  private listEl!: HTMLElement;
  private countEl!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private searchClearButton!: HTMLButtonElement;
  private searchButton!: HTMLButtonElement;
  private searchWrap!: HTMLElement;
  private tagBar!: HTMLElement;
  private filterButton!: HTMLButtonElement;
  private searchText = "";
  private tagFilter = "";
  private filterOpen = false;
  private matches: Set<string> | null = null;
  private searchToken = 0;
  private searchScrollPolicy: ScrollPolicy = "results";
  private scanStatus: "idle" | "blocked" | "scanning" | "done" | "stale" | "error" = "idle";
  private scanDirty = false;
  private homeInvalid = false;
  private homeInvalidCause: "path" | "configuration" = "path";
  private scanDone = 0;
  private scanTotal = 0;
  private lastScanCount: number | null = null;
  /** Display-only; the index remains ready after the completion feedback hides. */
  private completionVisible = false;
  private scanCompletionTimer: ReturnType<typeof setTimeout> | null = null;
  private scanStatusEl!: HTMLElement;
  private pageHintEl!: HTMLElement;
  private recoveryTitleEl!: HTMLElement;
  private recoveryDescriptionEl!: HTMLElement;
  private recoveryIconEl!: HTMLElement;
  private recoveryActionButton!: HTMLButtonElement;
  private scanTextEl!: HTMLElement;
  private scanIconEl!: HTMLElement;
  private scanProgressEl!: HTMLElement;
  private scanFillEl!: HTMLElement;
  private scanAnnouncementEl!: HTMLElement;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshToken = 0;
  private saveBusy = false;
  /** Scoped identities for this view's own creates; never suppress external modifies. */
  private localCreates = new Map<string, {
    file: TFile | null; tags: string[]; ignoredEvent: boolean;
  }>();
  private updateComposerControls: () => void = () => {};
  private renderToken = 0;
  private timeline: VirtualTimeline | null = null;
  private itemByPath = new Map<string, CardIndex>();
  private availableTags: string[] = [];
  private observer: IntersectionObserver | null = null;
  private mediaObserver: IntersectionObserver | null = null;
  private queue: Array<{ path: string; task: () => Promise<void> }> = [];
  private reading = 0;
  private markdownChildren = new Map<string, Array<{ mount: HTMLElement; child: MarkdownRenderChild }>>();
  private previewObservers = new Map<string, ResizeObserver>();
  private previewUpdates = new Map<string, () => void>();
  private sectionHeightChecks = new Map<string, Map<number, () => void>>();
  private sectionObservers = new Map<string, Map<number, ResizeObserver>>();
  private lastAverageHeight = 0;
  private lastBatchViewportHeight = 0;
  private adaptiveBatch = 40;
  private sectionsShown = new Map<string, Set<number>>();
  private expandedBodies = new Set<string>();
  private expandedTagRows = new Set<string>();
  private tagResizeObserver: ResizeObserver | null = null;
  private typographySignature = "";
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
    this.typographySignature = this.readTypographySignature();
    const viewport = this.containerEl.closest<HTMLElement>(".excerpts-native-host");
    if (!viewport) throw new Error("缺少摘录页面滚动容器");
    this.timeline = new VirtualTimeline(this.listEl, viewport, {
      batchSize: () => this.listBatchSize(viewport),
      mount: (row, index) => this.mountTimelineRow(row, index),
      unmount: (row, element) => this.unmountTimelineRow(row, element),
      update: (row, index, element, previous) => this.updateTimelineRow(row, index, element, previous),
      resultsTop: () => this.resultHeaderScrollTop(),
      pinnedPath: () => this.openTagEditors.values().next().value ?? null,
      onScrollBlocked: () => new Notice("请先完成或取消当前标签编辑，再继续滚动"),
      resizeRows: () => this.timelineRows(this.visibleItems())
    });
    // CSS changes can alter chip widths. Invalidate measured row heights only
    // when computed typography changes; color-only themes keep their cache.
    this.registerEvent(this.plugin.app.workspace.on("css-change", () => {
      if (this.disposed || this.pageMode !== "feed") return;
      this.checkTypographyChange();
      this.reflowVisibleTags();
      this.scheduleActiveFilterVisibility();
    }));
    if (typeof ResizeObserver !== "undefined") {
      this.tagResizeObserver = new ResizeObserver(() => {
        if (this.pageMode === "calendar") {
          this.calendarView?.onShown(); // Move date detail when a responsive breakpoint changes.
          return; // Hidden feed geometry is not measurable.
        }
        this.reflowVisibleTags();
        this.scheduleActiveFilterVisibility();
        this.reflowCaptureTags();
        for (const update of this.previewUpdates.values()) update();
        for (const group of this.sectionHeightChecks.values()) {
          for (const check of group.values()) check();
        }
        this.timeline?.resize();
      });
      this.tagResizeObserver.observe(viewport);
    }
    void this.reload();
  }
  onunload(): void {
    this.disposed = true;
    this.refreshToken++; this.renderToken++; this.searchToken++;
    this.clearScanCompletion();
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.observer?.disconnect();
    this.mediaObserver?.disconnect();
    this.tagResizeObserver?.disconnect();
    this.calendarView = null;
    this.timeline?.dispose();
    this.timeline = null;
    this.localCreates.clear();
    this.selectedPaths.clear(); this.selectedCandidates.clear(); this.selectionScope.clear();
    this.unmountMarkdown();
    this.plugin.notifyActivityChange(this);
    this.queue = [];
  }
  /** Conflicting operations are refused, never queued or replayed. */
  isInvalid(): boolean { return this.homeInvalid || this.disposed; }
  isBusy(): boolean {
    // Scanning is owned by the plugin-level mutex, not inferred from view state.
    return !this.searchReady || this.saveBusy || this.deleteBusy ||
      this.selectionMode !== "normal" || this.openTagEditors.size > 0 ||
      this.pendingTags.size > 0;
  }
  private reason(action: "save" | "refresh" | "search" | "filter" | "tag" | "select" | "delete" | "page"): string | null {
    if (this.disposed) return "页面已关闭";
    if (this.homeInvalid) return this.homeInvalidCause === "configuration"
      ? "摘录页配置已变化，请从文件列表重新打开"
      : this.workspace.kind === "folder"
        ? "文件夹位置已变化，请从文件夹右键菜单重新打开摘录"
        : "摘录页位置已变化，请从文件列表重新打开";
    if (this.plugin.isBusy(this)) return "另一个摘录页面正在操作，请完成后再试";
    if (this.plugin.isNavigating()) return "正在打开摘录页，请完成后再操作";
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

  /** Purely derived feedback: no second mutable operation state. */
  private getRecoveryInfo(): RecoveryInfo | null {
    const info = (kind: string, title: string, description: string,
      action: RecoveryAction = "none", actionLabel?: string): RecoveryInfo =>
      ({ kind, title, description, action, actionLabel });
    if (this.homeInvalid) return info("invalid", "当前摘录页已失效",
      this.homeInvalidCause === "configuration"
        ? "筛选配置已变化。如有未保存的草稿，请先复制，再从文件列表重新打开。"
        : this.workspace.kind === "folder"
          ? "文件夹位置已变化。如有未保存的草稿，请先复制，再从文件夹右键菜单重新打开。"
          : "页面位置已变化。如有未保存的草稿，请先复制，再从文件列表重新打开。");
    if (this.deleteBusy) return null; // Delete modal already owns progress.
    if (this.saveBusy) return null; // Composer already shows save progress.
    if (this.pendingTags.size) return null; // Tag editor shows its pending write.
    if (this.selectionBusy) return null; // Selection toolbar already shows progress.
    if (this.selectionMode === "deleting") return null;
    if (this.selectionMode === "selecting" && this.scanStatus !== "done")
      return info("selection-stale", "当前选择已过期",
        "摘录列表已变化。请退出批量选择，再刷新索引。", "exit-selection", "退出选择");
    if (this.openTagEditors.size && this.scanStatus !== "done")
      return null; // The active tag editor owns the explanation and cancel action.
    if (this.selectionMode === "selecting") return null; // Normal selection is not an exception.
    if (this.openTagEditors.size) return null; // The inline editor already has exit controls.
    if (this.scanStatus === "scanning") return null; // Existing progress is sufficient.
    if (this.plugin.isNavigating()) return info("navigating", "正在打开摘录页", "请等待页面打开完成。");
    if (this.plugin.isBusy(this)) return info("other-busy", "另一个摘录页正在操作",
      this.scanStatus === "done"
        ? "本页索引仍可使用。请等待其他页面的操作完成后继续，无需额外刷新。"
        : this.scanStatus === "blocked"
          ? "请等待其他摘录页完成操作，再手动刷新本页索引；不会自动重试。"
          : "请等待其他摘录页完成操作，再按照本页提示恢复索引；不会自动重试。");
    if (!this.searchReady) return null; // Search count already displays progress.
    if ((this.scanStatus === "stale" || this.scanStatus === "error") &&
      this.searchText && this.reason("refresh") !== null)
      return info("search-stale", "请先清除搜索条件",
        "清除搜索后才能刷新索引，当前标签筛选不会改变。", "clear-search", "清除搜索");
    if (this.scanStatus === "blocked") return info("blocked", "尚未扫描摘录",
      "本页尚无索引，请手动刷新。", "refresh", "刷新摘录");
    if (this.scanStatus === "stale") return info("stale", "摘录内容已变化",
      "刷新索引后可继续筛选和编辑标签。", "refresh", "刷新摘录");
    if (this.scanStatus === "error") return info("error", "摘录扫描失败",
      "请重新扫描；失败时不会覆盖已有内容。", "refresh", "重试扫描");
    return null;
  }
  private canCancelTagEdit(path: string): boolean {
    return !this.disposed && this.openTagEditors.has(path) && !this.pendingTags.has(path);
  }
  private clearSearchForRecovery(): boolean {
    if (!this.searchText) return false;
    const blocked = this.reason("search");
    if (blocked && !this.canClearSearch()) { new Notice(blocked); return false; }
    // Preserve the visible excerpt, not a numeric scroll offset. Expanding
    // search results can insert many rows above it, while the recovery message
    // and first-of-day rail can independently change the card's visual inset.
    const viewport = this.containerEl.closest<HTMLElement>(".excerpts-native-host");
    const rect = viewport?.getBoundingClientRect();
    const visibleCard = rect && Array.from(this.listEl.querySelectorAll<HTMLElement>(".ex-card"))
      .find(card => {
        const box = card.getBoundingClientRect();
        return box.width > 0 && box.bottom > rect.top + 25 &&
          box.top < rect.bottom - 25;
      });
    const anchorPath = visibleCard?.dataset.path;
    const anchorTop = visibleCard?.getBoundingClientRect().top;
    this.searchText = "";
    this.searchInput.value = "";
    this.scheduleSearch("anchor");
    this.updateAvailability();
    if (viewport && anchorPath && anchorTop !== undefined) {
      const next = Array.from(this.listEl.querySelectorAll<HTMLElement>(".ex-card"))
        .find(card => card.dataset.path === anchorPath);
      if (next) viewport.scrollTop += next.getBoundingClientRect().top - anchorTop;
    }
    return true;
  }
  private renderRecoveryHint(): void {
    if (!this.pageHintEl) return;
    const info = this.getRecoveryInfo();
    if (!info) {
      if (!this.pageHintEl.hidden) this.pageHintEl.hidden = true;
      if (this.pageHintEl.hasAttribute("data-state")) this.pageHintEl.removeAttribute("data-state");
      return;
    }
    if (this.pageHintEl.hidden) this.pageHintEl.hidden = false;
    if (this.pageHintEl.dataset.state !== info.kind) this.pageHintEl.dataset.state = info.kind;
    if (this.recoveryTitleEl.textContent !== info.title) this.recoveryTitleEl.textContent = info.title;
    if (this.recoveryDescriptionEl.textContent !== info.description)
      this.recoveryDescriptionEl.textContent = info.description;
    const icon = info.kind === "error" || info.kind === "invalid"
      ? "alert-circle" : info.kind === "stale" || info.kind === "search-stale"
        ? "refresh-cw" : "info";
    if (this.recoveryIconEl.dataset.recoveryIcon !== icon) {
      setIcon(this.recoveryIconEl, icon);
      this.recoveryIconEl.dataset.recoveryIcon = icon;
    }
    const actionable = info.action !== "none" &&
      (info.action !== "refresh" || this.reason("refresh") === null) &&
      (info.action !== "clear-search" || this.canClearSearch()) &&
      (info.action !== "exit-selection" ||
        (this.selectionMode === "selecting" && !this.selectionBusy));
    if (this.recoveryActionButton.hidden !== !actionable) this.recoveryActionButton.hidden = !actionable;
    if (actionable) {
      const label = info.actionLabel ?? "";
      if (this.recoveryActionButton.textContent !== label) this.recoveryActionButton.textContent = label;
      if (this.recoveryActionButton.disabled) this.recoveryActionButton.disabled = false;
    }
  }
  private runRecoveryAction(expected?: RecoveryAction): void {
    const info = this.getRecoveryInfo(); // Recheck on every click.
    if (!info || (expected && info.action !== expected)) {
      if (expected) new Notice(this.reason(expected === "clear-search" ? "search" : "refresh") ??
        "摘录状态已变化，请重新打开菜单");
      return;
    }
    if (info.action === "refresh") this.requestRefresh(true);
    else if (info.action === "clear-search") this.clearSearchForRecovery();
    else if (info.action === "exit-selection" &&
      this.selectionMode === "selecting" && !this.selectionBusy) this.exitSelectionMode();
    this.renderRecoveryHint();
  }
  private guard(action: Parameters<ExcerptsRenderChild["reason"]>[0]): boolean {
    const blocked = this.reason(action);
    if (blocked) { new Notice(blocked); return false; }
    return true;
  }
  syncControls(): void { this.updateAvailability(false); }
  /** Clear is the only search action permitted while search results are pending or stale. */
  /** Closing an empty search box changes no query or index state. */
  private canCloseEmptySearch(): boolean {
    return !this.disposed && !this.homeInvalid &&
      !this.searchWrap.hidden && !this.searchText;
  }
  /**
   * Search typing is not an indexed file operation. An in-flight search must not
   * disable its own input; all destructive and cross-page operation locks remain.
   */
  private searchQueryBlockReason(): string | null {
    if (this.disposed) return "页面已关闭";
    if (this.homeInvalid) return "摘录页已失效，请重新打开";
    if (this.plugin.isBusy(this)) return "另一个摘录页面正在操作，请完成后再试";
    if (this.plugin.isNavigating()) return "正在打开摘录页，请完成后再操作";
    if (this.scanStatus === "scanning") return "正在扫描，请完成后再操作";
    if (this.saveBusy) return "正在保存，请完成后再操作";
    if (this.deleteBusy) return "正在删除，请完成后再操作";
    if (this.selectionMode !== "normal" || this.selectionBusy) return "请先退出批量选择";
    if (this.pendingTags.size || this.openTagEditors.size) return "请先完成或取消标签编辑";
    if (this.scanStatus !== "done") return "摘录索引需要刷新，请先手动刷新";
    return null;
  }
  private canClearSearch(): boolean {
    return Boolean(this.searchText) &&
      (!this.searchReady || this.scanStatus === "stale" || this.scanStatus === "error") &&
      !this.disposed && !this.homeInvalid && this.scanStatus !== "scanning" &&
      !this.plugin.isBusy(this) && !this.plugin.isNavigating() && !this.saveBusy && !this.deleteBusy &&
      this.selectionMode === "normal" && !this.pendingTags.size && !this.openTagEditors.size;
  }
  private updateAvailability(broadcast = true): void {
    if (this.disposed || !this.searchButton) return;
    const searching = !this.searchReady;
    const searchBlock = this.searchQueryBlockReason();
    this.searchInput.disabled = Boolean(searchBlock);
    const canClear = this.canClearSearch();
    this.searchClearButton.disabled = Boolean(searchBlock) && !canClear;
    const canCloseEmpty = this.canCloseEmptySearch();
    this.searchButton.disabled = !canClear && !canCloseEmpty && Boolean(this.reason("search"));
    this.searchButton.title = canCloseEmpty ? "关闭搜索" :
      canClear ? "清除搜索条件" : (this.reason("search") ?? "搜索");
    this.filterButton.disabled = Boolean(this.reason("filter"));
    this.updateComposerControls();
    for (const button of Array.from(this.containerEl.querySelectorAll<HTMLButtonElement>(".ex-filter-tags button")))
      button.disabled = Boolean(this.reason("filter"));
    for (const el of Array.from(this.containerEl.querySelectorAll<HTMLButtonElement>(
      ".ex-card .ex-card-options, .ex-card .ex-add-tag, .ex-card .ex-tag"))) {
      const pageBlock = this.reason("page");
      if (el.classList.contains("ex-card-options")) {
        const safeExplanation = this.selectionMode === "normal" &&
          !this.homeInvalid && !this.saveBusy && !this.deleteBusy &&
          !this.pendingTags.size && !this.openTagEditors.size;
        el.disabled = !safeExplanation && Boolean(pageBlock);
        if (safeExplanation && pageBlock) {
          // This button still performs a real action: it explains the refusal.
          // Do not announce it as disabled to assistive technology.
          el.dataset.exReasonOnly = "true";
          el.removeAttribute("aria-haspopup");
          const label = "查看操作受限原因：" + pageBlock;
          if (el.getAttribute("aria-label") !== label) el.setAttribute("aria-label", label);
          if (el.title !== pageBlock) el.title = pageBlock;
        } else {
          delete el.dataset.exReasonOnly;
          if (el.getAttribute("aria-haspopup") !== "menu") el.setAttribute("aria-haspopup", "menu");
          if (el.getAttribute("aria-label") !== "卡片选项")
            el.setAttribute("aria-label", "卡片选项");
          const label = pageBlock ?? "卡片选项";
          if (el.title !== label) el.title = label;
        }
        continue;
      }
      const isTagFilter = el.classList.contains("ex-tag");
      const otherTagEditor = el.classList.contains("ex-add-tag") &&
        this.openTagEditors.size > 0 && !this.openTagEditors.has(el.closest<HTMLElement>(".ex-card")?.dataset.path ?? "");
      const path = el.closest<HTMLElement>(".ex-card")?.dataset.path ?? "";
      el.disabled = el.classList.contains("ex-add-tag") && this.openTagEditors.has(path)
        ? !this.canCancelTagEdit(path)
        : otherTagEditor || Boolean(this.reason(isTagFilter ? "filter" :
          el.classList.contains("ex-add-tag") ? "tag" : "page"));
    }
    for (const editor of Array.from(this.containerEl.querySelectorAll<HTMLElement>(".ex-tag-editor:not([hidden])"))) {
      const path = editor.closest<HTMLElement>(".ex-card")?.dataset.path ?? "";
      const pending = this.pendingTags.has(path);
      const done = editor.querySelector<HTMLButtonElement>(".ex-tag-done");
      const cancel = editor.querySelector<HTMLButtonElement>(".ex-tag-cancel");
      if (done) done.disabled = pending || Boolean(this.reason("tag")) || this.scanStatus !== "done";
      if (cancel) cancel.disabled = !this.canCancelTagEdit(path);
      const warning = editor.querySelector<HTMLElement>(".ex-tag-edit-warning");
      if (warning) {
        const blocked = this.reason("tag");
        const explanation = this.scanStatus !== "done"
          ? "摘录内容已变化，请取消标签编辑后刷新。"
          : (blocked ?? "");
        if (warning.hidden !== !explanation) warning.hidden = !explanation;
        if (warning.textContent !== explanation) warning.textContent = explanation;
      }
    }
    this.renderRecoveryHint();
    if (broadcast) this.plugin.notifyActivityChange(this);
  }
  /** Register the exact path before vault.create can emit a create event. */
  private beginLocalCreate(path: string, tags: string[]): (file?: TFile) => void {
    const record = { file: null as TFile | null, tags, ignoredEvent: false };
    this.localCreates.set(path, record);
    return file => {
      if (this.localCreates.get(path) !== record) return;
      if (!file) {
        this.localCreates.delete(path);
        // If another writer created the same candidate path, its event was
        // provisionally ignored; retain the external-change indication.
        if (record.ignoredEvent) this.markStale(path);
        return;
      }
      record.file = file;
      // Bounded event provenance. Eviction is fail-closed: old events mark stale.
      while (this.localCreates.size > 128) {
        const oldest = this.localCreates.keys().next().value;
        if (oldest === undefined) break;
        this.localCreates.delete(oldest);
      }
    };
  }
  /** Commit only this file to an existing index; no vault-wide scan or queue. */
  private commitCreatedFile(file: TFile, markdown: string, tags: string[]): void {
    if (this.disposed || this.homeInvalid || !isExcerptPath(file.path, this.workspace)) return;
    const card = this.repo.indexCreatedFile(file, tags);
    const priorIndex = this.items.findIndex(item => item.path === card.path);
    if (priorIndex !== -1) this.items.splice(priorIndex, 1);
    const insertion = this.items.findIndex(item => item.ctime < card.ctime);
    this.items.splice(insertion === -1 ? this.items.length : insertion, 0, card);
    this.itemByPath.set(card.path, card);
    this.lastScanCount = this.items.length;
    if (this.searchText && this.matches !== null) {
      const query = this.searchText.trim().toLocaleLowerCase();
      const parsed = parseMarkdown(markdown);
      const body = [parsed.title, parsed.body,
        ...parsed.sections.map(section => section.name + "\n" + section.markdown)]
        .join("\n").toLocaleLowerCase();
      if (card.basename.toLocaleLowerCase().includes(query) ||
          card.tags.some(tag => tag.toLocaleLowerCase().includes(query)) ||
          body.includes(query)) this.matches.add(card.path);
      else this.matches.delete(card.path);
    }
    this.rebuildAvailableTags();
    this.showSuggestions();
    this.renderTagsFilter();
    this.renderScanStatus();
    if (this.pageMode === "calendar") this.calendarView?.update(this.items, this.calendarStatus());
    const viewport = this.containerEl.closest<HTMLElement>(".excerpts-native-host");
    this.drawCards((this.pageMode === "calendar" ? this.feedScrollTop : (viewport?.scrollTop ?? 0)) > 48 ? "anchor" : "keep");
  }
  /** Metadata follows a successful create asynchronously; update only that card. */
  private syncCreatedMetadata(file: TFile, tags: string[]): void {
    const index = this.items.findIndex(item => item.path === file.path);
    if (index === -1 || this.scanStatus === "scanning") return;
    const next = this.repo.indexCreatedFile(file, tags);
    const old = this.items[index];
    if (old.mtime === next.mtime && old.size === next.size &&
        old.tags.join("\u001f") === next.tags.join("\u001f") &&
        old.inlineTags.join("\u001f") === next.inlineTags.join("\u001f") &&
        old.frontmatterTags.join("\u001f") === next.frontmatterTags.join("\u001f")) return;
    this.items[index] = next;
    this.itemByPath.set(file.path, next);
    if (this.searchText && this.matches && next.tags.some(tag =>
      tag.toLocaleLowerCase().includes(this.searchText.toLocaleLowerCase())))
      this.matches.add(file.path);
    this.rebuildAvailableTags();
    this.showSuggestions();
    this.renderTagsFilter();
    if (this.pageMode === "calendar") this.calendarView?.update(this.items, this.calendarStatus());
    this.drawCards("anchor");
  }
  /** Mark cached results obsolete without scheduling any scan. */
  markStale(path?: string, event: "create" | "metadata" | "other" = "other", file?: TFile): void {
    if (this.disposed || this.homeInvalid || (path && path !== this.workspace.homePath &&
        !isExcerptPath(path, this.workspace))) return;
    if (path && (event === "create" || event === "metadata")) {
      const own = this.localCreates.get(path);
      if (own && (own.file === null || own.file === file)) {
        if (!own.file) own.ignoredEvent = true;
        if (event === "metadata" && own.file) {
          if (this.plugin.app.vault.getAbstractFileByPath(path) !== own.file) {
            this.markStale(path);
          } else {
            try { this.syncCreatedMetadata(own.file, own.tags); }
            catch (error) {
              this.markStale(path);
              console.error("Excerpts: single-file metadata update failed", error);
            }
          }
        }
        return;
      }
    }
    const staleSelection = this.scanStatus === "done" && this.selectionMode === "selecting";
    if (this.scanStatus === "done") this.clearScanCompletion();
    if (this.scanStatus === "scanning") this.scanDirty = true;
    // A page without a committed index remains unscanned, even when Vault files change.
    else if (this.scanStatus !== "blocked" && this.scanStatus !== "idle") this.scanStatus = "stale";
    if (!this.searchReady) {
      this.searchToken++;
      if (this.searchTimer) clearTimeout(this.searchTimer);
      this.searchTimer = null;
      this.searchReady = true;
      this.matches = null;
      if (this.listEl) this.drawCards("keep");
    }
    this.renderScanStatus();
    if (this.selectionMode !== "normal") this.updateSelectionControls();
    this.updateAvailability();
    if (staleSelection) new Notice("摘录内容已变化，请退出批量选择后刷新");
  }
  requestRefresh(force = false): void {
    if (this.pageMode === "calendar") { new Notice("请返回摘录列表后刷新"); return; }
    if (!this.guard("refresh")) return;
    this.workspace.recursive = this.plugin.settings.recursive;
    void this.reload(force);
  }
  /** A changed or relocated .excerpts page cannot safely continue using its old configuration. */
  invalidateHome(cause: "path" | "configuration" = "path"): void {
    if (this.disposed || this.homeInvalid) return;
    this.homeInvalid = true;
    this.homeInvalidCause = cause;
    if (this.pageMode === "calendar") this.showFeed(false);
    this.refreshToken++; this.searchToken++;
    this.clearScanCompletion();
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = null;
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
      : this.workspace.kind === "folder"
        ? "文件夹位置已变化，请从文件夹右键菜单重新打开摘录"
        : "摘录页位置已变化，请从文件列表重新打开";
    this.announceScan(message);
    this.updateAvailability();
    new Notice(message);
  }
  private clearScanCompletion(): void {
    if (this.scanCompletionTimer !== null) clearTimeout(this.scanCompletionTimer);
    this.scanCompletionTimer = null;
    this.completionVisible = false;
  }
  private renderScanStatus(): void {
    const status = this.homeInvalid ? "invalid" : this.scanStatus;
    this.scanStatusEl.hidden = status === "idle" || (status === "done" && !this.completionVisible);
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
    this.calendarView?.setStatus(this.calendarStatus());
    this.scanTextEl.textContent = labels[status];
    const hint = this.homeInvalid
      ? this.homeInvalidCause === "configuration"
        ? "筛选配置已变化，当前页面无法继续操作。如有未保存的草稿，请先复制，再从文件列表重新打开摘录页。"
        : this.workspace.kind === "folder"
          ? "文件夹摘录视图已失效。如有未保存的草稿，请先复制，再从文件夹右键菜单重新打开摘录。"
          : "当前页面已失效。如有未保存的草稿，请先复制，再从文件列表重新打开摘录页。"
      : this.scanStatus === "blocked"
        ? "因其他摘录页正在操作，本页未扫描。待操作结束后，请从页面选项手动刷新。"
        : "";
    this.scanStatusEl.title = hint;
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
    this.renderRecoveryHint();
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
    const fileName = this.workspace.homePath.split("/").pop()?.replace(/\.excerpts$/i, "") || "摘录";
    header.firstElementChild!.append(node("h2", "ex-title",
      this.workspace.kind === "folder" || this.savedFilter ? fileName : "摘录"));
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
    this.scanStatusEl.append(scanLine, this.scanProgressEl);
    // Screen-reader announcements remain available after the visual status hides.
    header.append(this.scanStatusEl, this.scanAnnouncementEl);
    this.pageHintEl = node("section", "ex-page-hint");
    this.pageHintEl.hidden = true;
    this.pageHintEl.setAttribute("aria-label", "摘录操作提示");
    const recoveryBody = node("div", "ex-recovery-content");
    this.recoveryIconEl = node("span", "ex-recovery-icon");
    const recoveryCopy = node("div", "ex-recovery-copy");
    this.recoveryTitleEl = node("strong", "ex-recovery-title");
    this.recoveryDescriptionEl = node("p", "ex-recovery-description");
    this.recoveryDescriptionEl.setAttribute("role", "status");
    this.recoveryDescriptionEl.setAttribute("aria-live", "polite");
    recoveryCopy.append(this.recoveryTitleEl, this.recoveryDescriptionEl);
    recoveryBody.append(this.recoveryIconEl, recoveryCopy);
    this.recoveryActionButton = button("", () => this.runRecoveryAction(), "ex-recovery-action");
    this.recoveryActionButton.hidden = true;
    this.pageHintEl.append(recoveryBody, this.recoveryActionButton);
    root.append(header, this.pageHintEl);
    this.renderScanStatus();

    // The outer composer is the only rounded surface; textarea has no native chrome.
    const form = node("section", "ex-composer");
    form.setAttribute("aria-label", "快速摘录");
    const body = node("div", "ex-compose-body");
    const quote = node("textarea", "ex-compose-text");
    quote.placeholder = "摘录文字，或写下想法…";
    quote.rows = 3;
    const draftKey = this.workspace.kind + ":" + this.workspace.homePath;
    const priorDraft = composerDrafts.get(draftKey);
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
        composerDrafts.set(draftKey, { text: quote.value, tags: [...selectedTags] });
      else composerDrafts.delete(draftKey);
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
    const updateTagToggle = () => {
      const expanded = !tagsPane.hidden;
      const label = expanded ? "关闭标签选择" : "添加标签";
      tagToggle.replaceChildren();
      const icon = node("span", "ex-capture-toggle-icon");
      setIcon(icon, expanded ? "x" : selectedTags.size ? "plus" : "hash");
      tagToggle.append(icon);
      if (expanded || !selectedTags.size)
        tagToggle.append(node("span", "ex-capture-toggle-text", expanded ? "关闭" : "标签"));
      tagToggle.setAttribute("aria-label", label);
      tagToggle.setAttribute("aria-expanded", String(expanded));
      tagToggle.title = label;
    };
    const reflowTags = () => {
      if (typeof requestAnimationFrame === "function")
        requestAnimationFrame(this.reflowCaptureTags);
      else setTimeout(this.reflowCaptureTags, 0);
    };
    const openTagPanel = () => {
      if (saving) return;
      tagsPane.hidden = false;
      updateTagToggle();
      reflowTags();
      picker.focus();
    };
    const closeTagPanel = (restoreFocus: boolean) => {
      tagsPane.hidden = true;
      updateTagToggle();
      reflowTags();
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
      reflowTags();
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
      const canonical = [...this.availableTags, ...selectedTags]
        .find(t => t.toLocaleLowerCase() === value.toLocaleLowerCase()) ?? value;
      if (add) selectedTags.add(canonical);
      else selectedTags.delete(canonical);
      repaintSelected();
      persistDraft();
      retryOpenTarget = null;
      this.showSuggestions();
    };
    options.append(tagToggle, selectedChips);
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
      available: () => this.availableTags,
      selected: () => selectedTags,
      onToggle: toggleTag,
      onEscape: () => closeTagPanel(true)
    }, "ex-tags-input");
    const tagSearch = picker.input;
    tagsPane.append(picker.element);
    body.append(quote);
    form.append(body, composeActions, tagsPane);
    root.append(form);
    let saving = false;
    let resume = false;
    let retryOpenTarget: { path: string; file: TFile } | null = null;
    quote.addEventListener("input", () => { retryOpenTarget = null; });
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
      const savedTags = [...selectedTags];
      try {
        let file: TFile;
        if (openEditor && retryOpenTarget) {
          const pending = retryOpenTarget;
          try {
            file = this.repo.assertScopedFile(this.workspace, pending.path, pending.file);
          } catch {
            retryOpenTarget = null;
            throw new Error("原 Markdown 文件已移动或替换，已取消重试。请从文件列表检查原文件");
          }
        } else {
          file = await this.repo.create(this.workspace, markdown, savedTags,
            path => this.beginLocalCreate(path, savedTags));
          created = true;
          if (openEditor) retryOpenTarget = { path: file.path, file };
        }

        // Once the file exists, the draft is saved even if opening the native tab fails.
        if (created) {
          quote.value = ""; tagSearch.value = ""; selectedTags.clear();
          picker.refresh(); repaintSelected(); persistDraft();
          closeTagPanel(false); fit(); form.classList.remove("ex-is-composing");
          try {
            if (markdown) this.commitCreatedFile(file, markdown, savedTags);
          } catch (error) {
            // The Markdown file exists: never report a failed save or recreate it.
            this.markStale(file.path);
            new Notice("摘录已保存，但列表更新失败。请手动刷新");
            console.error("Excerpts: incremental list update failed", error);
          }
        }
        if (openEditor) {
          const initialRaw = await this.repo.readRaw(file.path);
          await this.plugin.openMarkdown(file.path, undefined, true,
            { workspace: this.workspace, file });
          this.plugin.trackNewEditor(file, initialRaw);
          retryOpenTarget = null;
        } else if (resume) quote.focus();
      } catch (error) {
        notify(error);
        if (openEditor && retryOpenTarget)
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
    // A native search input with one accessible clear action. The trailing
    // control sits in reserved input padding, never above entered text.
    this.searchClearButton = iconButton("x", "清空搜索", () => {
      if (this.clearSearchForRecovery()) this.searchInput.focus();
    }, "ex-search-clear");
    this.searchWrap.append(this.searchInput, this.searchClearButton);
    const searchButton = iconButton("search", "搜索", () => {
      if (this.canCloseEmptySearch()) {
        this.searchWrap.hidden = true;
        searchButton.setAttribute("aria-expanded", "false");
        this.updateAvailability();
        return;
      }
      if (this.canClearSearch()) {
        if (this.clearSearchForRecovery()) {
          this.searchWrap.hidden = true;
          searchButton.setAttribute("aria-expanded", "false");
        }
        return;
      }
      if (!this.guard("search")) return;
      this.searchWrap.hidden = !this.searchWrap.hidden;
      searchButton.setAttribute("aria-expanded", String(!this.searchWrap.hidden));
      if (!this.searchWrap.hidden) this.searchInput.focus();
      else if (this.searchText) this.clearSearchForRecovery();
    });
    this.searchButton = searchButton;
    searchButton.setAttribute("aria-expanded", String(!this.searchWrap.hidden));
    this.searchInput.addEventListener("input", () => {
      const blocked = this.searchQueryBlockReason();
      if (blocked) {
        this.searchInput.value = this.searchText;
        new Notice(blocked);
        return;
      }
      this.searchText = this.searchInput.value.trim();
      this.scheduleSearch();
    });
    this.searchInput.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (this.canCloseEmptySearch()) {
        this.searchWrap.hidden = true;
        searchButton.setAttribute("aria-expanded", "false");
        this.updateAvailability();
        searchButton.focus();
        return;
      }
      if (!this.canClearSearch()) {
        const blocked = this.searchQueryBlockReason();
        if (blocked) { new Notice(blocked); return; }
      }
      if (this.clearSearchForRecovery()) {
        this.searchWrap.hidden = true; searchButton.setAttribute("aria-expanded", "false");
        searchButton.focus();
      }
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
    this.pageMenuButton = pageMenuButton;
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
      if (event.key === "Escape" && this.pageMode === "calendar") {
        event.preventDefault();
        this.showFeed();
        return;
      }
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
    // Preserve the entire list DOM and Markdown renderer children during calendar navigation.
    this.feedEl = node("div", "ex-feed-view");
    this.feedEl.append(...Array.from(root.childNodes));
    root.append(this.feedEl);
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
    this.tagFilter = filter.tag;
    this.searchText = filter.query;
    this.filterOpen = Boolean(filter.tag);
    this.searchInput.value = filter.query;
    this.searchWrap.hidden = !filter.query;
    this.searchButton.setAttribute("aria-expanded", String(Boolean(filter.query)));
    this.renderTagsFilter();
    if (filter.query) this.scheduleSearch();
    else { this.drawCards("results"); this.updateAvailability(); }
  }
  private showPageMenu(buttonEl: HTMLButtonElement): void {
    const current = this.currentFilter();
    const changed = this.isPageDirty();
    const menu = new Menu();
    menu.addItem(item => item.setTitle("刷新摘录").setIcon("refresh-cw")
      .setDisabled(Boolean(this.reason("refresh")))
      .onClick(() => this.requestRefresh(true)));
    if (this.searchText && this.reason("refresh")?.includes("清除搜索条件")) {
      menu.addItem(item => item.setTitle("清除搜索").setIcon("search-x")
        .setDisabled(Boolean(this.reason("search")) && !this.canClearSearch())
        .onClick(() => this.clearSearchForRecovery()));
    }
    menu.addItem(item => item.setTitle("摘录日历").setIcon("calendar-days")
      .setDisabled(!this.canOpenCalendar())
      .onClick(() => this.openCalendar()));
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
  private calendarStatus(): "done" | "stale" | "error" {
    return this.scanStatus === "error" ? "error" :
      this.scanStatus === "done" ? "done" : "stale";
  }
  private canOpenCalendar(): boolean {
    return !this.disposed && !this.homeInvalid && this.lastScanCount !== null &&
      ["done", "stale", "error"].includes(this.scanStatus) && !this.reason("page");
  }
  private openCalendar(): void {
    if (!this.canOpenCalendar()) {
      new Notice(this.reason("page") ?? "摘录索引尚未准备好，请完成扫描后再打开日历");
      return;
    }
    if (this.pageMode === "calendar") return;
    const viewport = this.containerEl.closest<HTMLElement>(".excerpts-native-host");
    if (!viewport) return;
    this.feedScrollTop = viewport.scrollTop;
    // A hidden feed must not continue playback, even though its DOM stays mounted.
    for (const media of Array.from(this.feedEl.querySelectorAll<HTMLMediaElement>("audio,video"))) {
      try { media.pause(); } catch { /* Unavailable media controls are harmless. */ }
    }
    if (!this.calendarView) this.calendarView = new ExcerptsCalendarView(this.items, this.calendarStatus(),
      () => this.showFeed());
    else this.calendarView.update(this.items, this.calendarStatus());
    if (!this.calendarView.element.isConnected) this.containerEl.append(this.calendarView.element);
    this.pageMode = "calendar";
    this.timeline?.setSuspended(true);
    this.feedEl.hidden = true;
    this.calendarView.element.hidden = false;
    this.containerEl.dataset.page = "calendar";
    viewport.scrollTop = 0; // Most recent month is rendered first on narrow views.
    this.calendarView.onShown();
    this.calendarView.element.querySelector<HTMLButtonElement>(".ex-calendar-back")?.focus({ preventScroll: true });
  }
  private showFeed(restore = true): void {
    if (this.pageMode !== "calendar") return;
    const viewport = this.containerEl.closest<HTMLElement>(".excerpts-native-host");
    this.pageMode = "feed";
    if (this.calendarView) this.calendarView.element.hidden = true;
    this.feedEl.hidden = false;
    delete this.containerEl.dataset.page;
    // Layout is measurable only once the feed is visible again.
    if (viewport) viewport.scrollTop = restore ? this.feedScrollTop : 0;
    this.timeline?.setSuspended(false);
    this.timeline?.resize(); // Width may have changed while the feed was hidden.
    this.checkTypographyChange(); // The font may also have changed while hidden.
    this.reflowVisibleTags();
    this.reflowCaptureTags();
    for (const update of this.previewUpdates.values()) update();
    for (const group of this.sectionHeightChecks.values()) for (const check of group.values()) check();
    if (this.feedRenderPending) {
      const policy = restore ? this.feedPendingPolicy : "top";
      this.feedRenderPending = false;
      this.feedPendingPolicy = "keep";
      this.drawCards(policy);
    } else {
      this.timeline?.refresh();
    }
    if (restore && !this.disposed) this.pageMenuButton?.focus({ preventScroll: true });
  }
  private openSavePageModal(): void {
    if (!this.guard("page")) return;
    const current = this.currentFilter();
    if (!isFiltered(current)) return;
    const stem = (current.tag ? current.tag + "摘录" : "摘录筛选")
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, "").slice(0, 60) || "摘录筛选";
    let suggested = stem;
    for (let index = 2; index <= 100; index++) {
      if (!this.plugin.savedPageNameIssue(this.workspace, suggested)) break;
      suggested = stem.slice(0, 54) + "-" + index;
    }
    const summary = "当前条件：" +
      (current.tag ? "#" + current.tag : "全部标签") +
      (current.query ? " · 搜索「" + current.query + "」" : "");
    new SavePageModal(this.plugin.app, suggested,
      name => this.reason("page") ?? this.plugin.savedPageNameIssue(this.workspace, name),
      async name => {
        if (!this.guard("page")) throw new Error("摘录页已失效，请重新打开");
        const file = await this.plugin.createSavedPage(this.workspace, name, current);
        // The file is already saved; a navigation failure must not leave the save modal in error mode.
        try {
          await this.plugin.openHome(file.path);
          new Notice("已创建摘录页：" + file.basename);
        } catch (error) {
          new Notice("摘录页已保存，但打开失败。请从文件列表重新打开：" +
            file.path + "（" + (error instanceof Error ? error.message : String(error)) + "）");
        }
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
    this.drawCards("anchor");
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
        (this.itemByPath.get(path)?.basename ?? path));
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
    const stale = this.scanStatus !== "done" && !this.selectionBusy && !this.deleteBusy;
    this.selectionCountEl.textContent = this.selectionBusy ?
      "正在选择 " + this.selectionProcessed + " / " + this.selectionBatchTotal :
      "已选 " + chosen + " / " + total + (stale ? " · 列表已变化" : "");
    this.selectedFooterCountEl.textContent = this.selectionBusy ?
      "正在选择…" : stale ? "请退出选择后刷新" : "已选择 " + chosen + " 条";
    this.selectionAllButton.textContent = chosen === total && total > 0 ? "取消全选" : "全选";
    this.selectionAllButton.disabled = this.homeInvalid || this.scanStatus !== "done" ||
      this.deleteBusy || this.selectionBusy || total === 0;
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
    if (this.homeInvalid || this.scanStatus !== "done" ||
        this.selectionMode !== "selecting" || this.selectionBusy || !this.selectionScope.has(path)) return;
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
        this.rebuildAvailableTags();
        this.showSuggestions();
        this.renderTagsFilter();
        this.drawCards("anchor");
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
    if (this.homeInvalid || this.scanStatus !== "done" ||
        this.selectionMode !== "selecting" || this.selectionBusy || this.deleteBusy) return;
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
        if (this.disposed || this.scanStatus !== "done" || this.selectionMode !== "selecting") return;
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
          this.rebuildAvailableTags();
          this.showSuggestions();
          this.renderTagsFilter();
          if (this.pageMode === "calendar") this.calendarView?.update(this.items, this.calendarStatus());
          this.drawCards("anchor");
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
    if (this.deleteBusy || this.scanStatus !== "done" ||
        this.plugin.isBusy(this) || this.plugin.isNavigating())
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
        this.itemByPath.delete(path);
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
      if (removed.size) this.rebuildAvailableTags();
      if (removed.size && this.pageMode === "calendar") this.calendarView?.update(this.items, this.calendarStatus());
      if (result.deleted.length) this.markStale();
      this.drawCards("anchor");
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
    if (this.disposed || this.homeInvalid || this.scanStatus === "scanning" || this.isBusy()) return;
    if (this.plugin.isBusy(this) || !this.plugin.tryAcquireScan(this)) {
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
    try {
      // The mutex was acquired before any state changes or asynchronous work.
      this.searchToken++;
      if (this.searchTimer) clearTimeout(this.searchTimer);
      this.searchTimer = null;
      this.searchReady = !this.searchText;
      this.matches = null;
      this.clearScanCompletion();
      this.scanDirty = false;
      this.scanStatus = "scanning";
      this.scanDone = 0;
      this.scanTotal = 0;
      this.renderScanStatus();
      this.updateAvailability();
      if (force) this.repo.invalidate();
      const cards = await this.repo.scan(this.workspace, this.plugin.settings.scanBatchSize,
        (done, total) => {
          if (cancelled()) return;
          this.scanDone = done;
          this.scanTotal = total;
          this.renderScanStatus();
        }, cancelled);
      if (cancelled() || !cards) return;
      cards.sort((a, b) => b.ctime - a.ctime);
      const scannedScrollPolicy: ScrollPolicy = this.items.length ? "anchor" : "keep";
      this.items = cards;
      this.itemByPath = new Map(cards.map(card => [card.path, card]));
      if (this.pageMode === "calendar") this.calendarView?.update(cards, "stale");
      this.rebuildAvailableTags();
      this.lastScanCount = cards.length;
      this.scanStatus = this.scanDirty ? "stale" : "done";
      this.showSuggestions();
      this.renderTagsFilter();
      // Scanning is prohibited during selection; there is no scope to reconcile.
      if (this.searchText && !this.scanDirty) this.scheduleSearch(scannedScrollPolicy);
      else { this.searchReady = true; this.matches = null; this.drawCards(scannedScrollPolicy); }
      this.completionVisible = this.scanStatus === "done";
      this.announceScan(this.scanStatus === "done"
        ? "摘录扫描完成，共 " + cards.length + " 条"
        : "摘录扫描期间内容已变化，请手动刷新");
    } catch (error) {
      if (!cancelled()) {
        this.clearScanCompletion();
        this.scanStatus = "error";
        this.announceScan("摘录扫描失败");
        // The old feed remains usable after a failed scan.
        this.searchReady = true;
        notify(error);
      }
    } finally {
      try {
        if (!cancelled()) {
          this.renderScanStatus();
          this.updateAvailability();
          if (this.scanStatus === "done" && this.completionVisible) {
            this.scanCompletionTimer = setTimeout(() => {
              this.scanCompletionTimer = null;
              if (this.disposed || this.homeInvalid || this.scanStatus !== "done") return;
              this.completionVisible = false;
              this.renderScanStatus();
            }, 2000);
          }
        }
      } finally {
        // Never unlock when merely cancelling: await the scan's actual termination first.
        this.plugin.releaseScan(this);
      }
    }
  }
  private scheduleSearch(policy: ScrollPolicy = "results"): void {
    this.searchScrollPolicy = policy;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    const token = ++this.searchToken;
    // Search only against a committed index; keep the latest query for scan completion.
    if (!this.searchText) {
      this.searchReady = true; this.matches = null; this.drawCards(policy);
      this.updateAvailability(); return;
    }
    if (this.scanStatus !== "done" || this.plugin.isBusy(this)) return;
    this.searchReady = false;
    this.countEl.textContent = "搜索准备中… · 保留当前列表";
    this.updateAvailability();
    this.searchTimer = setTimeout(() => void this.search(token), 350);
  }
  private async search(token: number): Promise<void> {
    try {
      const matches = await this.repo.search(this.items, this.searchText,
        () => this.disposed || token !== this.searchToken,
        done => { if (token === this.searchToken) this.countEl.textContent = "搜索中 " + done + "/" + this.items.length + " · 保留当前列表"; });
      if (this.disposed || token !== this.searchToken) return;
      this.matches = matches;
      this.searchReady = true;
      this.drawCards(this.searchScrollPolicy);
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
  /** One in-memory tag list per committed index; do not sort every keystroke. */
  private rebuildAvailableTags(): void {
    this.availableTags = [...new Set(this.items.flatMap(item => item.tags))]
      .sort((a, b) => a.localeCompare(b, "zh"));
  }
  private renderTagsFilter(): void {
    this.tagBar.replaceChildren();
    this.tagBar.hidden = !this.filterOpen && !this.tagFilter;
    this.filterButton.setAttribute("aria-expanded", String(!this.tagBar.hidden));
    this.filterButton.disabled = !this.availableTags.length && !this.tagFilter;
    if (this.tagBar.hidden) return;
    const all = button("全部", () => { if (!this.guard("filter")) return; this.tagFilter = ""; this.renderTagsFilter(); this.drawCards("results"); },
      this.tagFilter ? "ex-btn-quiet" : "ex-selected");
    all.setAttribute("aria-pressed", String(!this.tagFilter));
    this.tagBar.append(all);
    // Keep the selected filter readable, including saved pages whose tag is
    // no longer present in the current index. Never mutate availableTags.
    const activeTag = this.tagFilter.trim();
    const tags = activeTag
      ? [activeTag, ...this.availableTags.filter(tag => tag !== activeTag)]
      : this.availableTags;
    const limit = 8;
    for (const tag of tags.slice(0, limit)) {
      const current = this.tagFilter === tag;
      const chip = button("#" + tag, () => {
        if (!this.guard("filter")) return;
        this.tagFilter = this.tagFilter === tag ? "" : tag;
        this.renderTagsFilter(); this.drawCards("results");
      }, current ? "ex-selected" : "ex-btn-quiet");
      chip.setAttribute("aria-pressed", String(current));
      if (current) {
        chip.classList.add("ex-active-filter");
        chip.title = "#" + tag;
        chip.setAttribute("aria-label", "当前筛选标签：" + tag);
        chip.replaceChildren(node("span", "ex-active-filter-label", "#" + tag));
      }
      this.tagBar.append(chip);
    }
    if (tags.length > limit) {
      const more = button("更多标签 · " + (tags.length-limit), () => {
        if (!this.guard("filter")) return;
        const menu = new Menu();
        for (const tag of tags.slice(limit, limit + 40)) menu.addItem(item => item.setTitle("#" + tag).onClick(() => {
          if (!this.guard("filter")) return;
          this.tagFilter = tag; this.renderTagsFilter(); this.drawCards("results");
        }));
        if (tags.length > limit + 40) menu.addItem(item =>
          item.setTitle("其余 " + (tags.length - limit - 40) + " 个标签，请使用搜索").setDisabled(true));
        const rect = more.getBoundingClientRect(); menu.showAtPosition({ x: rect.left, y: rect.bottom }, more.ownerDocument);
      }, "ex-btn-quiet");
      this.tagBar.append(more);
    }
    if (!activeTag) this.tagBar.scrollLeft = 0;
    else this.scheduleActiveFilterVisibility();
    this.updateAvailability();
  }
  /** Scroll only inside the tag strip, never the page. */
  private scheduleActiveFilterVisibility(): void {
    const strip = this.tagBar;
    const chip = strip.querySelector<HTMLButtonElement>(".ex-active-filter");
    if (!chip) return;
    const reveal = () => {
      if (this.disposed || !strip.isConnected || !chip.isConnected || strip.hidden) return;
      const bounds = strip.getBoundingClientRect();
      const selected = chip.getBoundingClientRect();
      if (!bounds.width || !selected.width) return;
      if (selected.left < bounds.left) strip.scrollLeft += selected.left - bounds.left;
      else if (selected.right > bounds.right) strip.scrollLeft += selected.right - bounds.right;
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(reveal);
    else setTimeout(reveal, 0);
  }
  private unmountMarkdown(path?: string): void {
    const paths = path ? [path] : [...this.markdownChildren.keys()];
    for (const current of paths) {
      this.previewObservers.get(current)?.disconnect();
      this.previewObservers.delete(current);
      this.previewUpdates.delete(current);
      this.sectionHeightChecks.delete(current);
      for (const observer of this.sectionObservers.get(current)?.values() ?? []) observer.disconnect();
      this.sectionObservers.delete(current);
      for (const { child } of this.markdownChildren.get(current) ?? []) this.removeChild(child);
      this.markdownChildren.delete(current);
    }
  }
  private unmountMarkdownIn(container: HTMLElement, path: string): void {
    const existing = this.markdownChildren.get(path) ?? [];
    this.markdownChildren.set(path, existing.filter(({ mount, child }) => {
      if (!container.contains(mount)) return true;
      this.removeChild(child);
      return false;
    }));
  }
  /** Native host scroll coordinate of the stable toolbar above the results. */
  private resultHeaderScrollTop(): number {
    const viewport = this.containerEl.closest<HTMLElement>(".excerpts-native-host");
    const toolbar = this.containerEl.querySelector<HTMLElement>(".ex-toolbar:not(.ex-selection-toolbar)");
    if (!viewport || !toolbar) return 0;
    return Math.max(0, viewport.scrollTop + toolbar.getBoundingClientRect().top -
      viewport.getBoundingClientRect().top - 12);
  }
  private compactLayout(): boolean {
    const hostWidth = this.containerEl.closest<HTMLElement>(".excerpts-native-host")?.clientWidth ?? 0;
    return hostWidth > 0 ? hostWidth <= 700 : document.body.classList.contains("is-mobile");
  }
  private listBatchSize(viewport: HTMLElement): number {
    const { listBatchMode, listBatchSize } = this.plugin.settings;
    if (listBatchMode === "fixed") return listBatchSize;
    const average = this.timeline?.getMeasuredAverageHeight();
    if (average === null || average === undefined) return this.adaptiveBatch;
    const viewportHeight = Math.max(1, viewport.clientHeight || 800);
    // Hysteresis prevents continuously changing the batch as media loads.
    if (this.lastAverageHeight &&
        Math.abs(average - this.lastAverageHeight) / this.lastAverageHeight < 0.25 &&
        Math.abs(viewportHeight - this.lastBatchViewportHeight) < 60) return this.adaptiveBatch;
    this.lastAverageHeight = average;
    this.lastBatchViewportHeight = viewportHeight;
    const suggested = 8 * Math.ceil(3 * viewportHeight / average / 8);
    this.adaptiveBatch = Math.max(16, Math.min(96, suggested));
    return this.adaptiveBatch;
  }
  private timelineRows(items: CardIndex[]): TimelineRow[] {
    let previous = "";
    const compact = this.compactLayout();
    return items.map((item, index) => {
      const day = dayKey(item.ctime);
      const firstOfDay = day !== previous;
      previous = day;
      const label = dayLabel(item.ctime);
      const gap = index === 0 ? 0 : firstOfDay ? (compact ? 24 : 32) : 16;
      const sections = this.sectionsShown.get(item.path);
      const sectionState = sections ? [...sections].sort((a, b) => a - b).join(",") : "";
      const layoutKey = [
        item.mtime, item.size, item.ctime, item.tags.join("\u001f"),
        firstOfDay ? label.title + "|" + label.subtitle : "",
        index === 0 ? "first" : firstOfDay ? "day" : "row",
        compact ? "compact" : "wide",
        this.expandedBodies.has(item.path) ? "expanded" : "clamped",
        this.expandedTagRows.has(item.path) ? "tags-expanded" : "tags-clamped",
        sectionState
      ].join("\u001e");
      return {
        path: item.path, firstOfDay,
        dayTitle: firstOfDay ? label.title : "",
        daySubtitle: firstOfDay ? label.subtitle : "",
        estimatedHeight: 104 + Math.min(320, Math.max(60, Math.ceil(item.size / 5))) + gap +
          (firstOfDay && compact ? 26 : 0),
        layoutKey,
        contentKey: [item.mtime, item.size, item.ctime, item.tags.join("\u001f"),
          item.frontmatterTags.join("\u001f"), item.inlineTags.join("\u001f")].join("\u001e")
      };
    });
  }
  private mountTimelineRow(row: TimelineRow, index: number): HTMLElement {
    const item = this.itemByPath.get(row.path);
    if (!item) throw new Error("摘录索引已失效，请手动刷新");
    const wrapper = node("section", "ex-virtual-row");
    wrapper.classList.toggle("ex-virtual-day-start", row.firstOfDay);
    wrapper.classList.toggle("ex-virtual-first-row", index === 0);
    const rail = node("header", "ex-day-rail");
    if (row.firstOfDay) {
      rail.append(node("h4", "ex-day-title", row.dayTitle));
      if (row.daySubtitle) rail.append(node("span", "ex-day-subtitle", row.daySubtitle));
    } else rail.setAttribute("aria-hidden", "true");
    const slot = node("div", "ex-virtual-card-slot");
    const card = this.createCard(item);
    slot.append(card);
    wrapper.append(rail, slot);
    wrapper.dataset.tagFilter = this.tagFilter;
    if (this.observer) this.observer.observe(card);
    else this.enqueue(item.path, () => this.hydrate(item, card, this.renderToken));
    this.scheduleTagReflow(card.querySelector<HTMLElement>(".ex-chips")!);
    return wrapper;
  }
  /** Update presentation without detaching a surviving Markdown renderer. */
  private updateTimelineRow(row: TimelineRow, index: number, wrapper: HTMLElement,
    previous: TimelineRow): void {
    wrapper.classList.toggle("ex-virtual-day-start", row.firstOfDay);
    wrapper.classList.toggle("ex-virtual-first-row", index === 0);
    if (row.firstOfDay !== previous.firstOfDay ||
        row.dayTitle !== previous.dayTitle || row.daySubtitle !== previous.daySubtitle) {
      const rail = wrapper.querySelector<HTMLElement>(".ex-day-rail");
      if (rail) {
        rail.replaceChildren();
        if (row.firstOfDay) {
          rail.append(node("h4", "ex-day-title", row.dayTitle));
          if (row.daySubtitle) rail.append(node("span", "ex-day-subtitle", row.daySubtitle));
          rail.removeAttribute("aria-hidden");
        } else rail.setAttribute("aria-hidden", "true");
      }
    }
    if (wrapper.dataset.tagFilter !== this.tagFilter) {
      const item = this.itemByPath.get(row.path);
      const chips = wrapper.querySelector<HTMLElement>(".ex-chips");
      if (item && chips) this.renderTags(chips, item, this.openTagEditors.has(row.path));
      wrapper.dataset.tagFilter = this.tagFilter;
    }
  }
  private unmountTimelineRow(row: TimelineRow, wrapper: HTMLElement): void {
    const card = wrapper.querySelector<HTMLElement>(".ex-card");
    if (card && this.observer) this.observer.unobserve(card);
    if (card && this.mediaObserver) this.mediaObserver.unobserve(card);
    for (const media of Array.from(wrapper.querySelectorAll<HTMLMediaElement>("video,audio"))) {
      try { media.pause(); } catch { /* The detached native renderer will be released. */ }
    }
    this.queue = this.queue.filter(task => task.path !== row.path);
    this.unmountMarkdown(row.path);
  }
  private drawCards(policy: ScrollPolicy): void {
    if (this.pageMode === "calendar") {
      // A hidden list has no reliable dimensions. Coalesce background changes rather
      // than unmounting the Markdown renderers or measuring zero-height rows.
      this.feedRenderPending = true;
      if (policy === "top" || this.feedPendingPolicy === "top") this.feedPendingPolicy = "top";
      else if (policy === "anchor" || this.feedPendingPolicy === "anchor") this.feedPendingPolicy = "anchor";
      return;
    }
    const token = this.renderToken;
    const resultsUnavailable = Boolean(this.searchText) && this.matches === null &&
      (this.scanStatus === "stale" || (this.scanStatus === "scanning" && this.scanDirty));
    if (resultsUnavailable) {
      this.timeline?.setRows([], "keep");
      this.countEl.textContent = "搜索结果暂不可用";
      const empty = node("section", "ex-empty");
      empty.append(node("div", "ex-empty-title", "搜索结果暂不可用"));
      empty.append(node("p", "ex-empty-description",
        "摘录内容在扫描期间发生变化。请清除搜索词，然后手动刷新。"));
      this.listEl.append(empty);
      this.updateAvailability();
      return;
    }
    const visible = this.visibleItems();
    this.countEl.textContent = this.items.length ? visible.length + " / " + this.items.length : "0 条摘录";
    if (visible.length && !this.observer && typeof IntersectionObserver !== "undefined") {
      const root = this.containerEl.closest(".excerpts-native-host");
      this.mediaObserver = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) continue;
          for (const media of Array.from(entry.target.querySelectorAll<HTMLMediaElement>("video,audio"))) {
            try { media.pause(); } catch { /* Unsupported media elements are not controlled. */ }
          }
        }
      }, { root });
      this.observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          this.observer?.unobserve(entry.target);
          const card = entry.target as HTMLElement;
          const item = this.itemByPath.get(card.dataset.path ?? "");
          if (item) this.enqueue(item.path, () => this.hydrate(item, card, token));
        }
      }, { root, rootMargin: "350px 0px" });
    }
    this.timeline?.setRows(this.timelineRows(visible), policy);
    if (!visible.length) {
      const empty = node("section", "ex-empty");
      empty.append(node("div", "ex-empty-title", this.items.length ? "没有匹配的摘录" : "从第一段文字开始"));
      empty.append(node("p", "ex-empty-description", this.items.length ?
        "试试其他关键词，或清除筛选条件。" : "写下喜欢的句子，未来的某一天再读到它。"));
      this.listEl.append(empty);
    }
    if (this.selectionMode !== "normal") this.updateSelectionControls();
    this.updateAvailability();
  }
  private enqueue(path: string, task: () => Promise<void>): void {
    this.queue.push({ path, task });
    this.pump();
  }
  private pump(): void {
    while (this.reading < 4 && this.queue.length) {
      const job = this.queue.shift()!;
      this.reading++;
      void job.task().catch(error => { if (!this.disposed) notify(error); }).finally(() => {
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
    card.append(footer, editor);
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
    const recovery = this.getRecoveryInfo();
    if (recovery?.action === "refresh" && this.reason("refresh") === null ||
        recovery?.action === "clear-search" && this.canClearSearch()) {
      // A recovery action needs only the committed index, never the (possibly
      // missing or slow) Markdown body. Hide file actions until recovery.
      const menu = new Menu();
      if (recovery.action === "refresh") {
        menu.addItem(entry => entry.setTitle(recovery.actionLabel ?? "刷新摘录")
          .setIcon("refresh-cw")
          .onClick(() => this.runRecoveryAction("refresh")));
      } else {
        menu.addItem(entry => entry.setTitle("清除搜索")
          .setIcon("search-x")
          .onClick(() => this.runRecoveryAction("clear-search")));
      }
      const rect = anchor.getBoundingClientRect();
      menu.showAtPosition({ x: rect.left, y: rect.bottom }, anchor.ownerDocument);
      return;
    }
    // Do not display read/edit/delete commands for a stale card whose file
    // has disappeared. A new manual scan is the only supported recovery.
    if (!(this.plugin.app.vault.getAbstractFileByPath(item.path) instanceof TFile)) {
      this.markStale(item.path);
      new Notice("该摘录文件已移动或删除，请刷新索引");
      return;
    }
    let parsed: ParsedMarkdown | null = null;
    try { parsed = await this.repo.read(item.path); }
    catch { /* If the file still exists, retain the original preview/edit affordances. */ }
    if (this.disposed || !anchor.isConnected || !this.guard("page")) return;
    if (!(this.plugin.app.vault.getAbstractFileByPath(item.path) instanceof TFile)) {
      this.markStale(item.path);
      new Notice("该摘录文件已移动或删除，请刷新索引");
      return;
    }
    const menu = new Menu();
    menu.addItem(entry => entry.setTitle("阅读原文").setIcon("book-open").onClick(() => {
      if (!this.guard("page")) return;
      void this.plugin.openMarkdownPreview(item.path).catch(notify);
    }));
    menu.addItem(entry => entry.setTitle("编辑原文").onClick(() => {
      if (!this.guard("page")) return;
      void this.plugin.openMarkdown(item.path).catch(notify);
    }));
    // The card itself refuses per-section preview above 24 H2 headings.
    // The menu must honor that same limit instead of creating hundreds of actions.
    const sections = parsed?.sections ?? [];
    if (sections.length <= 24) {
      const totals = new Map<string, number>();
      for (const section of sections) totals.set(section.name, (totals.get(section.name) ?? 0) + 1);
      const seen = new Map<string, number>();
      for (let index = 0; index < sections.length; index++) {
        const section = sections[index];
        const count = (seen.get(section.name) ?? 0) + 1;
        seen.set(section.name, count);
        const suffix = (totals.get(section.name) ?? 0) > 1 ? "（第 " + count + " 个）" : "";
        menu.addItem(entry => entry.setTitle("编辑分组：" + section.name + suffix).onClick(() => {
          if (!this.guard("page")) return;
          void this.openSection(item.path, index).catch(notify);
        }));
      }
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
      this.mediaObserver?.observe(card);
      card.classList.remove("ex-card-loading");
    } catch (error) {
      if (!this.disposed && token === this.renderToken && card.isConnected) {
        const quote = card.querySelector<HTMLElement>(".ex-quote");
        if (quote) {
          quote.replaceChildren(node("p", "ex-preview-error", "摘录加载失败"));
          quote.append(button("阅读原文 ↗", () => {
            if (this.guard("page")) void this.plugin.openMarkdownPreview(item.path).catch(notify);
          }, "ex-expand-body"));
        }
        card.classList.remove("ex-card-loading");
      }
      throw error;
    }
  }
  private renderContent(card: HTMLElement, item: CardIndex, parsed: ParsedMarkdown): void {
    const body = card.querySelector<HTMLElement>(".ex-quote")!;
    body.replaceChildren();
    const mediaFirst = !parsed.title &&
      /^\s*(?:!\[\[[^\]]+\]\]|!\[[^\]]*\]\([^)]+\)|<img\b[^>]*>|<video\b[^>]*>)(?:\s*\n\s*\n|\s*$)/.test(parsed.body);
    card.classList.toggle("ex-media-first", mediaFirst);
    if (parsed.title) body.append(node("h4", "ex-note-heading", parsed.title));
    const content = node("div", "ex-content-viewport");
    const previewKind = classifyPreview(parsed);
    card.dataset.previewKind = previewKind;
    // Clamp before rendering to prevent transient full-height layout shifts.
    content.classList.add("ex-content-clamped");
    body.append(content);
    const expand = button("", () => {
      if (!this.guard("page")) return;
      if (expand.dataset.action === "read") {
        void this.plugin.openMarkdownPreview(item.path).catch(notify);
        return;
      }
      if (expand.dataset.action !== "expand") return;
      if (this.expandedBodies.has(item.path)) this.expandedBodies.delete(item.path);
      else this.expandedBodies.add(item.path);
      updatePreview();
    }, "ex-expand-body");
    expand.hidden = true;
    body.append(expand);
    let previewFailed = false;
    const showPreviewFailure = () => {
      if (!card.isConnected || this.disposed) return;
      previewFailed = true;
      this.expandedBodies.delete(item.path);
      this.unmountMarkdownIn(content, item.path);
      content.replaceChildren(node("p", "ex-preview-error",
        "内容预览失败，请在 Obsidian 阅读模式中查看。"));
      content.classList.remove("ex-content-clamped");
      expand.hidden = false;
      expand.dataset.action = "read";
      expand.textContent = "阅读原文 ↗";
      expand.setAttribute("aria-expanded", "false");
      this.previewObservers.get(item.path)?.disconnect();
      this.previewObservers.delete(item.path);
    };
    const updatePreview = () => {
      if (previewFailed || !card.isConnected || !content.isConnected) return;
      const policy = previewPolicy(previewKind, this.compactLayout());
      const rendered = content.querySelector<HTMLElement>(".ex-native-markdown");
      const measured = Math.max(rendered?.scrollHeight ?? 0, content.scrollHeight,
        rendered?.getBoundingClientRect().height ?? 0);
      const fallback = parsed.body.length > 280 ? parsed.body.length / 2 : 0;
      const action = previewAction(measured > 0 ? measured : fallback, policy);
      if (action !== "expand") this.expandedBodies.delete(item.path);
      expand.hidden = action === "none";
      expand.dataset.action = action;
      const expanded = action === "expand" && this.expandedBodies.has(item.path);
      content.classList.toggle("ex-content-clamped", action !== "none" && !expanded);
      expand.textContent = action === "read" ? "阅读原文 ↗" : expanded ? "收起正文" : "展开正文";
      expand.setAttribute("aria-expanded", String(expanded));
    };
    this.previewUpdates.set(item.path, updatePreview);
    if (parsed.body.length > 50000) {
      content.append(node("p", "ex-long-content-hint", "正文过长，请在原文阅读模式中查看。"));
      content.classList.remove("ex-content-clamped");
      expand.hidden = false;
      expand.dataset.action = "read";
      expand.textContent = "阅读原文 ↗";
      expand.setAttribute("aria-expanded", "false");
    } else if (parsed.body) {
      void this.renderMarkdown(content, parsed.body, item.path).then(result => {
        if (!content.isConnected || this.disposed) return;
        if (!result.ok) { showPreviewFailure(); return; }
        updatePreview();
        const markdown = content.querySelector<HTMLElement>(".ex-native-markdown");
        if (markdown && typeof ResizeObserver !== "undefined") {
          this.previewObservers.get(item.path)?.disconnect();
          const observer = new ResizeObserver(() => updatePreview());
          observer.observe(markdown);
          this.previewObservers.set(item.path, observer);
        }
      });
      content.addEventListener("load", () => updatePreview(), true);
    }
    if (!parsed.body && !parsed.title && !parsed.sections.length)
      body.append(node("span", "ex-empty-card", "（空白摘录）"));
    this.renderSections(card.querySelector<HTMLElement>(".ex-extras")!, item, parsed);
  }

  private renderMarkdown(container: HTMLElement, markdown: string, path: string):
    Promise<{ ok: true } | { ok: false; error: string }> {
    const mount = node("div", "ex-native-markdown markdown-rendered");
    container.append(mount);
    const child = new MarkdownRenderChild(mount);
    this.addChild(child);
    const list = this.markdownChildren.get(path) ?? [];
    list.push({ mount, child });
    this.markdownChildren.set(path, list);
    return Promise.resolve()
      .then(() => MarkdownRenderer.render(this.plugin.app, markdown, mount, path, child))
      .then(() => ({ ok: true as const }))
      .catch(error => ({ ok: false as const,
        error: error instanceof Error ? error.message : String(error) }));
  }
  private renderSections(mount: HTMLElement, item: CardIndex, parsed: ParsedMarkdown): void {
    mount.replaceChildren();
    if (!parsed.sections.length) return;
    const readOriginal = () => {
      if (!this.guard("page")) return;
      void this.plugin.openMarkdownPreview(item.path).catch(notify);
    };
    // Huge notes are documents, not card-sized stacks of hundreds of disclosures.
    if (parsed.sections.length > 24) {
      mount.append(node("p", "ex-long-content-hint",
        "包含 " + parsed.sections.length + " 个分组，请在阅读模式查看。"));
      mount.append(button("阅读原文 ↗", readOriginal, "ex-group-read"));
      return;
    }
    const shown = this.sectionsShown.get(item.path) ?? new Set<number>();
    const card = mount.closest<HTMLElement>(".ex-card");
    parsed.sections.forEach((section, index) => {
      const wrapper = node("section", "ex-section");
      const expanded = shown.has(index);
      const region = node("div", "ex-group-body");
      region.hidden = !expanded;
      let exceeded = false;
      const read = button("阅读原文 ↗", readOriginal, "ex-group-read");
      read.hidden = true;
      const chevron = node("span", "ex-group-chevron");
      const trigger = button("", () => {
        if (exceeded) { readOriginal(); return; }
        const opening = region.hidden;
        region.hidden = !opening;
        trigger.setAttribute("aria-expanded", String(opening));
        trigger.setAttribute("aria-label", (opening ? "收起" : "展开") + "分组：" + section.name);
        setIcon(chevron, opening ? "chevron-down" : "chevron-right");
        if (opening) {
          shown.add(index);
          mountSection();
        } else {
          shown.delete(index);
          this.sectionObservers.get(item.path)?.get(index)?.disconnect();
          this.sectionObservers.get(item.path)?.delete(index);
          this.unmountMarkdownIn(region, item.path);
          region.replaceChildren();
        }
        this.sectionsShown.set(item.path, shown);
      }, "ex-group-trigger");
      trigger.setAttribute("aria-expanded", String(expanded));
      trigger.setAttribute("aria-label", (expanded ? "收起" : "展开") + "分组：" + section.name);
      setIcon(chevron, expanded ? "chevron-down" : "chevron-right");
      trigger.append(chevron, node("span", "ex-group-name", section.name));
      wrapper.append(trigger, read, region);
      mount.append(wrapper);

      const enforceSafeHeight = () => {
        if (!card?.isConnected || region.hidden || exceeded) return;
        const safe = previewPolicy(classifyPreview(parsed), this.compactLayout()).expandedLimit;
        if (region.scrollHeight <= safe && card.getBoundingClientRect().height <= safe + 320) return;
        exceeded = true;
        shown.delete(index);
        this.sectionsShown.set(item.path, shown);
        this.sectionObservers.get(item.path)?.get(index)?.disconnect();
        this.sectionObservers.get(item.path)?.delete(index);
        this.unmountMarkdownIn(region, item.path);
        region.replaceChildren();
        region.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
        trigger.setAttribute("aria-label", "阅读原文：" + section.name);
        setIcon(chevron, "arrow-up-right");
        read.hidden = false;
        new Notice("分组超过卡片阅读上限，请在阅读模式查看");
      };
      let mountSection: () => void = () => {};
      // Declaration is intentionally outside the click callback so restored sections
      // and newly opened sections use the same bounded native renderer.
      const renderSection = () => {
        if (!section.markdown || region.childElementCount) return;
        if (section.markdown.length > 50000) {
          exceeded = true;
          shown.delete(index);
          region.hidden = true;
          trigger.setAttribute("aria-expanded", "false");
          trigger.setAttribute("aria-label", "阅读原文：" + section.name);
          setIcon(chevron, "arrow-up-right");
          read.hidden = false;
          return;
        }
        void this.renderMarkdown(region, section.markdown, item.path).then(result => {
          if (this.disposed || !region.isConnected || region.hidden) return;
          if (!result.ok) {
            exceeded = true;
            shown.delete(index);
            this.sectionsShown.set(item.path, shown);
            this.unmountMarkdownIn(region, item.path);
            region.replaceChildren();
            region.hidden = true;
            trigger.setAttribute("aria-expanded", "false");
            trigger.setAttribute("aria-label", "阅读原文：" + section.name);
            setIcon(chevron, "arrow-up-right");
            wrapper.insertBefore(node("p", "ex-preview-error", "分组预览失败"), read);
            read.hidden = false;
            return;
          }
          enforceSafeHeight();
          if (exceeded || typeof ResizeObserver === "undefined") return;
          const observer = new ResizeObserver(() => enforceSafeHeight());
          const list = this.sectionObservers.get(item.path) ?? new Map<number, ResizeObserver>();
          list.get(index)?.disconnect();
          list.set(index, observer);
          this.sectionObservers.set(item.path, list);
          observer.observe(region);
        });
      };
      // Bind the shared renderer without rebuilding the main Markdown body.
      mountSection = renderSection;
      const checks = this.sectionHeightChecks.get(item.path) ?? new Map<number, () => void>();
      checks.set(index, enforceSafeHeight);
      this.sectionHeightChecks.set(item.path, checks);
      if (expanded) renderSection();
    });
  }

  private renderTags(mount: HTMLElement, item: CardIndex, editorOpen = false): void {
    mount.replaceChildren();
    const card = mount.closest<HTMLElement>(".ex-card");
    const editor = card?.querySelector<HTMLElement>(".ex-tag-editor");
    mount.classList.toggle("ex-tags-empty", !item.tags.length);
    mount.classList.toggle("ex-tags-editing", editorOpen);
    mount.classList.toggle("ex-tags-expanded", !editorOpen && this.expandedTagRows.has(item.path));
    // The active filter must be visible even when a card's remaining tags
    // are collapsed behind +N. Only the display order changes, never item.tags.
    const displayTags = !editorOpen && this.tagFilter && item.tags.includes(this.tagFilter)
      ? [this.tagFilter, ...item.tags.filter(tag => tag !== this.tagFilter)]
      : item.tags;
    if (!editorOpen) for (const tag of displayTags) {
      const pill = button("", () => {
        if (!this.guard("filter")) return;
        this.tagFilter = this.tagFilter === tag ? "" : tag;
        this.renderTagsFilter(); this.drawCards("anchor");
      }, "ex-tag");
      pill.setAttribute("aria-label", "筛选标签：" + tag);
      pill.title = "#" + tag;
      pill.replaceChildren(node("span", "ex-tag-label", "#" + tag));
      pill.setAttribute("aria-pressed", String(this.tagFilter === tag));
      if (this.tagFilter === tag) pill.classList.add("ex-selected");
      mount.append(pill);
    }
    if (!editorOpen && !this.expandedTagRows.has(item.path)) {
      const more = button("", () => {
        const transferFocus = document.activeElement === more;
        this.expandedTagRows.add(item.path);
        this.renderTags(mount, item, false);
        if (transferFocus) {
          this.reflowTagRow(mount);
          this.focusAvailableTagAction(mount, "collapse");
        }
      }, "ex-tag-overflow");
      more.hidden = true;
      mount.append(more);
    }
    if (!editorOpen && this.expandedTagRows.has(item.path)) {
      const collapse = button("收起", () => {
        const transferFocus = document.activeElement === collapse;
        this.expandedTagRows.delete(item.path);
        this.renderTags(mount, item, false);
        if (transferFocus) {
          this.reflowTagRow(mount);
          this.focusAvailableTagAction(mount, "overflow");
        }
      }, "ex-tag-collapse");
      collapse.setAttribute("aria-label", "收起标签");
      mount.append(collapse);
    }
    const toggle = button(editorOpen ? "" : item.tags.length ? "+" : "＋ 标签", () => {
      if (this.pendingTags.has(item.path)) return;
      if (this.openTagEditors.has(item.path)) this.closeTagEditor(item, card);
      else {
        const footer = mount.closest<HTMLElement>(".ex-card-footer");
        if (footer && footer.clientWidth > 0 && footer.clientWidth < 44) {
          new Notice("当前分栏过窄，请扩大后再编辑标签");
          return;
        }
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
    if (editorOpen) {
      toggle.disabled = !this.canCancelTagEdit(item.path);
      toggle.classList.add("ex-is-cancelling");
      const icon = node("span", "ex-card-tag-toggle-icon");
      setIcon(icon, "x");
      toggle.append(icon, node("span", "ex-card-tag-toggle-text", "取消"));
    }
    toggle.setAttribute("aria-label", editorOpen ? "取消标签编辑" : "添加标签");
    toggle.title = editorOpen ? "取消标签编辑" : "添加标签";
    toggle.setAttribute("aria-expanded", String(editorOpen));
    mount.append(toggle);
    this.scheduleTagReflow(mount);
  }

  private closeTagEditor(item: CardIndex, card: HTMLElement | null | undefined,
    persisted = false): void {
    if (!persisted && !this.canCancelTagEdit(item.path)) return;
    this.openTagEditors.delete(item.path);
    const editor = card?.querySelector<HTMLElement>(".ex-tag-editor");
    if (editor) { editor.hidden = true; editor.replaceChildren(); }
    const mount = card?.querySelector<HTMLElement>(".ex-chips");
    if (mount) {
      this.renderTags(mount, item, false);
      this.reflowTagRow(mount);
      const add = mount.querySelector<HTMLButtonElement>(".ex-add-tag");
      if (add && !add.hidden) add.focus();
      else card?.querySelector<HTMLButtonElement>(".ex-card-options")?.focus();
    }
    this.updateAvailability();
  }

  private renderTagEditor(editor: HTMLElement, item: CardIndex): void {
    // One DOM instance per edit session. Selecting a row never recreates the input.
    editor.replaceChildren();
    editor.hidden = false;
    const selected = new Set(item.frontmatterTags);
    const original = [...item.frontmatterTags];
    const targetFile = this.plugin.app.vault.getAbstractFileByPath(item.path);
    const card = editor.closest<HTMLElement>(".ex-card");
    const heading = node("div", "ex-tag-editor-head");
    const title = node("strong", "ex-tag-editor-title", "编辑标签");
    const counter = node("span", "ex-tag-editor-count");
    const preview = node("div", "ex-tag-selected");
    preview.setAttribute("aria-label", "待提交标签预览");
    const isDirty = () => original.length !== selected.size ||
      original.some(tag => !selected.has(tag));
    const updatePreview = () => {
      preview.replaceChildren();
      // A tag appearing both in YAML and the body is shown just once.
      const all = [...new Set([...selected, ...item.inlineTags])];
      for (const tag of all) {
        const pill = node("span", "ex-tag-selected-chip");
        pill.title = "#" + tag;
        pill.setAttribute("aria-label", "#" + tag +
          (item.inlineTags.includes(tag) ? "，正文标签，只读" : ""));
        if (item.inlineTags.includes(tag)) {
          pill.classList.add("ex-tag-selected-readonly");
          const lock = node("span", "ex-tag-selected-lock");
          lock.setAttribute("aria-hidden", "true");
          setIcon(lock, "lock");
          pill.append(lock);
        }
        pill.append(node("span", "ex-tag-selected-label", "#" + tag));
        preview.append(pill);
      }
      if (!all.length) preview.append(node("span", "ex-tag-selected-empty", "尚未选择标签"));
      counter.textContent = "已选 " + all.length + (isDirty() ? " · 未保存" : "");
    };
    heading.append(title, counter);
    updatePreview();
    const controls = node("div", "ex-tag-editor-actions");
    const cancel = button("取消", () => {
      if (this.canCancelTagEdit(item.path)) this.closeTagEditor(item, card);
    }, "ex-tag-cancel");
    const done = button("完成", () => void commit(), "ex-tag-done");
    controls.append(cancel, done);
    const warning = node("p", "ex-tag-edit-warning");
    const blockedAtOpen = this.reason("tag");
    const initialWarning = this.scanStatus !== "done"
      ? "摘录内容已变化，请取消标签编辑后刷新。" : (blockedAtOpen ?? "");
    warning.textContent = initialWarning;
    warning.hidden = !initialWarning;
    done.disabled = Boolean(blockedAtOpen) || this.scanStatus !== "done";
    const picker = new TagPicker({
      available: () => this.availableTags,
      selected: () => selected,
      readonlyTags: () => new Set(item.inlineTags),
      onToggle: (tag, add) => {
        if (this.pendingTags.has(item.path)) return;
        if (add) selected.add(tag);
        else selected.delete(tag);
        updatePreview();
      },
      onEscape: () => { if (this.canCancelTagEdit(item.path)) this.closeTagEditor(item, card); }
    });
    const inlineInfo = item.inlineTags.length
      ? node("div", "ex-tag-inline-hint",
          "正文标签请在 Markdown 原文中修改。先结束标签编辑，再从卡片选项进入原文。") : null;
    const commit = async () => {
      if (this.pendingTags.has(item.path) || !this.guard("tag")) return;
      if (!isDirty()) {
        this.closeTagEditor(item, card); return;
      }
      this.pendingTags.add(item.path);
      picker.setDisabled(true); done.disabled = true; cancel.disabled = true;
      card?.querySelector<HTMLButtonElement>(".ex-add-tag")?.setAttribute("disabled", "");
      counter.textContent = "保存中…";
      done.textContent = "保存中…";
      try {
        if (!(targetFile instanceof TFile))
          throw new Error("原摘录文件不存在，请重新打开卡片");
        await this.repo.setFrontmatterTags(item.path, [...selected], original,
          this.workspace, targetFile);
        item.frontmatterTags = [...selected];
        item.tags = [...new Set([...selected, ...item.inlineTags])];
        this.closeTagEditor(item, card, true);
        this.rebuildAvailableTags();
        this.showSuggestions(); this.renderTagsFilter();
        this.markStale(item.path);
      } catch (error) {
        notify(error);
        if (editor.isConnected) {
          picker.setDisabled(false); done.disabled = false; cancel.disabled = false;
          done.textContent = "完成";
          updatePreview();
          picker.focus();
        }
      } finally {
        this.pendingTags.delete(item.path);
        this.updateAvailability();
      }
    };
    editor.append(heading, warning, preview, picker.element);
    if (inlineInfo) editor.append(inlineInfo);
    editor.append(controls);
    picker.focus();
  }
  /** Read actual excerpt font metrics without keeping another DOM observer. */
  private readTypographySignature(): string {
    const sample = node("span", "ex-quote");
    sample.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
    this.feedEl.append(sample);
    try {
      const computed = sample.ownerDocument.defaultView?.getComputedStyle(sample);
      return [computed?.fontFamily, computed?.fontSize, computed?.lineHeight,
        computed?.letterSpacing].join("\u001f");
    } finally { sample.remove(); }
  }
  private checkTypographyChange(): void {
    const next = this.readTypographySignature();
    if (next === this.typographySignature) return;
    this.typographySignature = next;
    this.timeline?.invalidateTextMetrics();
  }
  private scheduleTagReflow(mount: HTMLElement): void {
    const work = () => { if (!this.disposed && mount.isConnected) this.reflowTagRow(mount); };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(work);
    else setTimeout(work, 0);
  }
  private reflowVisibleTags(): void {
    for (const row of Array.from(this.listEl.querySelectorAll<HTMLElement>(".ex-chips"))) this.reflowTagRow(row);
  }
  /** Restore focus only when a focused tag control is replaced or hidden. */
  private focusAvailableTagAction(mount: HTMLElement, preferred: "collapse" | "overflow" | "add"): void {
    const order = preferred === "collapse" ? [".ex-tag-collapse", ".ex-tag-overflow", ".ex-add-tag"] :
      preferred === "add" ? [".ex-add-tag", ".ex-tag-overflow"] :
        [".ex-tag-overflow", ".ex-add-tag"];
    const card = mount.closest<HTMLElement>(".ex-card");
    const controls = [...order.map(selector => mount.querySelector<HTMLButtonElement>(selector)),
      card?.querySelector<HTMLButtonElement>(".ex-card-options")];
    for (const control of controls) {
      if (!control || !control.isConnected || control.hidden || control.disabled || control.closest("[hidden]")) continue;
      const box = control.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) continue;
      if (mount.contains(control) && (!mount.clientWidth || box.width > mount.clientWidth + 1)) continue;
      control.focus({ preventScroll: true });
      if (document.activeElement === control) return;
    }
  }
  private reflowTagRow(mount: HTMLElement): void {
    const card = mount.closest<HTMLElement>(".ex-card");
    if (!card) return;
    const footer = mount.closest<HTMLElement>(".ex-card-footer");
    if (mount.classList.contains("ex-tags-editing")) {
      if (!footer) return;
      const cancel = mount.querySelector<HTMLButtonElement>(".ex-add-tag");
      const actions = footer.querySelector<HTMLElement>(".ex-card-actions");
      if (!cancel || !actions) return;
      // Measure the natural label with the normal footer; the compact state
      // hides only the disabled More action and the redundant "取消" text.
      footer.classList.remove("ex-edit-compact");
      const required = cancel.getBoundingClientRect().width +
        actions.getBoundingClientRect().width + 8;
      const compact = footer.clientWidth < required;
      const focusInsideActions = actions.contains(document.activeElement);
      footer.classList.toggle("ex-edit-compact", compact);
      if (footer.clientWidth > 0 && footer.clientWidth < 44) {
        if (footer.dataset.exNarrowWarning !== "shown") {
          footer.dataset.exNarrowWarning = "shown";
          new Notice("当前分栏过窄，请扩大后完成或取消标签编辑");
        }
      } else delete footer.dataset.exNarrowWarning;
      if (compact && focusInsideActions) cancel.focus();
      return;
    }
    footer?.classList.remove("ex-edit-compact");
    if (this.expandedTagRows.has(card.dataset.path ?? "")) {
      const collapse = mount.querySelector<HTMLButtonElement>(".ex-tag-collapse");
      const add = mount.querySelector<HTMLButtonElement>(".ex-add-tag");
      if (!collapse || !add || !mount.clientWidth) return;
      const bounds = mount.getBoundingClientRect();
      const controls = Array.from(mount.querySelectorAll<HTMLButtonElement>(
        ".ex-tag, .ex-tag-collapse, .ex-add-tag"));
      const unsafe = controls.some(control => {
        const rect = control.getBoundingClientRect();
        return rect.width > mount.clientWidth + 1 ||
          (Number.isFinite(rect.left) && Number.isFinite(bounds.left) &&
            rect.left < bounds.left - 1) ||
          (Number.isFinite(rect.right) && Number.isFinite(bounds.right) &&
            rect.right > bounds.right + 1);
      });
      if (!unsafe) return;
      const hadFocus = mount.contains(document.activeElement);
      const path = card.dataset.path ?? "";
      this.expandedTagRows.delete(path);
      const item = this.itemByPath.get(path);
      if (!item) return;
      this.renderTags(mount, item, false);
      this.reflowTagRow(mount);
      if (hadFocus) this.focusAvailableTagAction(mount, "overflow");
      return;
    }
    const focused = mount.contains(document.activeElement) &&
      document.activeElement?.tagName === "BUTTON" ? document.activeElement as HTMLButtonElement : null;
    const pills = Array.from(mount.querySelectorAll<HTMLButtonElement>(".ex-tag"));
    const overflow = mount.querySelector<HTMLButtonElement>(".ex-tag-overflow");
    const add = mount.querySelector<HTMLButtonElement>(".ex-add-tag");
    if (!overflow || !add) return;
    // Restore the real hit target before measuring; narrow panes may have
    // hidden it during the previous pass. The finally block also covers early returns.
    try {
    add.hidden = false;
    if (!mount.clientWidth) { add.hidden = true; overflow.hidden = true; return; }
    const addWidth = add.getBoundingClientRect().width;
    if (mount.clientWidth < addWidth) {
      // A clipped button is not a usable action. The card's More menu stays.
      add.hidden = true;
      pills.forEach(pill => { pill.hidden = true; });
      overflow.hidden = true;
      return;
    }
    // Empty cards have no tag to measure or clamp. The add action stays.
    if (!pills.length) {
      overflow.hidden = true;
      return;
    }
    pills.forEach(pill => {
      pill.hidden = false;
      pill.style.removeProperty("max-width");
    });
    overflow.hidden = true;
    const width = mount.clientWidth;
    const gap = 5;
    const pillWidths = pills.map(pill => pill.getBoundingClientRect().width);
    const fullWidth = addWidth + pillWidths.reduce((total, value) => total + value, 0)
      + gap * pills.length;
    if (fullWidth <= width) return;
    // Preserve a single readable tag without creating a redundant +N.
    // When even 40px is unavailable, use the existing overflow control.
    const minReadableWidth = 40;
    if (pills.length === 1 && width - addWidth - gap >= minReadableWidth) {
      pills[0].style.maxWidth = (width - addWidth - gap) + "px";
      return;
    }

    // Measure an actual +N control rather than assuming its width is 38px.
    // +total is an upper bound for the glyph width of the final hidden count.
    overflow.textContent = "+" + pills.length;
    overflow.hidden = false;
    const overflowWidth = overflow.getBoundingClientRect().width;
    if (width < addWidth + gap + overflowWidth) {
      // Neither a legible label nor an expander fits. Keep the add action;
      // the active filter is visible in the toolbar, even on saved pages.
      pills.forEach(pill => { pill.hidden = true; });
      overflow.hidden = true;
      return;
    }
    let used = addWidth + gap + overflowWidth;
    let count = 0;
    for (let i = 0; i < pills.length - 1; i++) {
      const candidate = used + gap + pillWidths[i];
      if (candidate > width) break;
      used = candidate;
      count++;
    }
    // The selected tag is the first pill after renderTags priority ordering.
    // Constrain only that pill when its full name does not fit in the remaining
    // space, preserving +N and the add action at normal usable pane widths.
    if (!count && pills[0].classList.contains("ex-selected")) {
      const available = width - addWidth - overflowWidth - gap * 2;
      if (available >= minReadableWidth) {
        pills[0].style.maxWidth = available + "px";
        count = 1;
      }
    }
    for (let i = count; i < pills.length; i++) pills[i].hidden = true;
    if (count < pills.length) {
      overflow.textContent = "+" + (pills.length - count);
      overflow.setAttribute("aria-label", "展开剩余 " + (pills.length - count) + " 个标签");
    } else overflow.hidden = true;
    } finally {
      // Measuring +N briefly hides it; Chromium blurs even if it is then
      // shown again. Restore the same control before trying alternatives.
      if (focused && document.activeElement !== focused && focused.isConnected && !focused.hidden && !focused.disabled) {
        const box = focused.getBoundingClientRect();
        if (box.width >= 1 && box.height >= 1 && box.width <= mount.clientWidth + 1)
          focused.focus({ preventScroll: true });
      }
      if (focused && (document.activeElement !== focused || !focused.isConnected || focused.hidden || focused.disabled)) {
        this.focusAvailableTagAction(mount, focused.classList.contains("ex-add-tag") ? "add" : "overflow");
      }
    }
  }




}
