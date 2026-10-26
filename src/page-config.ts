import { parseYaml } from "obsidian";

export interface PageFilter { tag: string; query: string; }

/** A blank .excerpts file is the unfiltered homepage. Non-empty files define saved filters. */
export function parsePageFilter(raw: string): PageFilter | null {
  if (!raw.trim()) return null;
  let doc: unknown;
  try { doc = parseYaml(raw); }
  catch { throw new Error("摘录页配置无法解析，请检查 .excerpts 文件"); }
  if (!doc || typeof doc !== "object") throw new Error("摘录页配置格式无效");
  const data = doc as Record<string, unknown>;
  const filter = data.filter;
  if (data.version !== 1 || !filter || typeof filter !== "object")
    throw new Error("摘录页配置版本或筛选条件无效");
  const value = filter as Record<string, unknown>;
  if (typeof value.tag !== "string" || typeof value.query !== "string" ||
      value.tag.length > 120 || value.query.length > 500)
    throw new Error("摘录页标签或搜索词无效");
  // Display and exact-match filtering must use the same tag string.
  // Invalid hand-edited pages fail explicitly instead of silently returning
  // empty results while showing a trimmed chip.
  if (value.tag !== value.tag.trim())
    throw new Error("摘录页标签不能包含首尾空格，请检查 .excerpts 文件");
  return { tag: value.tag, query: value.query };
}

export function serializePageFilter(filter: PageFilter): string {
  return "version: 1\nfilter:\n  tag: " + JSON.stringify(filter.tag) +
    "\n  query: " + JSON.stringify(filter.query) + "\n";
}

export function pageNameError(input: string): string | null {
  const name = input.trim().normalize("NFC");
  if (!name) return "请输入页面名称";
  if (Array.from(name).length > 60) return "页面名称最多 60 个字符";
  if (name === "首页") return "「首页」为默认入口保留名称";
  if (/[\\/:*?"<>|\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^\.+$/.test(name))
    return "名称包含文件系统不支持的字符";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name))
    return "请更换页面名称";
  return null;
}

export function isFiltered(filter: PageFilter): boolean {
  return Boolean(filter.tag.trim() || filter.query.trim());
}
