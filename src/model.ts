/** A display scope is determined by the parent folder of an .excerpts entry file. */
export interface Workspace { rootFolder: string; recursive: boolean; homePath: string; }
export interface PluginSettings {
  defaultHome: string;
  recursive: boolean;
}
export const DEFAULT_SETTINGS: PluginSettings = {
  defaultHome: "", recursive: true
};
export interface CardIndex {
  path: string;
  basename: string;
  mtime: number;
  ctime: number;
  size: number;
  tags: string[];
  inlineTags: string[];
}
export interface MarkdownSection { name: string; markdown: string; }
export interface ParsedMarkdown { title: string; body: string; sections: MarkdownSection[]; }
export function validateRelativePath(input: string): string {
  const path = input.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!path || path.startsWith("/") || /[\x00-\x1f<>:"|?*]/.test(path) ||
      path.split("/").some(part => !part || part === "." || part === ".." || /[. ]$/.test(part)) ||
      path === ".obsidian" || path.startsWith(".obsidian/")) {
    throw new Error("请选择 Vault 内有效的相对文件夹路径");
  }
  return path;
}
export function belongsTo(path: string, folder: string, recursive = true): boolean {
  if (!folder || folder === "/") return recursive ? !!path : !path.includes("/");
  if (!path.startsWith(folder + "/")) return false;
  return recursive || !path.slice(folder.length + 1).includes("/");
}
export function isExcerptPath(path: string, ws: Workspace): boolean {
  return path.toLowerCase().endsWith(".md") && belongsTo(path, ws.rootFolder, ws.recursive);
}
