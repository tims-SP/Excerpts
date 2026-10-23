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
  let activeSection: MarkdownSection | null = null;
  let sectionIndex = 0;
  let fenceChar = "";
  let fenceLength = 0;
  const bodyParts: string[] = [];
  const sections: MarkdownSection[] = [];
  let current: string[] = [];
  const append = () => {
    const markdown = current.join("\n").trim();
    if (activeSection) activeSection.markdown = markdown;
    else if (markdown) bodyParts.push(markdown);
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
        if (heading[1] === "#" && !title && !activeSection && !current.join("").trim()) {
          title = heading[2].trim();
          continue;
        }
        if (heading[1] === "##") {
          append();
          activeSection = { id: "h2-" + ++sectionIndex, name: heading[2].trim(), markdown: "" };
          sections.push(activeSection);
          continue;
        }
      }
    }
    current.push(line);
  }
  append();
  return { title, body: bodyParts.join("\n\n").trim(), sections };
}
