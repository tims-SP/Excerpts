export const EXTRA_KINDS = ["source", "variant", "note", "context", "link", "custom"] as const;
export type ExtraKind = typeof EXTRA_KINDS[number];
export const EXTRA_LABELS: Record<ExtraKind, string> = {
  source: "来源", variant: "变种", note: "批注", context: "上下文", link: "关联", custom: "自定义"
};
export interface Workspace {
  id: string;
  name: string;
  rootFolder: string;
  entryFile: string;
  cardsFolder: string;
  attachmentsFolder: string;
}
export interface PluginSettings {
  schemaVersion: number;
  workspaces: Workspace[];
  collapseExtras: boolean;
  defaultSort: "newest" | "oldest";
}
export const DEFAULT_SETTINGS: PluginSettings = {
  schemaVersion: 1, workspaces: [], collapseExtras: true, defaultSort: "newest"
};
export interface Extra {
  id: string;
  kind: ExtraKind;
  title: string;
  content: string;
}
export interface Entry {
  id: string;
  collectionId: string;
  created: string;
  updated: string;
  favorite: boolean;
  tags: string[];
  text: string;
  extras: Extra[];
  path?: string;
  readOnly?: boolean;
  problem?: string;
}
export function makeId(prefix: string): string {
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}
/** Never accept paths outside the vault or within the application's private config. */
export function validateRelativePath(input: string, allowSlash = false): string {
  const path = input.trim().replace(/\\/g, "/");
  if (path.startsWith("/")) throw new Error("必须使用 Vault 内的相对路径");
  if (!path && !allowSlash) throw new Error("路径不能为空");
  if (/[\x00-\x1f<>:"|?*]/.test(path) || path.split("/").some(s =>
    !s || s === "." || s === ".." || /[. ]$/.test(s) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(s)
  )) throw new Error("路径包含不允许的片段");
  if (path === ".obsidian" || path.startsWith(".obsidian/")) throw new Error("不能写入 Obsidian 配置目录");
  return path;
}
export function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join("/").replace(/\/{2,}/g, "/");
}
export function workspacePaths(ws: Workspace) {
  const root = validateRelativePath(ws.rootFolder);
  const entry = validateRelativePath(ws.entryFile);
  const cards = validateRelativePath(ws.cardsFolder);
  const attachments = validateRelativePath(ws.attachmentsFolder);
  return { root, home: joinPath(root, entry), cards: joinPath(root, cards), attachments: joinPath(root, attachments) };
}
export function belongsTo(path: string, folder: string): boolean {
  return path.startsWith(folder + "/");
}
