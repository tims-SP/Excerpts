export interface Workspace {
  id: string;
  name: string;
  rootFolder: string;
  recursive: boolean;
}
export interface PluginSettings {
  workspaces: Workspace[];
  autoRefresh: boolean;
  checkMinutes: number;
  batchSize: number;
  defaultSort: "newest" | "oldest";
}
export const DEFAULT_SETTINGS: PluginSettings = {
  workspaces: [], autoRefresh: true, checkMinutes: 0, batchSize: 40, defaultSort: "newest"
};
export interface CardIndex {
  path: string;
  basename: string;
  mtime: number;
  ctime: number;
  size: number;
  tags: string[];
  inlineTags: string[];
  favorite: boolean;
}
export interface MarkdownSection {
  name: string;
  markdown: string;
}
export interface ParsedMarkdown {
  title: string;
  body: string;
  sections: MarkdownSection[];
}
export function makeId(): string {
  return "w_" + Date.now().toString(36) + "_" + Array.from(
    crypto.getRandomValues(new Uint8Array(6)), b => b.toString(16).padStart(2,"0")
  ).join("");
}
export function validateRelativePath(input: string): string {
  const path = input.trim().replace(/\\/g, "/").replace(/\/+$/,"");
  if (!path || path.startsWith("/") || /[\x00-\x1f<>:"|?*]/.test(path) ||
      path.split("/").some(part => !part || part === "." || part === ".." || /[. ]$/.test(part)) ||
      path === ".obsidian" || path.startsWith(".obsidian/")) {
    throw new Error("请选择 Vault 内有效的相对文件夹路径");
  }
  return path;
}
export function belongsTo(path: string, folder: string, recursive = true): boolean {
  if (!path.startsWith(folder + "/")) return false;
  return recursive || !path.slice(folder.length + 1).includes("/");
}
export function isExcerptPath(path: string, ws: Workspace): boolean {
  if (!path.toLowerCase().endsWith(".md") || !belongsTo(path, ws.rootFolder, ws.recursive)) return false;
  const relative = path.slice(ws.rootFolder.length + 1);
  return !relative.split("/").some(part => part === "Excerpts-Drafts" || part === "Excerpts-Recycle");
}
