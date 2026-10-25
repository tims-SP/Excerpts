import type { CardIndex } from "./model";

export interface HeatmapDay {
  date: string;
  count: number;
  level: number;
  inRange: boolean;
}
export interface HeatmapData {
  weeks: HeatmapDay[][];
  total: number;
  activeDays: number;
  start: string;
  end: string;
}
function localKey(date: Date): string {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") +
    "-" + String(date.getDate()).padStart(2, "0");
}
function intensity(count: number): number {
  if (!count) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}
/** One file contributes once on its local creation day; never infer missing timestamps. */
export function buildHeatmap(cards: readonly Pick<CardIndex, "ctime">[],
  now: Date = new Date()): HeatmapData {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(today);
  start.setDate(start.getDate() - 364);
  const startKey = localKey(start);
  const endKey = localKey(today);
  const counts = new Map<string, number>();
  for (const card of cards) {
    if (!Number.isFinite(card.ctime) || card.ctime <= 0) continue;
    const created = new Date(card.ctime);
    if (!Number.isFinite(created.getTime())) continue;
    const key = localKey(created);
    if (key < startKey || key > endKey) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const cursor = new Date(start);
  cursor.setDate(cursor.getDate() - cursor.getDay());
  const last = new Date(today);
  last.setDate(last.getDate() + 6 - last.getDay());
  const weeks: HeatmapDay[][] = [];
  while (cursor <= last) {
    const days: HeatmapDay[] = [];
    for (let i = 0; i < 7; i++) {
      const date = localKey(cursor);
      const inRange = date >= startKey && date <= endKey;
      const count = inRange ? (counts.get(date) ?? 0) : 0;
      days.push({ date, count, level: intensity(count), inRange });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(days);
  }
  let total = 0;
  for (const count of counts.values()) total += count;
  return { weeks, total, activeDays: counts.size, start: startKey, end: endKey };
}

/** Lightweight, independent, read-only view of existing in-memory file metadata. */
export class HeatmapPanel {
  readonly element: HTMLElement;
  private readonly body: HTMLElement;
  private readonly scroll: HTMLElement;
  private readonly months: HTMLElement;
  private readonly weeks: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly note: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private expanded = true;
  private initialized = false;

  constructor() {
    this.element = document.createElement("section");
    this.element.className = "ex-heatmap";
    this.element.hidden = true;
    this.element.setAttribute("aria-label", "摘录日历热力图");
    const head = document.createElement("div");
    head.className = "ex-heatmap-head";
    const title = document.createElement("div");
    title.className = "ex-heatmap-heading";
    const name = document.createElement("h3");
    name.textContent = "摘录日历";
    this.summary = document.createElement("span");
    this.summary.className = "ex-heatmap-summary";
    title.append(name, this.summary);
    this.toggle = document.createElement("button");
    this.toggle.type = "button";
    this.toggle.className = "ex-heatmap-toggle";
    this.toggle.setAttribute("aria-expanded", "true");
    this.toggle.textContent = "收起";
    head.append(title, this.toggle);
    this.body = document.createElement("div");
    this.body.className = "ex-heatmap-body";
    this.scroll = document.createElement("div");
    this.scroll.className = "ex-heatmap-scroll";
    this.scroll.setAttribute("aria-label", "过去一年每日摘录数量");
    const axis = document.createElement("div");
    axis.className = "ex-heatmap-axis";
    for (const label of ["", "一", "", "三", "", "五", ""]) {
      const day = document.createElement("span");
      day.textContent = label;
      axis.append(day);
    }
    const grid = document.createElement("div");
    grid.className = "ex-heatmap-grid";
    this.months = document.createElement("div");
    this.months.className = "ex-heatmap-months";
    this.weeks = document.createElement("div");
    this.weeks.className = "ex-heatmap-weeks";
    grid.append(this.months, this.weeks);
    this.scroll.append(axis, grid);
    const foot = document.createElement("div");
    foot.className = "ex-heatmap-foot";
    this.detail = document.createElement("span");
    this.detail.className = "ex-heatmap-detail";
    this.detail.setAttribute("aria-live", "polite");
    const legend = document.createElement("div");
    legend.className = "ex-heatmap-legend";
    const less = document.createElement("span");
    less.textContent = "少";
    legend.append(less);
    for (let level = 0; level <= 4; level++) {
      const sample = document.createElement("span");
      sample.className = "ex-heatmap-cell";
      sample.dataset.level = String(level);
      sample.setAttribute("aria-hidden", "true");
      legend.append(sample);
    }
    const more = document.createElement("span");
    more.textContent = "多";
    legend.append(more);
    foot.append(this.detail, legend);
    this.note = document.createElement("p");
    this.note.className = "ex-heatmap-note";
    this.body.append(this.scroll, foot, this.note);
    this.element.append(head, this.body);
    this.toggle.addEventListener("click", () => {
      this.expanded = !this.expanded;
      this.body.hidden = !this.expanded;
      this.toggle.textContent = this.expanded ? "收起" : "展开";
      this.toggle.setAttribute("aria-expanded", String(this.expanded));
      if (this.expanded && !this.initialized) this.scroll.scrollLeft = this.scroll.scrollWidth;
    });
  }

  setStale(stale: boolean): void {
    if (this.element.hidden) return;
    this.element.dataset.stale = String(stale);
    this.note.textContent = stale
      ? "索引待刷新，日历统计可能不是最新"
      : "按 Markdown 文件创建时间统计 · 不受搜索和标签筛选影响";
  }

  update(cards: readonly CardIndex[], now: Date = new Date()): void {
    const data = buildHeatmap(cards, now);
    const firstRender = !this.initialized;
    this.element.hidden = false;
    this.summary.textContent = "过去一年 · " + data.total.toLocaleString("zh-CN") +
      " 条 · " + data.activeDays + " 天有记录";
    this.detail.textContent = "点击有记录的日期查看数量";
    const monthNodes = document.createDocumentFragment();
    const weekNodes = document.createDocumentFragment();
    let previousMonth = "";
    for (const week of data.weeks) {
      const month = document.createElement("span");
      month.className = "ex-heatmap-month";
      const first = week.find(day => day.inRange);
      if (first) {
        const current = first.date.slice(0, 7);
        if (current !== previousMonth) {
          month.textContent = String(Number(current.slice(5, 7))) + "月";
          previousMonth = current;
        }
      }
      monthNodes.append(month);
      const column = document.createElement("div");
      column.className = "ex-heatmap-week";
      for (const day of week) {
        const cell = document.createElement(day.inRange && day.count ? "button" : "span");
        cell.className = "ex-heatmap-cell";
        cell.dataset.level = String(day.level);
        if (!day.inRange) cell.classList.add("ex-heatmap-outside");
        if (day.inRange) {
          const description = day.date + " · " + day.count + " 条摘录";
          cell.title = description;
          if (day.count) {
            (cell as HTMLButtonElement).type = "button";
            cell.setAttribute("aria-label", description);
            cell.addEventListener("click", () => { this.detail.textContent = description; });
          } else {
            cell.setAttribute("aria-hidden", "true");
          }
        } else cell.setAttribute("aria-hidden", "true");
        column.append(cell);
      }
      weekNodes.append(column);
    }
    this.months.replaceChildren(monthNodes);
    this.weeks.replaceChildren(weekNodes);
    if (firstRender) this.scroll.scrollLeft = this.scroll.scrollWidth;
    this.initialized = true;
  }
}
