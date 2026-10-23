/** Derive a readable filename from Markdown, never modifying its content. */
const MAX_STEM_LENGTH = 30;
const UNSAFE = /[\u0000-\u001f\u007f<>:"/\\|?*]/g;

function cleanStem(value: string): string {
  let name = value.normalize("NFC")
    .replace(UNSAFE, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "")
    .replace(/^[-–—]+|[-–—]+$/g, "")
    .trim();
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name)) name = "摘录 " + name;
  return name;
}

function stripBlockPrefix(source: string): string {
  return source.trim()
    .replace(/^(?:>\s*)+/, "")
    .replace(/^[-*+]\s+(?:\[[ xX]\]\s+)?/, "")
    .replace(/^\d+[.)]\s+/, "");
}

function isStandaloneAttachment(source: string): boolean {
  const text = stripBlockPrefix(source);
  return /^(?:(?:!\[\[[^\]]+\]\]|!\[[^\]]*\]\([^)]*\))\s*)+$/.test(text);
}

function readableLine(source: string): string {
  let text = stripBlockPrefix(source)
    // Obsidian callout markers are presentation syntax, not readable content.
    .replace(/^\[![^\]]+\][+-]?\s*/i, "");

  // Use human-visible link text or attachment aliases, not attachment paths.
  text = text.replace(/!\[\[([^\]]+)\]\]/g, (_match, target: string) => {
    const parts = target.split("|");
    const alias = parts.length > 1 ? parts.slice(1).join("|").trim() : "";
    return alias && !/^(?:\d+|\d+[x×]\d+)$/i.test(alias) ? alias : "";
  });
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_match, alt: string) => alt);
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, (_match, label: string) => label);
  text = text.replace(/\[\[([^\]]+)\]\]/g, (_match, target: string) => {
    const parts = target.split("|");
    return parts.length > 1 ? parts.slice(1).join("|") : parts[0].split("/").pop() ?? "";
  });
  text = text.replace(/<[^>]*>/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\\([\\\x60*_{}[\]()#+.!>-])/g, "$1")
    .replace(/[\x60*_~]/g, "")
    .trim();

  const sentenceEnd = text.search(/[。！？!?]/);
  if (sentenceEnd >= 0) text = text.slice(0, sentenceEnd + 1);
  return cleanStem(text);
}

/** Keep the stem and any subsequent unique suffix within the filename budget. */
export function fitFileStem(stem: string, limit = MAX_STEM_LENGTH): string {
  const chars = Array.from(stem);
  if (chars.length <= limit) return stem;
  const available = Math.max(1, limit - 1);
  let end = available;
  for (let i = available - 1; i >= Math.floor(available * 0.7); i--) {
    if (/[\s，,。；;:：]/.test(chars[i])) { end = i + 1; break; }
  }
  const prefix = chars.slice(0, end).join("").replace(/[\s，,；;:：…]+$/g, "").trim();
  return (prefix || chars.slice(0, available).join("")) + "…";
}

function localDateStem(now: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return "摘录 " + now.getFullYear() + "-" + two(now.getMonth() + 1) + "-" +
    two(now.getDate()) + " " + two(now.getHours()) + "-" + two(now.getMinutes());
}

export function excerptFileStem(markdown: string, now = new Date()): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let start = 0;
  if (lines[0]?.trim() === "---") {
    const closing = lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)$/.test(line.trim()));
    if (closing > 0) start = closing + 1;
  }

  let fenceChar = "";
  let fenceLength = 0;
  let inComment = false;
  let firstBody = "";
  let firstAttachment = "";
  for (const raw of lines.slice(start)) {
    const line = raw.trim();
    if (inComment) {
      if (line.includes("-->")) inComment = false;
      continue;
    }
    if (line.startsWith("<!--")) {
      inComment = !line.includes("-->");
      continue;
    }
    const fence = raw.match(/^ {0,3}(\x60{3,}|~{3,})/);
    if (fence) {
      const mark = fence[1];
      if (!fenceChar) { fenceChar = mark[0]; fenceLength = mark.length; }
      else if (mark[0] === fenceChar && mark.length >= fenceLength &&
        raw.slice(raw.indexOf(mark) + mark.length).trim() === "") {
        fenceChar = ""; fenceLength = 0;
      }
      continue;
    }
    if (fenceChar || /^(?: {4}|\t)/.test(raw) || !line ||
      /^ {0,3}(?:---+|___+|\*\*\*+)\s*$/.test(raw)) continue;

    const heading = raw.match(/^ {0,3}#\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const title = readableLine(heading[1]);
      if (title) return fitFileStem(title);
    }
    if (/^ {0,3}#{1,6}\s+/.test(raw)) continue;
    const readable = readableLine(raw);
    if (!readable) continue;
    if (isStandaloneAttachment(raw)) {
      if (!firstAttachment) firstAttachment = readable;
    } else if (!firstBody) {
      firstBody = readable;
    }
  }
  // A normal sentence takes priority even when an attachment appears earlier.
  return fitFileStem(firstBody || firstAttachment || localDateStem(now));
}
