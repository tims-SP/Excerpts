import { MarkdownSection, ParsedMarkdown } from "./model";

/** Parse only display boundaries. The Markdown source is never modified. */
export function parseMarkdown(raw: string): ParsedMarkdown {
  const normalized = raw.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  let start = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
    if (end > 0) start = end + 1;
  }
  let title = "";
  let sectionName: string | null = null;
  let fenceChar = "";
  let fenceLength = 0;
  const bodyParts: string[] = [];
  const sections: MarkdownSection[] = [];
  let current: string[] = [];
  const append = () => {
    const markdown = current.join("\n").trim();
    if (sectionName === null) { if (markdown) bodyParts.push(markdown); }
    else sections.push({ name: sectionName, markdown });
    current = [];
  };
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s{0,3}(\u0060{3,}|~{3,})(.*)$/);
    if (fence) {
      const char = fence[1][0];
      if (!fenceChar) { fenceChar = char; fenceLength = fence[1].length; }
      else if (char === fenceChar && fence[1].length >= fenceLength &&
               fence[2].trim() === "") { fenceChar = ""; fenceLength = 0; }
      current.push(line); continue;
    }
    if (!fenceChar) {
      const heading = line.match(/^ {0,3}(#{1,2})[ \t]+(.+?)[ \t]*#*[ \t]*$/);
      if (heading) {
        if (heading[1] === "#" && !title && sectionName === null && !current.join("").trim()) {
          title = heading[2].trim();
          continue;
        }
        if (heading[1] === "##") {
          append();
          sectionName = heading[2].trim();
          continue;
        }
      }
    }
    current.push(line);
  }
  append();
  const body = bodyParts.join("\n\n").trim();
  return { title, body, sections };
}

/** Find the source line of an H2 by ordinal, not by text, so repeated groups stay distinct. */
export function findSectionHeadingLine(raw: string, sectionIndex: number): number | null {
  if (!Number.isInteger(sectionIndex) || sectionIndex < 0) return null;
  const lines = raw.split(/\r\n|\r|\n/);
  let start = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
    if (end > 0) start = end + 1;
  }
  let fenceChar = "";
  let fenceLength = 0;
  let found = 0;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      const char = fence[1][0];
      if (!fenceChar) { fenceChar = char; fenceLength = fence[1].length; }
      else if (char === fenceChar && fence[1].length >= fenceLength &&
               fence[2].trim() === "") { fenceChar = ""; fenceLength = 0; }
      continue;
    }
    if (fenceChar) continue;
    if (/^ {0,3}##[ \t]+(.+?)[ \t]*#*[ \t]*$/.test(line)) {
      if (found === sectionIndex) return i;
      found++;
    }
  }
  return null;
}

/**
 * Remove fenced and inline code before detecting *rendered* Markdown media.
 * Only the classification copy changes; the original Markdown is untouched.
 */
export function visibleMediaMarkdown(markdown: string): string {
  let fenceChar = "";
  let fenceLength = 0;
  const lines = markdown.split(/\r\n?|\n/);
  return lines.map(line => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (marker) {
      const char = marker[1][0];
      if (!fenceChar) {
        fenceChar = char;
        fenceLength = marker[1].length;
      } else if (char === fenceChar && marker[1].length >= fenceLength &&
          marker[2].trim() === "") {
        fenceChar = "";
        fenceLength = 0;
      }
      return "";
    }
    if (fenceChar || /^(?: {4}|\t)/.test(line)) return "";
    return line.replace(/(`+)([\s\S]*?)\1/g, " ");
  }).join("\n");
}
