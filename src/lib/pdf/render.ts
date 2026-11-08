"use client";
/**
 * Rendering helpers shared by the viewer: cached text content, page canvases (for sampling the paper colour), and
 * crops of a page region for vision requests and chat thumbnails.
 */
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TextContent } from "pdfjs-dist/types/src/display/api";
import type { Rect } from "./text-model";

const textCache = new WeakMap<PDFDocumentProxy, Map<number, Promise<TextContent>>>();

/** Text content of a page, fetched once and shared by the text model and the selectable text layer. */
export function getTextContent(doc: PDFDocumentProxy, pageNumber: number): Promise<TextContent> {
  let pages = textCache.get(doc);
  if (!pages) {
    pages = new Map();
    textCache.set(doc, pages);
  }
  let p = pages.get(pageNumber);
  if (!p) {
    p = doc.getPage(pageNumber).then((page) => page.getTextContent());
    pages.set(pageNumber, p);
  }
  return p;
}

/** Live page canvases, so overlays can sample the paper colour around the text they cover. */
export const pageCanvases = new Map<number, HTMLCanvasElement>();

/**
 * The colour of the paper just outside a rectangle (page points): the median of a thin ring of pixels.
 * Papers are mostly white, but shaded table rows and coloured boxes need a patch that matches them.
 */
export function paperColorAround(page: number, rect: Rect, pageWidth: number): string {
  const canvas = pageCanvases.get(page);
  if (!canvas || !canvas.width) return "#ffffff";
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return "#ffffff";
  const k = canvas.width / pageWidth;
  const x0 = Math.max(0, Math.floor((rect.x - 3) * k));
  const y0 = Math.max(0, Math.floor((rect.y - 3) * k));
  const x1 = Math.min(canvas.width - 1, Math.ceil((rect.x + rect.w + 3) * k));
  const y1 = Math.min(canvas.height - 1, Math.ceil((rect.y + rect.h + 3) * k));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 4 || h < 4) return "#ffffff";
  const ring = Math.max(1, Math.round(1.5 * k));
  const samples: number[][] = [];
  try {
    const strips = [
      ctx.getImageData(x0, y0, w, ring),
      ctx.getImageData(x0, y1 - ring, w, ring),
      ctx.getImageData(x0, y0, ring, h),
      ctx.getImageData(x1 - ring, y0, ring, h),
    ];
    for (const s of strips) {
      for (let i = 0; i < s.data.length; i += 4 * 3) samples.push([s.data[i], s.data[i + 1], s.data[i + 2]]);
    }
  } catch {
    return "#ffffff";
  }
  if (!samples.length) return "#ffffff";
  // Median by brightness: ink touching the ring can't darken the patch.
  samples.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  const [r, g, b] = samples[Math.floor(samples.length * 0.6)];
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * The colour behind the text inside a rectangle (page points): the most common colour once ink and lines are left
 * out. For labels read from an image, where the text often sits in a coloured box and a ring around it would catch
 * the box's border and the white page outside.
 */
export function paperColorBehind(page: number, rect: Rect, pageWidth: number): string {
  const canvas = pageCanvases.get(page);
  if (!canvas || !canvas.width) return "#ffffff";
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return "#ffffff";
  const k = canvas.width / pageWidth;
  const x0 = Math.max(0, Math.floor(rect.x * k));
  const y0 = Math.max(0, Math.floor(rect.y * k));
  const w = Math.min(canvas.width - x0, Math.ceil(rect.w * k));
  const h = Math.min(canvas.height - y0, Math.ceil(rect.h * k));
  if (w < 2 || h < 2) return paperColorAround(page, rect, pageWidth);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(x0, y0, w, h).data;
  } catch {
    return "#ffffff";
  }
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 8) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // Ink, outlines and arrows are dark; what's left is the background.
    if (0.299 * r + 0.587 * g + 0.114 * b < 120) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const c = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    c.n += 1;
    c.r += r;
    c.g += g;
    c.b += b;
    buckets.set(key, c);
  }
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const c of buckets.values()) if (!best || c.n > best.n) best = c;
  if (!best) return paperColorAround(page, rect, pageWidth);
  return `rgb(${Math.round(best.r / best.n)}, ${Math.round(best.g / best.n)}, ${Math.round(best.b / best.n)})`;
}

/**
 * Keeps a region's image well inside the 4.5 MB a request may carry on a hosted function, with room left for the rest
 * of the request. A photo-like figure at full size can be larger; it is then drawn smaller, never cut off.
 */
const MAX_IMAGE_CHARS = 2_800_000;

/**
 * Render a region of a page (page points) to a PNG data URL, sized so its longer edge is at most `maxEdge` px (less
 * for the rare figure whose PNG would be too large to send). Read the real size back with `pngSize`.
 */
export async function renderRegion(doc: PDFDocumentProxy, pageNumber: number, rect: Rect, maxEdge = 1568): Promise<string | null> {
  try {
    const page = await doc.getPage(pageNumber);
    const longest = Math.max(rect.w, rect.h, 1);
    for (let edge = maxEdge; ; edge = Math.round(edge * 0.75)) {
      const scale = Math.min(4, edge / longest);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(rect.w * scale));
      canvas.height = Math.max(1, Math.round(rect.h * scale));
      await page.render({
        canvas,
        viewport,
        background: "#ffffff",
        transform: [1, 0, 0, 1, -rect.x * scale, -rect.y * scale],
      }).promise;
      const url = canvas.toDataURL("image/png");
      if (url.length <= MAX_IMAGE_CHARS || edge <= 640) return url;
    }
  } catch (err) {
    console.warn("Could not render region", err);
    return null;
  }
}

/** The pixel size of a PNG data URL, read from its header (the IHDR chunk right after the signature). */
export function pngSize(dataUrl: string): { width: number; height: number } | null {
  const at = dataUrl.indexOf(",") + 1;
  let bin: string;
  try {
    bin = atob(dataUrl.slice(at, at + 32));
  } catch {
    return null;
  }
  if (bin.length < 24 || bin.slice(12, 16) !== "IHDR") return null;
  const u32 = (i: number) => ((bin.charCodeAt(i) << 24) | (bin.charCodeAt(i + 1) << 16) | (bin.charCodeAt(i + 2) << 8) | bin.charCodeAt(i + 3)) >>> 0;
  const width = u32(16);
  const height = u32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}
