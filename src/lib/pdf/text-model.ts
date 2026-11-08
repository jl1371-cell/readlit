/**
 * The page text model: pdf.js text runs → lines → blocks (paragraphs) → sentences.
 *
 * Everything is in page points at scale 1 with the origin at the top-left, so overlays can be laid out once
 * and scaled with the page. Sentence ids (`p3s12`) come from this base layer and never change for a given file,
 * which is what lets translations, citations, AI highlights and map nodes all point at the same sentence.
 */
import type { PageViewport } from "pdfjs-dist";
import type { TextContent, TextItem } from "pdfjs-dist/types/src/display/api";

export type Rect = { x: number; y: number; w: number; h: number };

export interface TextRun {
  /** Index in textContent.items — identical to the index of the span pdf.js renders for it. */
  i: number;
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  base: number;
  size: number;
  serif: boolean;
  horizontal: boolean;
  eol: boolean;
}

/** A run's character range [a, b) placed at offset `at` in the owning line/block text. */
export interface SegAt {
  run: number;
  a: number;
  b: number;
  at: number;
}

export interface Line {
  runs: number[];
  rect: Rect;
  base: number;
  size: number;
  text: string;
  segs: SegAt[];
}

/**
 * `reference` = entries after a References heading; `furniture` = running headers, footers, page numbers;
 * `front` = authors and affiliations under the title.
 */
export type BlockKind = "body" | "heading" | "caption" | "math" | "reference" | "furniture" | "front";

export interface Block {
  id: string;
  page: number;
  kind: BlockKind;
  lines: number[];
  rect: Rect;
  size: number;
  /** Median distance between baselines, or 1.25 × size for single lines. */
  pitch: number;
  serif: boolean;
  text: string;
  segs: SegAt[];
  sids: string[];
}

export interface Sentence {
  id: string;
  page: number;
  block: string;
  text: string;
  /** Range in the owning block's text. */
  a: number;
  b: number;
}

export interface PageText {
  page: number;
  width: number;
  height: number;
  runs: TextRun[];
  lines: Line[];
  blocks: Block[];
  sentences: Sentence[];
  bodySize: number;
  /** True when the page ends inside the reference list, so the next page starts there too. */
  refsAtEnd: boolean;
}

export interface BuildOptions {
  lang?: string;
  /** The previous page ended inside the reference list. */
  inReferences?: boolean;
}

type Matrix = [number, number, number, number, number, number];

function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

const HEADING_WORDS =
  /^(abstract|introduction|background|related work|preliminaries|method|methods|methodology|approach|experiments?|evaluation|results|discussion|limitations|conclusions?|references|bibliography|acknowledg(e)?ments?|appendix|supplementary)\b/i;
const NUMBERED_HEADING = /^((\d{1,2}(\.\d{1,2}){0,3})|[IVX]{1,5}|[A-H])[.)]?\s+[A-Z\p{Lu}]/u;
/** Prefixes that keep their hyphen when a line breaks after them ("self-" + "attention"). */
const KEEP_HYPHEN = /^(self|non|multi|cross|state|end|fine|semi|well|zero|data|task|domain|human|world|meta|pseudo|quasi|two|three|four|five|ten)$/i;
const CAPTION = /^(figure|fig\.|table|algorithm|listing)\s*[A-Z]?\d+[a-z]?\s*[.:|]/i;
const ABBREVIATIONS =
  /(\bet al|\be\.g|\bi\.e|\bcf|\bvs|\bfig|\bfigs|\beq|\beqs|\bsec|\bsecs|\btab|\bref|\brefs|\bno|\bnos|\bvol|\bpp|\bch|\bapprox|\bresp|\bdr|\bprof|\bmr|\bms|\bst|\bjr|\binc|\bu\.s|\bw\.r\.t)\.\s*$/i;

/** Build the text model for one page. `viewport` must be the page's scale-1 viewport. */
export function buildPageText(page: number, viewport: PageViewport, content: TextContent, opts: BuildOptions = {}): PageText {
  const vt = viewport.transform as Matrix;
  const runs: TextRun[] = [];
  content.items.forEach((raw, i) => {
    if (!("str" in raw)) return;
    const item = raw as TextItem;
    const style = content.styles[item.fontName];
    const tx = multiply(vt, item.transform as Matrix);
    const angle = Math.atan2(tx[1], tx[0]);
    const size = Math.hypot(tx[2], tx[3]);
    const ascent = style?.ascent && style.ascent > 0.2 ? style.ascent : 0.8;
    const descent = style?.descent && style.descent < 0 ? style.descent : -0.2;
    const family = style?.fontFamily ?? "";
    runs.push({
      i,
      str: item.str,
      x: tx[4],
      y: tx[5] - size * ascent,
      w: item.width,
      h: size * (ascent - descent),
      base: tx[5],
      size,
      serif: /serif/i.test(family) && !/sans/i.test(family),
      horizontal: Math.abs(angle) < 0.02 && !style?.vertical,
      eol: item.hasEOL,
    });
  });

  const lines = groupLines(runs);
  const bodySize = dominantSize(lines);
  const blocks = groupBlocks(page, lines, runs, bodySize);
  const refsAtEnd = assignRoles(blocks, viewport.height, bodySize, opts.inReferences ?? false, page);
  const sentences = splitSentences(page, blocks, opts.lang ?? "en");
  return { page, width: viewport.width, height: viewport.height, runs, lines, blocks, sentences, bodySize, refsAtEnd };
}

const REFERENCES_HEADING = /^((\d{1,2}|[IVX]{1,4})[.)]?\s+)?(references|bibliography|works cited|literature cited|参考文献)\s*$/i;

/** Mark reference entries and page furniture so whole-page translation leaves them alone. */
function assignRoles(blocks: Block[], height: number, bodySize: number, inReferences: boolean, page = 0): boolean {
  let refs = inReferences;
  const band = height * 0.065;
  if (page === 1) markFrontMatter(blocks, height, bodySize);
  for (const b of blocks) {
    const t = b.text.trim();
    if (b.kind === "heading") {
      // A heading after the reference list (an appendix, say) ends it.
      refs = REFERENCES_HEADING.test(t);
      continue;
    }
    const inBand = b.rect.y + b.rect.h <= band || b.rect.y >= height - band;
    if ((inBand && b.lines.length <= 2 && t.length < 160 && b.size <= bodySize * 1.15) || /^[\divxlc]{1,4}$/i.test(t)) {
      b.kind = "furniture";
      continue;
    }
    if (refs && b.kind !== "math") b.kind = "reference";
  }
  return refs;
}

/** Authors and affiliations on the first page: between the title and the abstract (or the first real paragraph). */
function markFrontMatter(blocks: Block[], height: number, bodySize: number) {
  const top = blocks.filter((b) => b.rect.y < height * 0.5);
  if (!top.length) return;
  const title = top.reduce((a, b) => (b.size > a.size ? b : a), top[0]);
  if (title.size < bodySize * 1.25) return;
  const start = blocks.indexOf(title) + 1;
  let end = blocks.findIndex((b, i) => i >= start && ((b.kind === "heading" && /^(abstract|摘要)\b/i.test(b.text.trim())) || (b.kind === "body" && b.lines.length >= 4)));
  if (end < 0) end = start;
  for (let i = start; i < end; i++) {
    const b = blocks[i];
    if (b.kind === "body" || b.kind === "heading") b.kind = "front";
  }
}

/** Width of an ordinary paragraph line on this page: the median width of multi-line body blocks. */
function proseWidth(pt: PageText): number {
  const ws = pt.blocks.filter((b) => b.kind === "body" && b.lines.length >= 3).map((b) => b.rect.w);
  return ws.length ? median(ws) : pt.width * 0.4;
}

/**
 * Whether whole-page translation should translate this block. Short single-line blocks are figure labels or table
 * cells: they stay as they are unless the reader boxes them on purpose.
 */
export function pageTranslatable(pt: PageText, b: Block): boolean {
  if (!b.sids.length) return false;
  if (b.kind === "heading" || b.kind === "caption") return true;
  if (b.kind !== "body") return false;
  if (b.lines.length >= 2) return true;
  return b.rect.w >= proseWidth(pt) * 0.55 && b.text.trim().split(/\s+/).length >= 6;
}

/** Whether an explicit selection may be translated in place (everything with sentences). */
export function selectionTranslatable(b: Block): boolean {
  return b.sids.length > 0 && b.kind !== "math";
}

function groupLines(runs: TextRun[]): Line[] {
  const lines: Line[] = [];
  let cur: Line | null = null;
  let prevEol = false;

  const close = () => {
    if (cur && cur.text.trim()) lines.push(cur);
    cur = null;
  };

  for (let k = 0; k < runs.length; k++) {
    const r = runs[k];
    if (!r.horizontal || r.size <= 0) {
      prevEol = r.eol;
      continue;
    }
    if (r.str === "") {
      if (r.eol) prevEol = true;
      continue;
    }
    const line: Line | null = cur;
    if (line) {
      const right = line.rect.x + line.rect.w;
      const gap = r.x - right;
      const ref = Math.max(Math.min(r.size, line.size), 1);
      const sameBase = Math.abs(r.base - line.base) <= 0.42 * ref;
      // Superscripts / subscripts: smaller run whose box overlaps the line vertically.
      const script =
        r.size < line.size * 0.85 && r.y < line.rect.y + line.rect.h && r.y + r.h > line.rect.y && gap < 1.5 * line.size;
      const near = gap <= 2.2 * ref && gap >= -0.6 * ref;
      if ((sameBase || script) && near && !prevEol) {
        appendRun(line, r, k, gap);
        prevEol = r.eol;
        continue;
      }
      close();
    }
    cur = {
      runs: [k],
      rect: { x: r.x, y: r.y, w: r.w, h: r.h },
      base: r.base,
      size: r.size,
      text: r.str,
      segs: [{ run: k, a: 0, b: r.str.length, at: 0 }],
    };
    prevEol = r.eol;
  }
  close();
  return lines;
}

function appendRun(line: Line, r: TextRun, k: number, gap: number) {
  const needsSpace = gap > 0.12 * line.size && !/\s$/.test(line.text) && !/^\s/.test(r.str);
  if (needsSpace) line.text += " ";
  line.segs.push({ run: k, a: 0, b: r.str.length, at: line.text.length });
  line.text += r.str;
  line.runs.push(k);
  const x0 = Math.min(line.rect.x, r.x);
  const y0 = Math.min(line.rect.y, r.y);
  const x1 = Math.max(line.rect.x + line.rect.w, r.x + r.w);
  const y1 = Math.max(line.rect.y + line.rect.h, r.y + r.h);
  line.rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  if (r.size > line.size * 0.95) line.base = (line.base + r.base) / 2;
  line.size = Math.max(line.size, r.size);
}

function dominantSize(lines: Line[]): number {
  const weight = new Map<number, number>();
  for (const l of lines) {
    const key = Math.round(l.size * 2) / 2;
    weight.set(key, (weight.get(key) ?? 0) + l.text.length);
  }
  let best = 10;
  let bestW = -1;
  for (const [s, w] of weight) {
    if (w > bestW) {
      best = s;
      bestW = w;
    }
  }
  return best;
}

function groupBlocks(page: number, lines: Line[], runs: TextRun[], bodySize: number): Block[] {
  const blocks: Block[] = [];
  let cur: { lines: number[]; size: number; left: number; right: number; pitches: number[] } | null = null;

  const flush = () => {
    if (!cur) return;
    blocks.push(makeBlock(page, blocks.length, cur.lines, lines, runs, bodySize, cur.pitches));
    cur = null;
  };

  lines.forEach((line, idx) => {
    const c = cur;
    if (c) {
      const prev = lines[c.lines[c.lines.length - 1]];
      const step = line.base - prev.base;
      const sizeOk = Math.abs(line.size - c.size) <= 0.13 * c.size;
      const pitch = c.pitches.length ? median(c.pitches) : 0;
      const maxStep = pitch ? pitch * 1.4 : c.size * 1.85;
      const downOk = step > 0.5 * c.size && step <= maxStep;
      const overlap =
        line.rect.x < prev.rect.x + prev.rect.w + 0.5 * c.size && line.rect.x + line.rect.w > prev.rect.x - 0.5 * c.size;
      const leftOk = Math.abs(line.rect.x - c.left) <= 2.4 * c.size || line.rect.x > c.left;
      // A body-size heading ("3.1 Attention") is followed by body text of the same size: split there. Larger lines
      // that continue at the same size are a wrapped title or a large paragraph and stay together.
      const prevHeading = c.lines.length === 1 && prev.size <= bodySize * 1.12 && isHeadingText(prev.text, prev.size, bodySize);
      // A new paragraph inside a column: the previous line stops short and this one starts indented.
      const indented = line.rect.x - c.left > 0.7 * c.size && line.rect.x - c.left < 4 * c.size;
      const prevShort = prev.rect.x + prev.rect.w < c.right - 1.5 * c.size;
      const newParagraph = c.lines.length >= 2 && indented && prevShort;
      if (sizeOk && downOk && overlap && leftOk && !prevHeading && !newParagraph) {
        c.lines.push(idx);
        c.pitches.push(step);
        c.left = Math.min(c.left, line.rect.x);
        c.right = Math.max(c.right, line.rect.x + line.rect.w);
        return;
      }
      flush();
    }
    cur = { lines: [idx], size: line.size, left: line.rect.x, right: line.rect.x + line.rect.w, pitches: [] };
  });
  flush();
  return blocks;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function isHeadingText(text: string, size: number, bodySize: number): boolean {
  const t = text.trim();
  if (!t || t.length > 90) return false;
  const words = t.split(/\s+/).length;
  if (size > bodySize * 1.12 && words <= 14) return true;
  if (words <= 9 && (HEADING_WORDS.test(t) || NUMBERED_HEADING.test(t)) && !/[.,;:]$/.test(t)) return true;
  return false;
}

function makeBlock(
  page: number,
  index: number,
  lineIdx: number[],
  lines: Line[],
  runs: TextRun[],
  bodySize: number,
  pitches: number[],
): Block {
  let text = "";
  const segs: SegAt[] = [];
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  let serifVotes = 0;
  let size = 0;

  lineIdx.forEach((li, n) => {
    const line = lines[li];
    x0 = Math.min(x0, line.rect.x);
    y0 = Math.min(y0, line.rect.y);
    x1 = Math.max(x1, line.rect.x + line.rect.w);
    y1 = Math.max(y1, line.rect.y + line.rect.h);
    size = Math.max(size, line.size);
    for (const s of line.segs) if (runs[s.run].serif) serifVotes += s.b - s.a;

    if (n > 0) {
      const prevText = text;
      const prevWord = /(\p{L}+)-$/u.exec(prevText)?.[1] ?? "";
      const nextWord = /^\S+/.exec(line.text.trimStart())?.[0] ?? "";
      // "English-" + "to-German" is a compound, not a word split across lines.
      const compound = nextWord.includes("-") || KEEP_HYPHEN.test(prevWord);
      const hyphenated = !!prevWord && /^\p{Ll}/u.test(nextWord) && !compound;
      if (/\p{L}-$/u.test(prevText) && compound) {
        // keep the hyphen and join without a space
      } else if (hyphenated) {
        // Drop the soft hyphen from the text and from the last segment that carried it.
        text = text.slice(0, -1);
        const last = segs[segs.length - 1];
        if (last && last.b > last.a) last.b -= 1;
      } else if (!/\s$/.test(text)) {
        text += " ";
      }
    }
    const offset = text.length;
    const lead = line.text.length - line.text.trimStart().length;
    for (const s of line.segs) {
      segs.push({ run: s.run, a: s.a, b: s.b, at: offset + s.at - lead });
    }
    text += line.text.trimStart();
  });

  const total = text.replace(/\s+/g, "").length || 1;
  const letters = (text.match(/[\p{L}]/gu) ?? []).length;
  const first = lines[lineIdx[0]];
  let kind: BlockKind = "body";
  if (CAPTION.test(text.trim())) kind = "caption";
  else if (lineIdx.length <= 2 && isHeadingText(text, first.size, bodySize)) kind = "heading";
  else if (letters / total < 0.55 && total < 600) kind = "math";

  return {
    id: `p${page}b${index + 1}`,
    page,
    kind,
    lines: lineIdx,
    rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
    size,
    pitch: pitches.length ? median(pitches) : size * 1.25,
    serif: serifVotes > total * 0.5,
    text,
    segs,
    sids: [],
  };
}

function splitSentences(page: number, blocks: Block[], lang: string): Sentence[] {
  const out: Sentence[] = [];
  const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(lang, { granularity: "sentence" }) : null;
  let n = 0;
  for (const block of blocks) {
    if (block.kind === "math" || block.kind === "furniture") continue;
    const pieces: { a: number; b: number }[] = [];
    if (block.kind === "heading" || !segmenter) {
      pieces.push({ a: 0, b: block.text.length });
    } else {
      for (const s of segmenter.segment(block.text)) {
        const a = s.index;
        const b = s.index + s.segment.length;
        const prev = pieces[pieces.length - 1];
        // Merge splits that follow an abbreviation ("et al.", "Fig.", "e.g.") or a bare citation number.
        if (prev && (ABBREVIATIONS.test(block.text.slice(prev.a, prev.b)) || /^\s*[\d\])]/.test(s.segment))) {
          prev.b = b;
        } else {
          pieces.push({ a, b });
        }
      }
    }
    for (const p of pieces) {
      let a = p.a;
      let b = p.b;
      while (a < b && /\s/.test(block.text[a])) a++;
      while (b > a && /\s/.test(block.text[b - 1])) b--;
      if (b - a < 2) continue;
      n += 1;
      const id = `p${page}s${n}`;
      block.sids.push(id);
      out.push({ id, page, block: block.id, text: block.text.slice(a, b), a, b });
    }
  }
  return out;
}

/** Rectangles covering a range [a, b) of a block's text, merged per line. */
export function rangeRects(pt: PageText, block: Block, a: number, b: number): Rect[] {
  const rects: Rect[] = [];
  for (const s of block.segs) {
    const segA = s.at;
    const segB = s.at + (s.b - s.a);
    const lo = Math.max(a, segA);
    const hi = Math.min(b, segB);
    if (hi <= lo) continue;
    const r = pt.runs[s.run];
    const len = Math.max(r.str.length, 1);
    const ca = s.a + (lo - segA);
    const cb = s.a + (hi - segA);
    const x = r.x + (r.w * ca) / len;
    const w = (r.w * (cb - ca)) / len;
    const last = rects[rects.length - 1];
    if (last && Math.abs(last.y - r.y) < r.h * 0.5 && x - (last.x + last.w) < r.size * 1.5) {
      const x1 = Math.max(last.x + last.w, x + w);
      const y0 = Math.min(last.y, r.y);
      const y1 = Math.max(last.y + last.h, r.y + r.h);
      last.x = Math.min(last.x, x);
      last.w = x1 - last.x;
      last.y = y0;
      last.h = y1 - y0;
    } else {
      rects.push({ x, y: r.y, w, h: r.h });
    }
  }
  return rects;
}

export function sentenceRects(pt: PageText, sid: string): Rect[] {
  const s = pt.sentences.find((x) => x.id === sid);
  if (!s) return [];
  const block = pt.blocks.find((b) => b.id === s.block);
  if (!block) return [];
  return rangeRects(pt, block, s.a, s.b);
}

/** Map a character position inside a pdf.js run to an offset in its block's text. */
export function runOffsetToBlock(pt: PageText, runIndex: number, charOffset: number): { block: Block; offset: number } | null {
  const k = pt.runs.findIndex((r) => r.i === runIndex);
  if (k < 0) return null;
  for (const block of pt.blocks) {
    for (const s of block.segs) {
      if (s.run !== k) continue;
      const c = Math.min(Math.max(charOffset, s.a), s.b);
      return { block, offset: s.at + (c - s.a) };
    }
  }
  return null;
}

/** Plain text of a page for the model: one sentence per line, each with its id. */
export function pageForModel(pt: PageText): string {
  const out: string[] = [];
  for (const block of pt.blocks) {
    if (block.kind === "furniture") continue;
    if (block.kind === "math") {
      out.push("[equation]");
      continue;
    }
    for (const sid of block.sids) {
      const s = pt.sentences.find((x) => x.id === sid);
      if (!s) continue;
      if (block.kind === "heading") out.push(`\n## [${sid}] ${s.text}`);
      else if (block.kind === "caption") out.push(`[${sid}] (caption) ${s.text}`);
      else if (block.kind === "reference") out.push(`[${sid}] (reference) ${s.text}`);
      else out.push(`[${sid}] ${s.text}`);
    }
  }
  return out.join("\n");
}

export function blocksInRect(pt: PageText, rect: Rect): Block[] {
  return pt.blocks.filter((b) => intersects(b.rect, rect));
}

export function runsInRect(pt: PageText, rect: Rect): TextRun[] {
  return pt.runs.filter((r) => r.horizontal && r.str.trim() && contains(rect, r));
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function contains(outer: Rect, inner: Rect): boolean {
  const cx = inner.x + inner.w / 2;
  const cy = inner.y + inner.h / 2;
  return cx >= outer.x && cx <= outer.x + outer.w && cy >= outer.y && cy <= outer.y + outer.h;
}
