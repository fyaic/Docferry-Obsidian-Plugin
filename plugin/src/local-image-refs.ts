// Local asset references must be collected in the order the rendered document
// shows them: the publish pipeline pairs snapshot <img> elements with uploaded
// assets positionally. Scanning each syntax family separately would reorder
// wiki, Markdown and raw-HTML references, so every pattern records its match
// offset and the merged list is sorted back into document order.
//
// References inside fenced/inline code and HTML comments are masked out: the
// renderer never displays them, so uploading those files would leak content
// that only exists as an example or a draft.
//
// Runtime imports from sibling modules are kept out on purpose: unit tests
// load this file directly through node --test without a bundler.

export interface LocalAssetRef {
  path: string;
  isImage: boolean;
}

export function extractLocalAssetRefs(markdown: string): LocalAssetRef[] {
  const masked = maskedRegions(markdown);
  const collected: Array<{ offset: number; ref: LocalAssetRef }> = [];
  const push = (offset: number, path: string | undefined, isImage: boolean): void => {
    const trimmed = path?.trim();
    if (!trimmed) return;
    if (masked.some(([start, end]) => offset >= start && offset < end)) return;
    if (!isUploadableRef(trimmed)) return;
    collected.push({ offset, ref: { path: trimmed, isImage } });
  };

  const wikiEmbedPattern = /!\[\[([^\]\n]+)\]\]/g;
  for (const match of markdown.matchAll(wikiEmbedPattern)) {
    push(match.index, match[1].split("|")[0], true);
  }

  // Non-embed wiki links ([[report.pdf]]) point at attachable files too;
  // the leading-! lookbehind keeps embeds out of this family.
  const wikiLinkPattern = /(?<!!)\[\[([^\]\n]+)\]\]/g;
  for (const match of markdown.matchAll(wikiLinkPattern)) {
    push(match.index, match[1].split("|")[0], false);
  }

  const markdownImagePattern = /!\[[^\]\n]*\]\(([^)\n]+)\)/g;
  for (const match of markdown.matchAll(markdownImagePattern)) {
    push(match.index, match[1].split(/\s+["']/)[0]?.replace(/^<|>$/g, ""), true);
  }

  const markdownLinkPattern = /(?<!!)\[[^\]\n]+\]\(([^)\n]+)\)/g;
  for (const match of markdown.matchAll(markdownLinkPattern)) {
    push(match.index, match[1].split(/\s+["']/)[0]?.replace(/^<|>$/g, ""), false);
  }

  // Raw HTML media elements: Obsidian renders hand-written comparison tables
  // and inline players, so their src attributes are local assets exactly like
  // wiki embeds. Skipping them meant the files were never uploaded and the
  // server-side sanitizer later stripped the src, leaving broken media.
  // iframes stay out: the sanitizer removes the whole element, so PDF-style
  // embeds are a documented limitation rather than an upload-and-break cycle.
  const htmlMediaSrcPattern =
    /<(?:img|video|audio|source)\b[^>]*\bsrc\s*=\s*(?:"([^"\n]+)"|'([^'\n]+)'|[^\s>]+)/gi;
  for (const match of markdown.matchAll(htmlMediaSrcPattern)) {
    push(match.index, match[1] ?? match[2] ?? match[3], true);
  }

  const htmlAnchorHrefPattern =
    /<a\b[^>]*\bhref\s*=\s*(?:"([^"\n]+)"|'([^'\n]+)'|[^\s>]+)/gi;
  for (const match of markdown.matchAll(htmlAnchorHrefPattern)) {
    push(match.index, match[1] ?? match[2] ?? match[3], false);
  }

  return collected.sort((a, b) => a.offset - b.offset).map((entry) => entry.ref);
}

function maskedRegions(markdown: string): Array<[number, number]> {
  const regions: Array<[number, number]> = [];
  let offset = 0;
  let fence: string | null = null;
  let fenceIndent = "";
  let fenceStart = 0;
  for (const line of markdown.split("\n")) {
    const opener = /^([ \t]*)(`{3,}|~{3,})/.exec(line);
    if (!fence && opener) {
      fence = opener[2][0].repeat(3);
      fenceIndent = opener[1];
      fenceStart = offset;
    } else if (fence && opener && opener[1] === fenceIndent && opener[2].startsWith(fence)) {
      regions.push([fenceStart, offset + line.length]);
      fence = null;
    }
    offset += line.length + 1;
  }
  if (fence) regions.push([fenceStart, markdown.length]);
  for (const match of markdown.matchAll(/`[^`\n]+`/g)) {
    regions.push([match.index, match.index + match[0].length]);
  }
  for (const match of markdown.matchAll(/<!--[\s\S]*?-->/g)) {
    regions.push([match.index, match.index + match[0].length]);
  }
  return regions;
}

// Mirrors isRemoteUrl in theme-safety.ts; the two must stay in sync.
function isRemoteUrl(value: string): boolean {
  return /^(?:https?:)?\/\//i.test(value) || /^(?:data|blob):/i.test(value);
}

function isUploadableRef(linkpath: string): boolean {
  if (isRemoteUrl(linkpath)) return false;
  if (linkpath.startsWith("obsidian://")) return false;
  if (linkpath.startsWith("#") || linkpath.startsWith("mailto:") || linkpath.startsWith("tel:")) {
    return false;
  }
  return true;
}

export interface SnapshotImageElement {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

export interface SnapshotImageAsset {
  assetId: string;
  originalPath: string;
}

export function applyLocalImageAssetPlaceholders(
  images: SnapshotImageElement[],
  imageAssets: Array<SnapshotImageAsset | null>
): void {
  if (!imageAssets.length) return;

  // Path matching is authoritative: an element whose original src still
  // points at a specific uploaded file gets exactly that asset, no matter
  // where it sits in the sequence. This repairs the positional drift caused
  // by any rendered element without a matching extracted reference
  // (unresolvable embeds, references the extractor masks).
  const claimed = new Map<SnapshotImageAsset, SnapshotImageElement>();
  for (const image of images) {
    const originalSrc = image.getAttribute("src") || "";
    if (!originalSrc || isSkippedImageSrc(originalSrc)) continue;
    const match = findAssetBySrc(originalSrc, imageAssets);
    if (!match) continue;
    applyAssetSrc(image, match);
    if (!claimed.has(match)) claimed.set(match, image);
  }

  // Positional pairing only serves elements with no src at all: an element
  // carrying a non-empty src that matched nothing stays unserved (its file
  // was not uploaded) instead of displaying some other reference's asset.
  let assetIndex = 0;
  for (const image of images) {
    if (image.getAttribute("src")) continue;
    let asset: SnapshotImageAsset | null = null;
    while (assetIndex < imageAssets.length) {
      const candidate = imageAssets[assetIndex];
      assetIndex += 1;
      if (candidate && claimed.has(candidate)) continue;
      asset = candidate;
      break;
    }
    if (asset) applyAssetSrc(image, asset);
  }
}

function isSkippedImageSrc(src: string): boolean {
  return (
    src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:")
  );
}

function findAssetBySrc(
  src: string,
  imageAssets: Array<SnapshotImageAsset | null>
): SnapshotImageAsset | null {
  const decoded = safeDecodeURIComponent(src);
  const candidates = [src, decoded, decoded.split(/[?#]/, 1)[0]];
  for (const asset of imageAssets) {
    if (!asset) continue;
    for (const variant of assetPathVariants(asset.originalPath)) {
      for (const candidate of candidates) {
        if (candidate === variant || candidate.endsWith(`/${variant}`)) {
          return asset;
        }
      }
    }
  }
  return null;
}

function assetPathVariants(originalPath: string): string[] {
  const variants = [originalPath];
  const withoutDot = originalPath.replace(/^\.\//, "");
  if (withoutDot !== originalPath) variants.push(withoutDot);
  return variants;
}

function applyAssetSrc(image: SnapshotImageElement, asset: SnapshotImageAsset): void {
  image.setAttribute("src", `docferry-asset://${asset.assetId}`);
  image.setAttribute("loading", "lazy");
  image.setAttribute("decoding", "async");
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
