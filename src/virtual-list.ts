import { HeightIndex } from "./height-index";

/** One logical row per excerpt. Date rails are only created for the first row of a day. */
export interface TimelineRow {
  path: string;
  firstOfDay: boolean;
  dayTitle: string;
  daySubtitle: string;
  estimatedHeight: number;
}

interface VirtualOptions {
  batchSize: () => number;
  mount: (row: TimelineRow, index: number) => HTMLElement;
  unmount: (row: TimelineRow, element: HTMLElement) => void;
  pinnedPath?: () => string | null;
  onScrollBlocked?: () => void;
}

export class VirtualTimeline {
  private rows: TimelineRow[] = [];
  private heights = new HeightIndex([]);
  private readonly top = document.createElement("div");
  private readonly window = document.createElement("div");
  private readonly bottom = document.createElement("div");
  private readonly mounted = new Map<number, HTMLElement>();
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
        const delta = this.heights.set(index, height);
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

  setRows(rows: readonly TimelineRow[], resetScroll = true): void {
    this.clearMounted();
    // An empty-state message may have been appended after the preceding snapshot.
    this.host.replaceChildren(this.top, this.window, this.bottom);
    this.rows = [...rows];
    this.heights = new HeightIndex(rows.map(row => row.estimatedHeight));
    if (resetScroll) {
      const relativeTop = this.host.getBoundingClientRect().top -
        this.viewport.getBoundingClientRect().top + this.viewport.scrollTop;
      this.viewport.scrollTop = Math.max(0, relativeTop);
    }
    this.lastAllowedScroll = this.viewport.scrollTop;
    this.firstVisible = 0;
    this.updateSpacers();
    this.render();
  }

  refresh(): void { this.schedule(); }

  /** Call on container width changes; old heights are no longer trustworthy. */
  resize(): void {
    if (this.disposed) return;
    const width = this.host.clientWidth;
    if (width && Math.abs(width - this.lastWidth) < 1) { this.schedule(); return; }
    this.lastWidth = width;
    const anchorIndex = this.firstVisible;
    const anchorDelta = this.currentOffset() - this.heights.prefix(anchorIndex);
    this.heights = new HeightIndex(this.rows.map(row => row.estimatedHeight));
    this.viewport.scrollTop = Math.max(0, this.hostStart() +
      this.heights.prefix(anchorIndex) + anchorDelta);
    this.updateSpacers();
    this.schedule();
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
      this.options.unmount(this.rows[index], element);
      element.remove();
      this.mounted.delete(index);
    }
    // Mount missing rows in their index order without detaching surviving DOM nodes.
    for (let index = start; index < end; index++) {
      if (this.mounted.has(index)) continue;
      const element = this.options.mount(this.rows[index], index);
      element.dataset.virtualIndex = String(index);
      const next = [...this.mounted.keys()].filter(key => key > index).sort((a, b) => a - b)[0];
      this.window.insertBefore(element, next === undefined ? null : this.mounted.get(next)!);
      this.mounted.set(index, element);
      this.observer?.observe(element);
      const measured = element.getBoundingClientRect().height;
      if (measured > 0) this.heights.set(index, measured);
    }
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
    this.host.replaceChildren();
  }
}
