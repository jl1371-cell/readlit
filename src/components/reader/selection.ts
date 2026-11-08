"use client";
import { type Block, type Rect, rangeRects, runOffsetToBlock } from "@/lib/pdf/text-model";
import { type TextSelectionInfo, useReader } from "@/lib/store/reader";

function offsetWithin(el: Element, container: Node, offset: number): number {
  const r = document.createRange();
  r.setStart(el, 0);
  try {
    r.setEnd(container, offset);
  } catch {
    return 0;
  }
  return r.toString().length;
}

function countWords(text: string): number {
  const cjk = (text.match(/[぀-ヿ㐀-鿿가-힯]/g) ?? []).length;
  const latin = text.replace(/[぀-ヿ㐀-鿿가-힯]/g, " ").trim().split(/\s+/).filter(Boolean).length;
  return latin + Math.ceil(cjk / 2);
}

/**
 * Read the browser selection inside the reader and map it onto the page text model: the paragraphs and sentences
 * it touches, their exact text, and rectangles for highlights. Browsers jump around in multi-column pages, so the
 * result is rebuilt from the model rather than taken from the DOM string.
 */
export function readTextSelection(content: HTMLElement, pointerX?: number): TextSelectionInfo | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!content.contains(range.commonAncestorContainer)) return null;
  const { pageText } = useReader.getState();

  type Span = { block: Block; page: number; lo: number; hi: number };
  const spans = new Map<string, Span>();
  const translatedSids = new Set<string>();
  const pages = Array.from(content.querySelectorAll<HTMLElement>(".pdf-page")).filter((p) => range.intersectsNode(p));

  for (const pageEl of pages) {
    const n = Number(pageEl.dataset.page);
    const pt = pageText[n];
    if (!pt) continue;
    for (const span of pageEl.querySelectorAll<HTMLElement>(".textLayer span[data-i]")) {
      if (!range.intersectsNode(span)) continue;
      const i = Number(span.dataset.i);
      const len = span.textContent?.length ?? 0;
      let a = 0;
      let b = len;
      if (span.contains(range.startContainer)) a = offsetWithin(span, range.startContainer, range.startOffset);
      if (span.contains(range.endContainer)) b = offsetWithin(span, range.endContainer, range.endOffset);
      if (b <= a) continue;
      const ra = runOffsetToBlock(pt, i, a);
      const rb = runOffsetToBlock(pt, i, b);
      if (!ra || !rb) continue;
      const cur = spans.get(ra.block.id) ?? { block: ra.block, page: n, lo: Infinity, hi: -Infinity };
      cur.lo = Math.min(cur.lo, ra.offset);
      cur.hi = Math.max(cur.hi, rb.offset);
      spans.set(ra.block.id, cur);
    }
    // Selecting translated text selects the sentences it stands for.
    for (const span of pageEl.querySelectorAll<HTMLElement>(".tr-text span[data-sid]")) {
      if (range.intersectsNode(span) && span.dataset.sid) translatedSids.add(span.dataset.sid);
    }
  }

  for (const sid of translatedSids) {
    const page = Number(sid.slice(1, sid.indexOf("s")));
    const pt = pageText[page];
    const s = pt?.sentences.find((x) => x.id === sid);
    const block = s && pt.blocks.find((b) => b.id === s.block);
    if (!s || !block) continue;
    const cur = spans.get(block.id) ?? { block, page, lo: Infinity, hi: -Infinity };
    cur.lo = Math.min(cur.lo, s.a);
    cur.hi = Math.max(cur.hi, s.b);
    spans.set(block.id, cur);
  }

  const ordered = [...spans.values()].sort((x, y) => x.page - y.page || pageText[x.page].blocks.indexOf(x.block) - pageText[y.page].blocks.indexOf(y.block));

  const box = content.getBoundingClientRect();
  const clientRects = Array.from(range.getClientRects()).filter((r) => r.width > 0.5 && r.height > 0.5);
  const lastRect = clientRects[clientRects.length - 1] ?? range.getBoundingClientRect();
  const firstRect = clientRects[0] ?? lastRect;
  const anchor = {
    x: (pointerX ?? lastRect.right) - box.left,
    y: lastRect.bottom - box.top,
    top: firstRect.top - box.top,
  };

  if (!ordered.length) {
    // The page text isn't ready yet: fall back to the browser's text.
    const text = sel.toString().trim();
    if (!text) return null;
    const page = Number((range.startContainer.parentElement?.closest(".pdf-page") as HTMLElement | null)?.dataset.page ?? 1);
    return { kind: "text", text, pages: [page], sids: [], byBlock: [], anchor, words: countWords(text), rects: [] };
  }

  const texts: string[] = [];
  const sids: string[] = [];
  const byBlock: TextSelectionInfo["byBlock"] = [];
  const rectsByPage = new Map<number, Rect[]>();
  for (const { block, page, lo, hi } of ordered) {
    const pt = pageText[page];
    const text = block.text.slice(lo, hi).trim();
    if (text) texts.push(text);
    const ids = pt.sentences.filter((s) => s.block === block.id && s.b > lo && s.a < hi).map((s) => s.id);
    if (ids.length) byBlock.push({ blockId: block.id, sids: ids });
    sids.push(...ids);
    rectsByPage.set(page, [...(rectsByPage.get(page) ?? []), ...rangeRects(pt, block, lo, hi)]);
  }
  const text = texts.join("\n\n");
  if (!text) return null;
  return {
    kind: "text",
    text,
    pages: [...new Set(ordered.map((o) => o.page))],
    sids,
    byBlock,
    anchor,
    words: countWords(text),
    rects: [...rectsByPage.entries()].map(([page, rects]) => ({ page, rects })),
  };
}

/** Text inside a region, in reading order, and the caption closest to it. */
export function regionText(page: number, rect: Rect): { text: string; caption: string; words: number; mathy: boolean } {
  const pt = useReader.getState().pageText[page];
  if (!pt) return { text: "", caption: "", words: 0, mathy: false };
  const inside = pt.runs
    .filter((r) => r.horizontal && r.str.trim())
    .filter((r) => {
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      return cx >= rect.x && cx <= rect.x + rect.w && cy >= rect.y && cy <= rect.y + rect.h;
    })
    .sort((a, b) => a.base - b.base || a.x - b.x);
  const lines: string[] = [];
  let lastBase = -Infinity;
  for (const r of inside) {
    if (Math.abs(r.base - lastBase) > r.size * 0.5) lines.push(r.str);
    else lines[lines.length - 1] += ` ${r.str}`;
    lastBase = r.base;
  }
  const text = lines.join("\n").replace(/[ \t]+/g, " ").trim();
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  const total = text.replace(/\s/g, "").length || 1;
  // The caption nearest to the region, above or below it.
  let caption = "";
  let best = Infinity;
  for (const b of pt.blocks) {
    if (b.kind !== "caption") continue;
    const dy = b.rect.y >= rect.y + rect.h ? b.rect.y - (rect.y + rect.h) : b.rect.y + b.rect.h <= rect.y ? rect.y - (b.rect.y + b.rect.h) : 0;
    const overlapX = b.rect.x < rect.x + rect.w && b.rect.x + b.rect.w > rect.x;
    if (overlapX && dy < 90 && dy < best) {
      best = dy;
      caption = b.text;
    }
  }
  return { text, caption, words: countWords(text), mathy: total > 8 && letters / total < 0.5 };
}
