import { ParsedMarkdown } from "./model";

export type PreviewKind = "text" | "image" | "video" | "mixed" | "multimedia";
export type PreviewAction = "none" | "expand" | "read";
export interface PreviewPolicy {
  kind: PreviewKind;
  limit: number;
  expandedLimit: number;
}

const VIDEO = /(?:!\[\[[^\]]+\.(?:mp4|webm|mov|m4v|ogv)(?:[|#][^\]]*)?\]\]|<video\b|!\[[^\]]*\]\([^)]*\.(?:mp4|webm|mov|m4v|ogv)(?:\?[^)]*)?\))/gi;
const IMAGE = /(?:!\[\[[^\]]+\.(?:png|jpe?g|gif|webp|svg|bmp|avif)(?:[|#][^\]]*)?\]\]|<img\b|!\[[^\]]*\]\([^)]*\.(?:png|jpe?g|gif|webp|svg|bmp|avif)(?:\?[^)]*)?\))/gi;
const EMBED = /!\[\[[^\]]+\]\]|!\[[^\]]*\]\([^)]*\)|<(?:iframe|embed|object|audio|video|img)\b/gi;

/** Classification is read-only. Unrecognized embeds are treated conservatively. */
export function classifyPreview(parsed: ParsedMarkdown): PreviewKind {
  const body = parsed.body;
  const videos = [...body.matchAll(VIDEO)].length;
  const images = [...body.matchAll(IMAGE)].length;
  const embedded = [...body.matchAll(EMBED)].length;
  const prose = body.replace(EMBED, "").replace(/[#*_`>\s-]/g, "").trim().length;
  if (embedded > videos + images || videos + images > 1) return "multimedia";
  if (videos && prose > 40) return "mixed";
  if (images && prose > 40) return "mixed";
  if (videos) return "video";
  if (images) return "image";
  return "text";
}

export function previewPolicy(kind: PreviewKind, compact: boolean): PreviewPolicy {
  const desktop: Record<PreviewKind, number> = {
    text: 200, image: 280, video: 300, mixed: 360, multimedia: 400
  };
  const mobile: Record<PreviewKind, number> = {
    text: 160, image: 240, video: 260, mixed: 300, multimedia: 320
  };
  return { kind, limit: (compact ? mobile : desktop)[kind], expandedLimit: compact ? 800 : 1200 };
}

/** Never describe a truncated card as showing all of its content. */
export function previewAction(actualHeight: number, policy: PreviewPolicy): PreviewAction {
  if (!Number.isFinite(actualHeight) || actualHeight < 0) return "read";
  if (actualHeight <= policy.limit + 1) return "none";
  return actualHeight <= policy.expandedLimit ? "expand" : "read";
}
