import { HeightIndex } from "./height-index";

/** The caller must explicitly choose which user-visible scroll position to retain. */
export type ScrollPolicy = "keep" | "top" | "anchor" | "results";

/** Viewport-relative top edge of the selected reading surface. */
export interface AnchorTarget {
  path: string;
  offset: number;
  /** Omitted for legacy row-based callers. */
  surface?: "row" | "card";
}
interface ScrollAnchor extends AnchorTarget { index: number; }

/** One logical row per excerpt. Date rails are only created for the first row of a day. */
export interface TimelineRow {
  path: string;
  firstOfDay: boolean;
  dayTitle: string;
  daySubtitle: string;
  estimatedHeight: number;
  /** Invalidate measured heights whenever content, grouping or card layout changes. */
  layoutKey: string;
  /** Content revision independent from date rail layout, position and active filter. */
  contentKey?: string;
}

interface VirtualOptions {
  batchSize: () => number;
  mount: (row: TimelineRow, index: number) => HTMLElement;
  unmount: (row: TimelineRow, element: HTMLElement) => void;
  update?: (row: TimelineRow, index: number, element: HTMLElement, previous: TimelineRow) => void;
  /** User-initiated filter changes focus the result header, not the composer. */
  resultsTop?: () => number;
  pinnedPath?: () => string | null;
  onScrollBlocked?: () => void;
  resizeRows?: () => TimelineRow[];
}

export class VirtualTimeline {
  private rows: TimelineRow[] = [];
  private heights = new HeightIndex([]);
  private readonly top = document.createElement("div");
  private readonly window = document.createElement("div");
  private readonly bottom = document.createElement("div");
  private readonly mounted = new Map<number, HTMLElement>();
  /** Session-only measured-height reuse; never stores Markdown content. */
  private readonly heightCache = new Map<string, { layoutKey: string; height: number }>();
  private readonly mountedHeights = new Map<number, number>();
  private mountedHeightSum = 0;
  private readonly observer: ResizeObserver | null;
  private frame: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private firstVisible = 0;
  private lastAllowedScroll = 0;
  private blockedNotice = false;
  private disposed = false;
  private suspended = false;
  private lastWidth = 0;

  constructor(private readonly host: HTMLElement, private readonly viewport: HTMLElement,
    private readonly options: VirtualOptions) {
    this.top.className = "ex-virtual-top-spacer";
    this.window.className = "ex-virtual-window";
    this.bottom.className = "ex-virtual-bottom-spacer";
    this.top.setAttribute("aria-hidden", "true");
    this.bottom.setAttribute("aria-hidden", "true");
    this.host.replaceChildren(this.top, this.window, this.bottom);
    this.observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(entries => {
      if (this.suspended || this.disposed) return;
      let precedingDelta = 0;
      let changed = false;
      for (const entry of entries) {
        const index = Number((entry.target as HTMLElement).dataset.virtualIndex);
        if (!this.mounted.has(index) || this.mounted.get(index) !== entry.target) continue;
        const height = entry.target.getBoundingClientRect().height;
        if (height <= 0) continue;
        const delta = this.recordMeasurement(index, height);
        if (Math.abs(delta) < 0.5) continue;
        changed = true;
        if (index < this.firstVisible) precedingDelta += delta;
      }
      if (!changed || this.suspended) return;
      if (precedingDelta) this.viewport.scrollTop += precedingDelta;
      this.updateSpacers();
      this.schedule();
    }) : null;
    this.viewport.addEventListener("scroll", this.handleScroll, { passive: true });
    this.lastWidth = this.host.clientWidth;
  }

  setRows(rows: readonly TimelineRow[], policy: ScrollPolicy,
    requestedAnchor?: AnchorTarget, invalidatePaths?: ReadonlySet<string>): void {
    if (this.disposed) return;
    if (this.suspended) throw new Error("不能重绘隐藏的摘录列表");
    const previous = this.rows;
    const anchor = policy === "anchor"
      ? requestedAnchor
        ? { ...requestedAnchor, index: previous.findIndex(row => row.path === requestedAnchor.path) }
        : this.captureAnchor()
      : null;
    const nextByPath = new Map(rows.map((row, index) => [row.path, index]));
    // A clicked-card anchor has no substitute: do not silently jump to a
    // surviving neighbour if the clicked card disappeared from the results.
    const anchorTarget = anchor ? requestedAnchor
      ? (nextByPath.get(anchor.path) ?? null)
      : this.resolveAnchorTarget(anchor, previous, rows) : null;
    // Date rails can move when a filter promotes an excerpt to the first of
    // its day. The card's top is not necessarily the timeline row's top.
    const sourceRow = anchor?.surface === "card" ? this.mounted.get(anchor.index) : undefined;
    const sourceCard = sourceRow?.querySelector<HTMLElement>(".ex-card");
    const missingCardAnchor = anchor?.surface === "card" && (!sourceCard || !sourceCard.isConnected);
    const cardInset = sourceCard && sourceRow
      ? sourceCard.getBoundingClientRect().top - sourceRow.getBoundingClientRect().top : 0;
    const priorScroll = this.viewport.scrollTop;
    const oldHeight = this.heights.total();
    const oldMounted = [...this.mounted];

    this.rows = [...rows];
    this.heights = new HeightIndex(rows.map(row => {
      const measured = this.heightCache.get(row.path);
      return measured && measured.layoutKey === row.layoutKey ? measured.height : row.estimatedHeight;
    }));
    this.mounted.clear();
    this.mountedHeights.clear();
    this.mountedHeightSum = 0;
    this.host.style.minHeight = Math.max(oldHeight, this.heights.total()) + "px";

    for (const [oldIndex, element] of oldMounted) {
      const oldRow = previous[oldIndex];
      const newIndex = oldRow ? nextByPath.get(oldRow.path) : undefined;
      const next = newIndex === undefined ? undefined : rows[newIndex];
      const sameContent = Boolean(next && (
        oldRow.contentKey !== undefined || next.contentKey !== undefined
          ? oldRow.contentKey === next.contentKey
          : oldRow.layoutKey === next.layoutKey
      ));
      if (!next || !sameContent || invalidatePaths?.has(oldRow.path) ||
          (oldRow.layoutKey !== next.layoutKey && !this.options.update)) {
        this.observer?.unobserve(element);
        if (oldRow) this.options.unmount(oldRow, element);
        element.remove();
        continue;
      }
      element.dataset.virtualIndex = String(newIndex);
      this.mounted.set(newIndex!, element);
      this.options.update?.(next, newIndex!, element, oldRow);
      // Completely unchanged rows already have a valid measurement; avoid a
      // synchronous layout read on every filter or search result commit.
      const cached = this.heightCache.get(oldRow.path);
      const height = oldRow.layoutKey === next.layoutKey && cached?.layoutKey === next.layoutKey
        ? cached.height : element.getBoundingClientRect().height;
      if (height > 0 && Number.isFinite(height)) this.recordMeasurement(newIndex!, height);
    }
    // Empty-state siblings from the previous result must not survive a new commit.
    for (const child of Array.from(this.host.children)) {
      if (child !== this.top && child !== this.window && child !== this.bottom)
        child.remove();
    }
    this.updateSpacers();
    if (policy === "top" || (policy === "anchor" && !rows.length && !requestedAnchor)) {
      this.viewport.scrollTop = 0;
    } else if (policy === "results" ||
      (policy === "anchor" && requestedAnchor && (anchorTarget === null || missingCardAnchor))) {
      this.viewport.scrollTop = Math.max(0, this.options.resultsTop?.() ?? 0);
    } else if (policy === "anchor" && anchor && anchorTarget !== null) {
      this.restoreAnchor(anchor, anchorTarget, cardInset);
    } else {
      this.viewport.scrollTop = priorScroll;
    }
    this.lastAllowedScroll = this.viewport.scrollTop;
    this.firstVisible = 0;
    this.render();
    this.host.style.removeProperty("min-height");
    if (policy === "anchor" && anchor && anchorTarget !== null && !missingCardAnchor) {
      if (anchor.surface === "card") {
        // Correct once from the mounted card's final date-rail and padding.
        // No animation frame loop or extra visual refresh is necessary.
        const current = this.mounted.get(anchorTarget)?.querySelector<HTMLElement>(".ex-card");
        if (current?.isConnected) {
          const delta = current.getBoundingClientRect().top -
            this.viewport.getBoundingClientRect().top - anchor.offset;
          if (Math.abs(delta) > 0.5) this.viewport.scrollTop += delta;
        }
      } else this.restoreAnchor(anchor, anchorTarget);
    }
    this.lastAllowedScroll = this.viewport.scrollTop;
    this.schedule();
  }

  /** Hide the feed without unmounting its Markdown renderers or measuring zero-height rows. */
  setSuspended(value: boolean): void {
    if (this.disposed) return;
    this.suspended = value;
    if (!value) this.schedule();
  }
  refresh(): void { this.schedule(); }

  /** Resize is driven by the scroll container; never replace heights on height-only changes. */
  resize(): void {
    if (this.disposed || this.suspended) return;
    const width = this.host.clientWidth;
    if (!width) return; // Hidden panes cannot provide trustworthy measurements.
    if (Math.abs(width - this.lastWidth) < 1) { this.schedule(); return; }
    const anchor = this.captureAnchor();
    this.lastWidth = width;
    const refreshed = this.options.resizeRows?.();
    if (refreshed && refreshed.length === this.rows.length &&
        refreshed.every((row, index) => row.path === this.rows[index].path)) this.rows = refreshed;
    this.resetMeasuredHeights(anchor);
  }

  /** Only call when typography affecting row geometry actually changes. */
  invalidateTextMetrics(): void {
    if (this.disposed || this.suspended || !this.host.clientWidth) return;
    this.resetMeasuredHeights(this.captureAnchor());
  }

  /** Share the existing width-change anchor-preserving invalidation path. */
  private resetMeasuredHeights(anchor: ScrollAnchor | null): void {
    this.heightCache.clear();
    this.mountedHeights.clear();
    this.mountedHeightSum = 0;
    this.heights = new HeightIndex(this.rows.map(row => row.estimatedHeight));
    this.remeasureMountedRows();
    this.updateSpacers();
    if (anchor) this.restoreAnchor(anchor);
    this.schedule();
  }

  /** No DOM measurements occur when the batch-size getter is called on scrolling. */
  getMeasuredAverageHeight(): number | null {
    return this.mountedHeights.size ? this.mountedHeightSum / this.mountedHeights.size : null;
  }

  private recordMeasurement(index: number, height: number): number {
    if (!Number.isFinite(height) || height <= 0 || !this.rows[index]) return 0;
    const old = this.mountedHeights.get(index);
    this.mountedHeightSum += height - (old ?? 0);
    this.mountedHeights.set(index, height);
    const row = this.rows[index];
    // The 512-entry bound also prevents unbounded caches in very long sessions.
    this.heightCache.delete(row.path);
    this.heightCache.set(row.path, { layoutKey: row.layoutKey, height });
    if (this.heightCache.size > 512) {
      const oldest = this.heightCache.keys().next().value as string | undefined;
      if (oldest !== undefined) this.heightCache.delete(oldest);
    }
    return this.heights.set(index, height);
  }

  private forgetMountedHeight(index: number): void {
    const measured = this.mountedHeights.get(index);
    if (measured !== undefined) {
      this.mountedHeightSum -= measured;
      this.mountedHeights.delete(index);
    }
  }

  /** Measure existing mounted rows without remounting or touching their Markdown renderers. */
  private remeasureMountedRows(): void {
    for (const [index, element] of this.mounted) {
      const height = element.getBoundingClientRect().height;
      if (height > 0 && Number.isFinite(height)) this.recordMeasurement(index, height);
    }
  }

  /** Null means the user is still above the feed, e.g. reading the composer. */
  private captureAnchor(): ScrollAnchor | null {
    if (!this.rows.length || this.viewport.scrollTop < this.hostStart()) return null;
    const index = this.heights.indexAt(this.currentOffset());
    const row = this.rows[index];
    if (!row) return null;
    const element = this.mounted.get(index);
    const box = element?.getBoundingClientRect();
    const offset = box && box.height > 0 && Number.isFinite(box.top)
      ? box.top - this.viewport.getBoundingClientRect().top
      : this.hostStart() + this.heights.prefix(index) - this.viewport.scrollTop;
    return { path: row.path, index, offset };
  }

  private resolveAnchorTarget(
    anchor: ScrollAnchor, previous: readonly TimelineRow[], next: readonly TimelineRow[]
  ): number | null {
    if (!next.length) return null;
    const nextByPath = new Map(next.map((row, index) => [row.path, index]));
    const exact = nextByPath.get(anchor.path);
    if (exact !== undefined) return exact;
    // Resolve using the OLD order, not the old numeric index in the new array.
    for (let i = anchor.index + 1; i < previous.length; i++) {
      const found = nextByPath.get(previous[i].path);
      if (found !== undefined) return found;
    }
    for (let i = anchor.index - 1; i >= 0; i--) {
      const found = nextByPath.get(previous[i].path);
      if (found !== undefined) return found;
    }
    // If a filter replaced the whole feed, no neighbor has the same identity.
    return null;
  }

  private restoreAnchor(anchor: ScrollAnchor, resolvedIndex?: number, inset = 0): void {
    if (!this.rows.length) { this.viewport.scrollTop = 0; return; }
    const found = this.rows.findIndex(row => row.path === anchor.path);
    const index = resolvedIndex ?? (found >= 0 ? found : null);
    if (index === null) return;
    this.viewport.scrollTop = Math.max(0,
      this.hostStart() + this.heights.prefix(index) + inset - anchor.offset);
  }

  private readonly handleScroll = (): void => { this.schedule(); };

  private hostStart(): number {
    return this.host.getBoundingClientRect().top -
      this.viewport.getBoundingClientRect().top + this.viewport.scrollTop;
  }

  private currentOffset(): number {
    return Math.max(0, this.viewport.scrollTop - this.hostStart());
  }

  private schedule(): void {
    if (this.disposed || this.suspended || this.frame !== null || this.timer !== null) return;
    if (typeof requestAnimationFrame === "function") {
      this.frame = requestAnimationFrame(() => { this.frame = null; this.render(); });
    } else {
      this.timer = setTimeout(() => { this.timer = null; this.render(); }, 0);
    }
  }

  private render(): void {
    if (this.disposed || this.suspended) return;
    const count = this.rows.length;
    if (!count) { this.clearMounted(); this.updateSpacers(); return; }
    const vh = Math.max(1, this.viewport.clientHeight || 800);
    const position = this.currentOffset();
    const visibleFirst = this.heights.indexAt(position);
    const visibleLast = Math.min(count, this.heights.indexAt(position + vh) + 1);
    let start = this.heights.indexAt(Math.max(0, position - vh));
    let end = Math.min(count, this.heights.indexAt(position + vh * 2) + 1);
    // The configured batch limits speculative buffer mounts, never the visible viewport.
    const budget = Math.max(visibleLast - visibleFirst, this.options.batchSize());
    if (end - start > budget) {
      const spare = budget - (visibleLast - visibleFirst);
      const before = Math.min(visibleFirst - start, Math.floor(spare / 2));
      const after = Math.min(end - visibleLast, spare - before);
      start = Math.max(0, visibleFirst - before);
      end = Math.min(count, visibleLast + after);
      const unused = budget - (end - start);
      if (unused) start = Math.max(0, start - unused);
    }
    const pinned = this.options.pinnedPath?.();
    if (pinned && !this.rows.slice(start, end).some(row => row.path === pinned)) {
      if (!this.blockedNotice) {
        this.blockedNotice = true;
        this.options.onScrollBlocked?.();
      }
      this.viewport.scrollTop = this.lastAllowedScroll;
      return;
    }
    this.blockedNotice = false;
    this.lastAllowedScroll = this.viewport.scrollTop;
    this.firstVisible = visibleFirst;
    for (const [index, element] of [...this.mounted]) {
      if (index >= start && index < end) continue;
      this.observer?.unobserve(element);
      this.forgetMountedHeight(index);
      this.options.unmount(this.rows[index], element);
      element.remove();
      this.mounted.delete(index);
    }
    // Mount missing rows in their index order without detaching surviving DOM nodes.
    let precedingDelta = 0;
    for (let index = start; index < end; index++) {
      if (this.mounted.has(index)) continue;
      const element = this.options.mount(this.rows[index], index);
      element.dataset.virtualIndex = String(index);
      const next = [...this.mounted.keys()].filter(key => key > index).sort((a, b) => a - b)[0];
      this.window.insertBefore(element, next === undefined ? null : this.mounted.get(next)!);
      this.mounted.set(index, element);
      this.observer?.observe(element);
      const measured = element.getBoundingClientRect().height;
      if (measured > 0) {
        const delta = this.recordMeasurement(index, measured);
        if (index < visibleFirst) precedingDelta += delta;
      }
    }
    // Reused rows can now have new indices. A native insertBefore of a
    // connected row can blur its focused descendant (Chromium/WebView).
    // Preserve focus only when an actual retained row moves; never hijack
    // focus from the search box or resurrect an unmounted/disabled control.
    const active = this.window.ownerDocument.activeElement;
    const focused = active && this.window.contains(active) &&
      typeof (active as HTMLElement).focus === "function" ? active as HTMLElement : null;
    let movedRetainedRow = false;
    let cursor: ChildNode | null = this.window.firstChild;
    for (let index = start; index < end; index++) {
      const element = this.mounted.get(index);
      if (!element) continue;
      if (element === cursor) cursor = cursor.nextSibling;
      else {
        if (element.isConnected) movedRetainedRow = true;
        this.window.insertBefore(element, cursor);
      }
    }
    if (precedingDelta) this.viewport.scrollTop += precedingDelta;
    this.updateSpacers();
    if (movedRetainedRow && focused && focused.isConnected &&
        this.window.contains(focused) && !focused.closest("[hidden], [inert]") &&
        !("disabled" in focused && focused.disabled) &&
        this.window.ownerDocument.activeElement !== focused) {
      focused.focus({ preventScroll: true });
    }
  }

  private updateSpacers(): void {
    if (!this.mounted.size) {
      this.top.style.height = "0px";
      this.bottom.style.height = this.heights.total() + "px";
      return;
    }
    const indices = [...this.mounted.keys()];
    const first = Math.min(...indices);
    const last = Math.max(...indices) + 1;
    this.top.style.height = this.heights.prefix(first) + "px";
    this.bottom.style.height = Math.max(0, this.heights.total() - this.heights.prefix(last)) + "px";
  }

  private clearMounted(): void {
    for (const [index, element] of this.mounted) {
      this.observer?.unobserve(element);
      this.forgetMountedHeight(index);
      this.options.unmount(this.rows[index], element);
    }
    this.mounted.clear();
    this.window.replaceChildren();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    if (this.timer !== null) clearTimeout(this.timer);
    this.viewport.removeEventListener("scroll", this.handleScroll);
    this.observer?.disconnect();
    this.clearMounted();
    this.heightCache.clear();
    this.host.replaceChildren();
  }
}
