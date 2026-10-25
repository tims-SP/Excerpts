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
  cursor.setDate(cursor.getDate() - (cursor.getDay() + 6) % 7);
  const last = new Date(today);
  last.setDate(last.getDate() + 6 - (last.getDay() + 6) % 7);
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

