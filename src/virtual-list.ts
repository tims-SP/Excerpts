import { HeightIndex } from "./height-index";

/** The caller must explicitly choose which user-visible scroll position to retain. */
export type ScrollPolicy = "keep" | "top" | "anchor";

interface ScrollAnchor { path: string; index: number; offset: number; }

/** One logical row per excerpt. Date rails are only created for the first row of a day. */
export interface TimelineRow {
  path: string;
  firstOfDay: boolean;
  dayTitle: string;
  daySubtitle: string;
  estimatedHeight: number;
  /** Invalidate measured heights whenever content, grouping or card layout changes. */
  layoutKey: string;
}

interface VirtualOptions {
  batchSize: () => number;
  mount: (row: TimelineRow, index: number) => HTMLElement;
  unmount: (row: TimelineRow, element: HTMLElement) => void;
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
      if (!changed) return;
      if (precedingDelta) this.viewport.scrollTop += precedingDelta;
      this.updateSpacers();
      this.schedule();
    }) : null;
    this.viewport.addEventListener("scroll", this.handleScroll, { passive: true });
    this.lastWidth = this.host.clientWidth;
  }

  setRows(rows: readonly TimelineRow[], policy: ScrollPolicy): void {
    if (this.disposed) return;
    const anchor = policy === "anchor" ? this.captureAnchor() : null;
    const anchorTarget = anchor ? this.resolveAnchorTarget(anchor, this.rows, rows) : null;
    const priorScroll = this.viewport.scrollTop;
    // Prevent a momentary shrink to empty DOM from clamping the native scroll position.
    const oldHeight = this.heights.total();
    this.clearMounted();
    this.host.replaceChildren(this.top, this.window, this.bottom);
    this.rows = [...rows];
    this.heights = new HeightIndex(rows.map(row => {
      const measured = this.heightCache.get(row.path);
      return measured && measured.layoutKey === row.layoutKey ? measured.height : row.estimatedHeight;
    }));
    this.host.style.minHeight = Math.max(oldHeight, this.heights.total()) + "px";
    this.updateSpacers();
    if (policy === "top" || (policy === "anchor" && !rows.length)) {
      this.viewport.scrollTop = 0;
    } else if (policy === "anchor" && anchor && anchorTarget !== null) {
      this.restoreAnchor(anchor, anchorTarget);
    } else {
      this.viewport.scrollTop = priorScroll;
    }
    this.lastAllowedScroll = this.viewport.scrollTop;
    this.firstVisible = 0;
    this.render();
    this.host.style.removeProperty("min-height");
    if (policy === "anchor" && anchor && anchorTarget !== null) this.restoreAnchor(anchor, anchorTarget);
    this.lastAllowedScroll = this.viewport.scrollTop;
    this.schedule();
  }

  refresh(): void { this.schedule(); }

  /** Resize is driven by the scroll container; never replace heights on height-only changes. */
  resize(): void {
    if (this.disposed) return;
    const width = this.host.clientWidth;
    if (!width) return; // Hidden panes cannot provide trustworthy measurements.
    if (Math.abs(width - this.lastWidth) < 1) { this.schedule(); return; }
    const anchor = this.captureAnchor();
    this.lastWidth = width;
    const refreshed = this.options.resizeRows?.();
    if (refreshed && refreshed.length === this.rows.length &&
        refreshed.every((row, index) => row.path === this.rows[index].path)) this.rows = refreshed;
    this.heightCache.clear(); // Width changes invalidate line wrapping and media dimensions.
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

  private restoreAnchor(anchor: ScrollAnchor, resolvedIndex?: number): void {
    if (!this.rows.length) { this.viewport.scrollTop = 0; return; }
    const found = this.rows.findIndex(row => row.path === anchor.path);
    const index = resolvedIndex ?? (found >= 0 ? found : null);
    if (index === null) return;
    this.viewport.scrollTop = Math.max(0,
      this.hostStart() + this.heights.prefix(index) - anchor.offset);
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
    if (this.disposed || this.frame !== null || this.timer !== null) return;
    if (typeof requestAnimationFrame === "function") {
      this.frame = requestAnimationFrame(() => { this.frame = null; this.render(); });
    } else {
      this.timer = setTimeout(() => { this.timer = null; this.render(); }, 0);
    }
  }

  private render(): void {
    if (this.disposed) return;
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
    if (precedingDelta) this.viewport.scrollTop += precedingDelta;
    this.updateSpacers();
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
