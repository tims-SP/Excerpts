import { setIcon } from "obsidian";
import type { CardIndex } from "./model";
import { buildHeatmap, HeatmapDay } from "./heatmap";

/** An inline read-only calendar. It consumes the committed index; never reads the Vault. */
export class ExcerptsCalendarView {
  readonly element: HTMLElement;
  private readonly summaryEl: HTMLElement;
  private readonly desktopRowsEl: HTMLDivElement;
  private readonly mobileMonthsEl: HTMLDivElement;
  private readonly selectedEl: HTMLElement;
  private readonly warningEl: HTMLElement;
  private readonly buttons = new Map<string, HTMLButtonElement[]>();
  private selectedDate: string | null = null;
  private counts = new Map<string, number>();
  private latest = "";

  constructor(cards: readonly CardIndex[], status: "done" | "stale" | "error", onBack: () => void) {
    const shell = document.createElement("section");
    shell.className = "ex-calendar-shell";
    shell.hidden = true;
    shell.setAttribute("aria-label", "摘录日历");
    this.element = shell;

    const nav = document.createElement("div");
    nav.className = "ex-calendar-nav";
    const back = document.createElement("button");
    back.type = "button";
    back.className = "ex-calendar-back clickable-icon";
    back.setAttribute("aria-label", "返回摘录列表");
    back.title = "返回摘录列表";
    setIcon(back, "arrow-left");
    back.addEventListener("click", onBack);
    const title = document.createElement("h2");
    title.className = "ex-calendar-title";
    title.textContent = "摘录日历";
    nav.append(back, title);

    this.summaryEl = document.createElement("div");
    this.summaryEl.className = "ex-calendar-summary";
    this.warningEl = document.createElement("p");
    this.warningEl.className = "ex-calendar-warning";
    this.warningEl.setAttribute("role", "status");
    this.selectedEl = document.createElement("div");
    this.selectedEl.className = "ex-calendar-selected";
    this.selectedEl.setAttribute("role", "status");
    this.selectedEl.setAttribute("aria-live", "polite");
    this.selectedEl.hidden = true;

    const desktop = document.createElement("div");
    desktop.className = "ex-calendar-layout";
    desktop.setAttribute("aria-label", "过去一年每日摘录数量");
    const axis = document.createElement("div");
    axis.className = "ex-calendar-axis";
    for (const name of ["一", "二", "三", "四", "五", "六", "日"]) {
      const label = document.createElement("span");
      label.textContent = name;
      axis.append(label);
    }
    this.desktopRowsEl = document.createElement("div");
    this.desktopRowsEl.className = "ex-calendar-rows";
    desktop.append(axis, this.desktopRowsEl);

    this.mobileMonthsEl = document.createElement("div");
    this.mobileMonthsEl.className = "ex-calendar-mobile";
    this.mobileMonthsEl.setAttribute("aria-label", "最近月份优先的摘录日历");

    const footer = document.createElement("div");
    footer.className = "ex-calendar-footer";
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
    footer.append(legend, note);
    shell.append(nav, this.summaryEl, this.warningEl, this.selectedEl, desktop, this.mobileMonthsEl, footer);
    this.update(cards, status);
  }

  setStatus(status: "done" | "stale" | "error"): void {
    this.warningEl.hidden = status === "done";
    this.warningEl.textContent = status === "error" ?
      "上次扫描失败，当前显示旧统计。请返回摘录列表重新扫描。" : status === "stale" ?
      "索引已变化，统计可能不是最新。请返回摘录列表后手动刷新。" : "";
  }

  private createDay(day: HeatmapDay): HTMLElement {
    if (!day.inRange) {
      const empty = document.createElement("span");
      empty.className = "ex-calendar-cell ex-calendar-outside";
      empty.setAttribute("aria-hidden", "true");
      return empty;
    }
    const square = document.createElement("button");
    square.type = "button";
    square.className = "ex-calendar-cell ex-calendar-day";
    square.dataset.level = String(day.level);
    square.dataset.date = day.date;
    const label = `${day.date} · ${day.count} 条摘录`;
    square.title = label;
    square.setAttribute("aria-label", label);
    square.setAttribute("aria-pressed", String(this.selectedDate === day.date));
    square.tabIndex = this.selectedDate === day.date || (!this.selectedDate && day.date === this.latest) ? 0 : -1;
    square.addEventListener("click", () => this.selectDate(day.date));
    square.addEventListener("keydown", event => {
      const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 :
        event.key === "ArrowDown" ? 7 : event.key === "ArrowUp" ? -7 : 0;
      if (!offset) return;
      const [year, month, date] = day.date.split("-").map(Number);
      const target = new Date(year, month - 1, date + offset);
      const key = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-${String(target.getDate()).padStart(2, "0")}`;
      if (!this.buttons.has(key)) return;
      event.preventDefault();
      this.selectDate(key);
      const sameLayout = square.closest(".ex-calendar-mobile") ? ".ex-calendar-mobile" : ".ex-calendar-layout";
      this.buttons.get(key)?.find(button => button.closest(sameLayout))?.focus();
    });
    const existing = this.buttons.get(day.date) ?? [];
    existing.push(square);
    this.buttons.set(day.date, existing);
    return square;
  }

  private selectDate(key: string): void {
    if (!this.counts.has(key)) return;
    this.selectedDate = key;
    for (const [date, buttons] of this.buttons) {
      for (const button of buttons) {
        button.setAttribute("aria-pressed", String(date === key));
        button.tabIndex = date === key ? 0 : -1;
      }
    }
    const [year, month, day] = key.split("-").map(Number);
    this.selectedEl.textContent = `${year}年${month}月${day}日 · ${this.counts.get(key)} 条摘录`;
    this.selectedEl.hidden = false;
    this.placeSelectedDetail();
  }

  /** Keep one detail node inside the selected month (or below the desktop grid). */
  private placeSelectedDetail(): void {
    if (!this.selectedDate || this.selectedEl.hidden) return;
    const win = this.element.ownerDocument.defaultView;
    const mobileVisible = win?.getComputedStyle(this.mobileMonthsEl).display !== "none";
    if (mobileVisible) {
      const selectedDay = Array.from(this.mobileMonthsEl.querySelectorAll<HTMLButtonElement>(
        ".ex-calendar-day"
      )).find(button => button.dataset.date === this.selectedDate);
      const month = selectedDay?.closest<HTMLElement>(".ex-calendar-month-section");
      month?.append(this.selectedEl);
    } else {
      this.desktopRowsEl.parentElement?.after(this.selectedEl);
    }
  }

  /** Called after the page becomes visible and responsive layout can be measured. */
  onShown(): void {
    this.placeSelectedDetail();
  }

  update(cards: readonly CardIndex[], status: "done" | "stale" | "error", now = new Date()): void {
    const data = buildHeatmap(cards, now);
    this.setStatus(status);
    this.latest = data.end;
    this.summaryEl.replaceChildren();
    for (const [number, caption] of [[data.total, "过去一年摘录"], [data.activeDays, "有记录的天数"]] as const) {
      const metric = document.createElement("div");
      metric.className = "ex-calendar-metric";
      const value = document.createElement("strong");
      value.textContent = number.toLocaleString("zh-CN");
      const label = document.createElement("span");
      label.textContent = caption;
      metric.append(value, label);
      this.summaryEl.append(metric);
    }
    this.buttons.clear();
    const days = data.weeks.flat().filter(day => day.inRange);
    this.counts = new Map(days.map(day => [day.date, day.count]));
    if (this.selectedDate && !this.counts.has(this.selectedDate)) this.selectedDate = null;
    const desktopFragment = document.createDocumentFragment();
    let shownMonth = "";
    for (const [weekIndex, week] of data.weeks.entries()) {
      const row = document.createElement("div");
      row.className = "ex-calendar-week-row";
      const month = document.createElement("span");
      month.className = "ex-calendar-month";
      const valid = week.filter(day => day.inRange);
      const monthKey = valid.length ? valid[valid.length - 1].date.slice(0, 7) : "";
      if (monthKey && monthKey !== shownMonth) {
        const following = data.weeks[weekIndex + 1]?.filter(day => day.inRange);
        const followingMonth = following?.[following.length - 1]?.date.slice(0, 7);
        const omitClippedStart = weekIndex === 0 && followingMonth && followingMonth !== monthKey;
        if (!omitClippedStart) {
          const monthNumber = Number(monthKey.slice(5, 7));
          month.textContent = monthNumber + "月";
          month.title = monthKey.slice(0, 4) + "年" + monthNumber + "月";
        }
        shownMonth = monthKey;
      }
      const cells = document.createElement("div");
      cells.className = "ex-calendar-week";
      for (const day of week) cells.append(this.createDay(day));
      row.append(month, cells);
      desktopFragment.append(row);
    }
    this.desktopRowsEl.replaceChildren(desktopFragment);

    // The mobile calendar is grouped by month, newest first. Its DOM order matches
    // the visual reading order; there is no column-reverse accessibility mismatch.
    const months = new Map<string, HeatmapDay[]>();
    for (const day of days) {
      const key = day.date.slice(0, 7);
      if (!months.has(key)) months.set(key, []);
      months.get(key)!.push(day);
    }
    const mobileFragment = document.createDocumentFragment();
    for (const [key, monthDays] of [...months].reverse()) {
      const section = document.createElement("section");
      section.className = "ex-calendar-month-section";
      const heading = document.createElement("h3");
      heading.className = "ex-calendar-month-heading";
      const [year, month] = key.split("-").map(Number);
      heading.textContent = `${year}年${month}月`;
      const grid = document.createElement("div");
      grid.className = "ex-calendar-month-grid";
      for (const name of ["一", "二", "三", "四", "五", "六", "日"]) {
        const weekday = document.createElement("span");
        weekday.className = "ex-calendar-weekday";
        weekday.textContent = name;
        grid.append(weekday);
      }
      const firstDate = Number(monthDays[0].date.slice(-2));
      const startDayOfWeek = (new Date(year, month - 1, firstDate).getDay() + 6) % 7;
      for (let n = 0; n < startDayOfWeek; n++) {
        const padding = document.createElement("span");
        padding.className = "ex-calendar-padding";
        padding.setAttribute("aria-hidden", "true");
        grid.append(padding);
      }
      for (const day of monthDays) grid.append(this.createDay(day));
      section.append(heading, grid);
      mobileFragment.append(section);
    }
    this.mobileMonthsEl.replaceChildren(mobileFragment);
    if (this.selectedDate) this.selectDate(this.selectedDate);
    else { this.selectedEl.hidden = true; this.selectedEl.textContent = ""; }
  }
}
