import { Entry, Extra, ExtraKind, EXTRA_KINDS, EXTRA_LABELS } from "./model";

const EXTRA_START = "<!-- excerpts:extras:start -->";
const EXTRA_END = "<!-- excerpts:extras:end -->";
const ITEM_END = "<!-- excerpts:item:end -->";
const ITEM_START_RE = /^<!-- excerpts:item:start id="([a-zA-Z0-9_-]+)" kind="([a-z]+)" -->$/;

function yamlScalar(value: string): string { return JSON.stringify(value); }
function safeText(value: string) {
  if (value.includes(EXTRA_START) || value.includes(EXTRA_END) || value.includes(ITEM_END) || value.includes("<!-- excerpts:item:start")) {
    throw new Error("内容包含保留的 Excerpts 结构标记，无法保存");
  }
  return value.replace(/\r\n?/g, "\n").trim();
}
function headerFor(entry: Entry): string {
  return [
    "---", "excerpts_type: entry", "excerpts_schema: 1",
    `excerpts_id: ${yamlScalar(entry.id)}`,
    `excerpts_collection: ${yamlScalar(entry.collectionId)}`,
    `excerpts_created: ${yamlScalar(entry.created)}`,
    `excerpts_updated: ${yamlScalar(entry.updated)}`,
    `excerpts_favorite: ${entry.favorite ? "true" : "false"}`,
    "tags:", ...entry.tags.map(t => `  - ${yamlScalar(t)}`), "---"
  ].join("\n");
}
export function renderExtras(extras: Extra[]): string {
  const chunks = [EXTRA_START];
  for (const kind of EXTRA_KINDS) {
    const subset = extras.filter(x => x.kind === kind);
    if (!subset.length) continue;
    chunks.push(`\n## ${EXTRA_LABELS[kind]}`);
    for (const item of subset) {
      if (!/^[a-zA-Z0-9_-]+$/.test(item.id)) throw new Error("附属条目 ID 无效");
      chunks.push(`\n<!-- excerpts:item:start id="${item.id}" kind="${kind}" -->`);
      chunks.push(`### ${safeText(item.title).replace(/\n/g, " ") || EXTRA_LABELS[kind]}`);
      const content = safeText(item.content);
      if (content) chunks.push("\n" + content);
      chunks.push(ITEM_END);
    }
  }
  chunks.push("\n" + EXTRA_END);
  return chunks.join("\n");
}
function encodeQuote(text: string): string {
  const clean = safeText(text);
  if (!clean) throw new Error("摘录正文不能为空");
  return clean.split("\n").map(line => line ? `> ${line}` : ">").join("\n");
}
export function serializeEntry(entry: Entry): string {
  return `${headerFor(entry)}\n\n${encodeQuote(entry.text)}\n\n${renderExtras(entry.extras)}\n`;
}
function readScalar(header: string, field: string): string {
  const match = header.match(new RegExp(`^${field}:\\s*(.*?)\\s*$`, "m"));
  if (!match) return "";
  const v = match[1];
  if (v.startsWith('"')) { try { return JSON.parse(v); } catch { return ""; } }
  return v.replace(/^'|'$/g, "");
}
function readTags(header: string): string[] {
  const m = header.match(/^tags:\s*\n((?:[ \t]+-.*(?:\n|$))*)/m);
  if (!m) return [];
  return m[1].split("\n").map(s => s.trim()).filter(s => s.startsWith("- ")).map(s => {
    const raw = s.slice(2);
    try { return JSON.parse(raw); } catch { return raw.replace(/^'|'$/g, ""); }
  }).filter(x => typeof x === "string" && x.length > 0);
}
function decodeQuote(block: string): string {
  const trimmed = block.trim();
  return trimmed.split("\n").map(line => /^> ?/.test(line) ? line.replace(/^> ?/, "") : line).join("\n").trim();
}
function readExtras(block: string): Extra[] {
  const items: Extra[] = [];
  const lines = block.split("\n");
  let i = 0;
  const ids = new Set<string>();
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.startsWith("<!-- excerpts:item:start") && !ITEM_START_RE.test(line)) throw new Error("附属条目头部格式错误");
    const match = line.match(ITEM_START_RE);
    if (!match) {
      if (line === ITEM_END) throw new Error("附属条目存在未匹配的结束标记");
      i++; continue;
    }
    const [, id, kind] = match;
    if (!EXTRA_KINDS.includes(kind as ExtraKind)) throw new Error(`未知附属类型：${kind}`);
    if (ids.has(id)) throw new Error(`附属条目 ID 重复：${id}`);
    ids.add(id);
    i++;
    const body: string[] = [];
    while (i < lines.length && lines[i].trim() !== ITEM_END) {
      if (lines[i].startsWith("<!-- excerpts:item:start")) throw new Error("附属条目未闭合");
      body.push(lines[i++]);
    }
    if (i >= lines.length) throw new Error(`附属条目 ${id} 未闭合`);
    i++;
    const nonempty = body.findIndex(x => x.trim().length > 0);
    if (nonempty < 0 || !body[nonempty].startsWith("### ")) throw new Error(`附属条目 ${id} 缺少标题`);
    const title = body[nonempty].slice(4).trim();
    const content = body.slice(nonempty + 1).join("\n").trim();
    items.push({ id, kind: kind as ExtraKind, title, content });
  }
  return items;
}
/** Fail closed on damaged delimiters: never overwrite a manually edited document blindly. */
export function parseEntry(raw: string): Entry | null {
  const normalized = raw.replace(/\r\n?/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return null;
  const header = match[1];
  if (readScalar(header, "excerpts_type") !== "entry") return null;
  const id = readScalar(header, "excerpts_id");
  const collectionId = readScalar(header, "excerpts_collection");
  if (!id || !collectionId) return null;
  const content = normalized.slice(match[0].length);
  const first = content.indexOf(EXTRA_START);
  const last = content.indexOf(EXTRA_END);
  const entry: Entry = {
    id, collectionId, created: readScalar(header, "excerpts_created"), updated: readScalar(header, "excerpts_updated"),
    favorite: readScalar(header, "excerpts_favorite") === "true", tags: readTags(header),
    text: decodeQuote(first < 0 ? content : content.slice(0, first)), extras: []
  };
  if (first < 0 && last < 0) {
    if (content.includes("<!-- excerpts:item:")) {
      entry.readOnly = true; entry.problem = "附属条目存在，但其边界标记缺失";
    }
    return entry;
  }
  if (first < 0 || last < first || content.indexOf(EXTRA_START, first + EXTRA_START.length) !== -1 || content.indexOf(EXTRA_END, last + EXTRA_END.length) !== -1) {
    entry.readOnly = true; entry.problem = "附属内容边界标记缺失或重复"; return entry;
  }
  try {
    entry.extras = readExtras(content.slice(first + EXTRA_START.length, last));
  } catch (e) {
    entry.readOnly = true;
    entry.problem = e instanceof Error ? e.message : "附属内容格式错误";
  }
  return entry;
}
/** Only touch the quote region and plugin-owned fields, preserving other metadata / notes. */
export function patchEntry(raw: string, current: Entry, updated: Entry): string {
  const parsed = parseEntry(raw);
  if (!parsed || parsed.id !== current.id || parsed.collectionId !== current.collectionId || parsed.readOnly) {
    throw new Error("文件结构与缓存不一致，已取消写入以保护数据");
  }
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) throw new Error("找不到 YAML frontmatter");
  let head = match[1];
  for (const [key, value] of [
    ["excerpts_updated", yamlScalar(updated.updated)],
    ["excerpts_favorite", updated.favorite ? "true" : "false"]
  ]) {
    const reg = new RegExp(`^${key}:.*$`, "m");
    if (reg.test(head)) head = head.replace(reg, `${key}: ${value}`);
    else head += `\n${key}: ${value}`;
  }
  const tags = `tags:\n${updated.tags.map(t => `  - ${yamlScalar(t)}`).join("\n")}`;
  const existingTag = /^tags:\s*\n(?:[ \t]+-.*(?:\r?\n|$))*/m;
  if (existingTag.test(head)) head = head.replace(existingTag, `${tags}\n`);
  else head += `\n${tags}`;
  const normalized = raw.replace(/\r\n?/g, "\n");
  const body = normalized.slice(normalized.indexOf("\n---\n", 4) + "\n---\n".length);
  const index = body.indexOf(EXTRA_START);
  const tail = index >= 0 ? body.slice(body.indexOf(EXTRA_END, index) + EXTRA_END.length).replace(/^\n*/, "") : "";
  return `---\n${head.trimEnd()}\n---\n\n${encodeQuote(updated.text)}\n\n${renderExtras(updated.extras)}\n${tail}`;
}
