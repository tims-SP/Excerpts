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

/** Use only an explicit Markdown H1, otherwise use a predictable timestamp. */
export function excerptFileStem(markdown: string, now = new Date()): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let start = 0;
  if (lines[0]?.trim() === "---") {
    const closing = lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)$/.test(line.trim()));
    if (closing > 0) start = closing + 1;
  }

  let fence = "";
  let fenceLength = 0;
  let inComment = false;
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
    const delimiter = raw.match(/^ {0,3}(`{3,}|~{3,})/);
    if (delimiter) {
      const marker = delimiter[1];
      if (!fence) { fence = marker[0]; fenceLength = marker.length; }
      else if (marker[0] === fence && marker.length >= fenceLength &&
        raw.slice(raw.indexOf(marker) + marker.length).trim() === "") {
        fence = ""; fenceLength = 0;
      }
      continue;
    }
    if (fence) continue;
    const heading = raw.match(/^ {0,3}#\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const title = cleanStem(heading[1]);
      if (title) return fitFileStem(title);
    }
  }
  return localDateStem(now);
}
