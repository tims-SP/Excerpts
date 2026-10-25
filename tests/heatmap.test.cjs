const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildHeatmap } = require("../.test-compiled/heatmap.js");
const card = (date) => ({ ctime: date.getTime() });
const pick = (data, key) => data.weeks.flat().find(day => day.date === key);

test("heatmap counts same-day files once each without reading Markdown", () => {
  const now = new Date(2026, 9, 25, 12);
  const data = buildHeatmap([
    card(new Date(2026, 9, 25, 0, 1)),
    card(new Date(2026, 9, 25, 23, 59)),
    card(new Date(2026, 9, 24, 11)),
    card(new Date(2025, 9, 24, 11)),
    card(new Date(2026, 9, 26, 1)),
    { ctime: 0 }, { ctime: NaN }, { ctime: Infinity }
  ], now);
  assert.equal(data.total, 3);
  assert.equal(data.activeDays, 2);
  assert.equal(pick(data, "2026-10-25").count, 2);
  assert.equal(pick(data, "2026-10-25").level, 2);
  assert.equal(pick(data, "2026-10-26"), undefined, "calendar stops at the final Sunday");
  assert.ok(data.weeks.every(week => week.length === 7));
  assert.equal(data.weeks[0][0].date <= data.start, true);
});

test("heatmap preserves calendar days through leap days and month boundaries", () => {
  const data = buildHeatmap([
    card(new Date(2024, 1, 29, 23, 59)),
    card(new Date(2024, 2, 1, 0, 1))
  ], new Date(2024, 2, 1, 18));
  assert.equal(data.total, 2);
  assert.equal(pick(data, "2024-02-29").count, 1);
  assert.equal(pick(data, "2024-03-01").count, 1);
  assert.equal(pick(data, "2024-03-02").inRange, false);
});

test("heatmap uses fixed absolute levels and ignores old or future dates", () => {
  const now = new Date(2026, 9, 25);
  const cards = [];
  for (let n = 0; n < 7; n++) cards.push(card(new Date(2026, 9, 20, 12)));
  const data = buildHeatmap(cards, now);
  assert.equal(pick(data, "2026-10-20").level, 4);
  assert.equal(pick(data, "2026-10-19").level, 0);
  assert.equal(data.total, 7);
  assert.equal(data.weeks.at(-1).at(-1).date >= data.end, true);
});

test("calendar aligns rows to Monday and spans New Year correctly", () => {
  const data = buildHeatmap([
    card(new Date(2026, 0, 1, 9)),
    card(new Date(2025, 11, 31, 9))
  ], new Date(2026, 0, 5, 12));
  assert.equal(new Date(data.weeks[0][0].date + "T12:00:00").getDay(), 1);
  assert.deepEqual(data.weeks.flat().filter(day => day.count).map(day => day.date),
    ["2025-12-31", "2026-01-01"]);
  assert.equal(data.weeks.at(-1).at(-1).date >= data.end, true);
});
