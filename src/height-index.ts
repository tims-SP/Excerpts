/** Prefix-height index for a virtual feed; every operation is O(log n). */
export class HeightIndex {
  private readonly values: number[];
  private readonly tree: Float64Array;

  constructor(estimatedHeights: readonly number[]) {
    this.values = estimatedHeights.map(value => HeightIndex.valid(value));
    this.tree = new Float64Array(this.values.length + 1);
    for (let i = 0; i < this.values.length; i++) {
      const next = i + 1;
      this.tree[next] += this.values[i];
      const parent = next + (next & -next);
      if (parent < this.tree.length) this.tree[parent] += this.tree[next];
    }
  }

  get length(): number { return this.values.length; }
  get(index: number): number { return this.values[index] ?? 0; }

  /** Sum of rows [0, count). */
  prefix(count: number): number {
    let index = Math.min(this.length, Math.max(0, Math.trunc(count)));
    let result = 0;
    while (index > 0) { result += this.tree[index]; index -= index & -index; }
    return result;
  }

  total(): number { return this.prefix(this.length); }

  set(index: number, height: number): number {
    if (!Number.isInteger(index) || index < 0 || index >= this.length) return 0;
    const next = HeightIndex.valid(height);
    const delta = next - this.values[index];
    if (!delta) return 0;
    this.values[index] = next;
    for (let i = index + 1; i < this.tree.length; i += i & -i) this.tree[i] += delta;
    return delta;
  }

  /** Row containing offset; also handles offsets beyond the end. */
  indexAt(offset: number): number {
    if (!this.length) return 0;
    let remaining = Math.max(0, Number.isFinite(offset) ? offset : 0);
    let index = 0;
    let bit = 1;
    while (bit * 2 <= this.length) bit *= 2;
    while (bit) {
      const next = index + bit;
      if (next <= this.length && this.tree[next] <= remaining) {
        index = next;
        remaining -= this.tree[next];
      }
      bit >>= 1;
    }
    return Math.min(index, this.length - 1);
  }

  private static valid(height: number): number {
    return Number.isFinite(height) && height > 0 ? height : 1;
  }
}
