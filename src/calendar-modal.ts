import { App, Modal } from "obsidian";
import type { CardIndex } from "./model";
import { buildHeatmap } from "./heatmap";

/** Read-only activity calendar. It consumes a view snapshot, never scans the Vault. */
export class ExcerptsCalendarModal extends Modal {
  private readonly scrollEl: HTMLDivElement;
  private readonly summaryEl: HTMLElement;
  private readonly rowsEl: HTMLDivElement;
  private readonly warningEl: HTMLElement;
  private readonly onDismiss: () => void;

  constructor(app: App, cards: readonly CardIndex[], stale: boolean, onDismiss: () => void) {
    super(app);
    this.onDismiss = onDismiss;
    this.modalEl.addClass("ex-calendar-modal");
    this.contentEl.empty();
    const shell = document.createElement("section");
    shell.className = "ex-calendar-shell";
    shell.setAttribute("aria-label", "摘录日历");

    const header = document.createElement("h2");
    header.className = "ex-calendar-title";
    header.textContent = "摘录日历";

    this.summaryEl = document.createElement("div");
    this.summaryEl.className = "ex-calendar-summary";

    this.warningEl = document.createElement("p");
    this.warningEl.className = "ex-calendar-warning";
    this.warningEl.setAttribute("role", "status");

    this.scrollEl = document.createElement("div");
    this.scrollEl.className = "ex-calendar-scroll";
    this.scrollEl.setAttribute("role", "region");
    this.scrollEl.setAttribute("aria-label", "过去一年每日摘录数量");

    const layout = document.createElement("div");
    layout.className = "ex-calendar-layout";
    const axis = document.createElement("div");
    axis.className = "ex-calendar-axis";
    for (const name of ["一", "二", "三", "四", "五", "六", "日"]) {
      const label = document.createElement("span");
      label.textContent = name;
      axis.append(label);
    }
    this.rowsEl = document.createElement("div");
    this.rowsEl.className = "ex-calendar-rows";
    layout.append(axis, this.rowsEl);
    this.scrollEl.append(layout);

    const bottom = document.createElement("div");
    bottom.className = "ex-calendar-footer";
    const note = document.createElement("span");
    note.textContent = "按 Markdown 文件创建时间统计";
    const legend = document.createElement("div");
    legend.className = "ex-calendar-legend";
    const less = document.createElement("span");
    less.textContent = "少";
    legend.append(less);
    for (let level = 0; level <= 4; level++) {
      const sample = document.createElement("span");
      sample.className = "ex-calendar-cell";
      sample.dataset.level = String(level);
      sample.setAttribute("aria-hidden", "true");
      legend.append(sample);
    }
    const more = document.createElement("span");
    more.textContent = "多";
    legend.append(more);
    bottom.append(note, legend);
    shell.append(header, this.summaryEl, this.warningEl, this.scrollEl, bottom);
    this.contentEl.append(shell);
    this.update(cards, stale);
  }

  onOpen(): void {
    // The vertical layout starts with recent dates; scrolling remains confined to this panel.
    const positionLatest = () => {
      if (this.scrollEl.isConnected) this.scrollEl.scrollTop = this.scrollEl.scrollHeight;
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(positionLatest);
    else positionLatest();
  }

  onClose(): void {
    this.onDismiss();
  }

  setStale(stale: boolean): void {
    this.warningEl.hidden = !stale;
    this.warningEl.textContent = stale ? "索引待刷新，当前统计可能不是最新" : "";
  }

  update(cards: readonly CardIndex[], stale: boolean, now = new Date()): void {
    const data = buildHeatmap(cards, now);
    this.setStale(stale);
    this.summaryEl.replaceChildren();
    for (const [number, caption] of [
      [data.total, "过去一年摘录"],
      [data.activeDays, "有记录的天数"]
    ] as const) {
      const metric = document.createElement("div");
      metric.className = "ex-calendar-metric";
      const value = document.createElement("strong");
      value.textContent = number.toLocaleString("zh-CN");
      const label = document.createElement("span");
      label.textContent = caption;
      metric.append(value, label);
      this.summaryEl.append(metric);
    }
    const fragment = document.createDocumentFragment();
    let shownMonth = "";
    for (const week of data.weeks) {
      const row = document.createElement("div");
      row.className = "ex-calendar-week-row";
      const month = document.createElement("span");
      month.className = "ex-calendar-month";
      const valid = week.filter(day => day.inRange);
      // Label the first week containing a new month, including midweek boundaries.
      const monthKey = valid.length ? valid[valid.length - 1].date.slice(0, 7) : "";
      if (monthKey && monthKey !== shownMonth) {
        const monthNumber = Number(monthKey.slice(5, 7));
        month.textContent = monthNumber + "月";
        month.title = monthKey.slice(0, 4) + "年" + monthNumber + "月";
        if (monthNumber === 1 || !shownMonth) month.dataset.year = monthKey.slice(0, 4);
        shownMonth = monthKey;
      }
      const cells = document.createElement("div");
      cells.className = "ex-calendar-week";
      for (const day of week) {
        const square = document.createElement("span");
        square.className = "ex-calendar-cell";
        square.dataset.level = String(day.level);
        if (!day.inRange) square.classList.add("ex-calendar-outside");
        else square.title = day.date + " · " + day.count + " 条摘录";
        square.setAttribute("aria-hidden", "true");
        cells.append(square);
      }
      row.append(month, cells);
      fragment.append(row);
    }
    this.rowsEl.replaceChildren(fragment);
  }
}
