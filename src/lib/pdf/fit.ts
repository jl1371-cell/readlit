"use client";
/**
 * Fitting translated text into the space of the original.
 *
 * Measured in the DOM at page-point scale with the same CSS the overlay uses, so what fits here fits on the page.
 * Rules (from how BabelDOC-style tools fail): start just under the paper's own size, tighten the leading first,
 * then shrink — never below 80% of the start — and report overflow instead of crushing the text.
 */
import { languageByCode } from "@/lib/languages";

export interface FitInput {
  text: string;
  /** Box width in page points. */
  width: number;
  /** First-line indent in page points (a translated sentence starts where the original sentence started). */
  indent: number;
  /** Height available in page points. */
  maxHeight: number;
  base: number;
  family: string;
  weight: number;
  /** Line heights to try, as multiples of the font size; or a fixed pitch in points. */
  leading: { multiples: number[] } | { pitch: number };
  /** When set, the text must end before this x (from the box's left edge) if it uses all of `maxLines` lines. */
  lastLine?: { maxLines: number; maxRight: number };
  lang: string;
  minScale?: number;
  nowrap?: boolean;
}

export interface FitResult {
  size: number;
  lineHeight: number;
  height: number;
  lines: number;
  overflow: boolean;
}

let measurer: HTMLDivElement | null = null;
const cache = new Map<string, FitResult>();

function getMeasurer(): HTMLDivElement {
  if (measurer && measurer.isConnected) return measurer;
  measurer = document.createElement("div");
  measurer.className = "tr-text";
  Object.assign(measurer.style, {
    position: "absolute",
    left: "-20000px",
    top: "0px",
    visibility: "hidden",
    pointerEvents: "none",
    contain: "layout style",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(measurer);
  return measurer;
}

function measure(input: FitInput, size: number, lineHeight: number) {
  const el = getMeasurer();
  el.lang = input.lang;
  el.style.width = input.nowrap ? "auto" : `${input.width}px`;
  el.style.whiteSpace = input.nowrap ? "nowrap" : "normal";
  el.style.fontFamily = input.family;
  el.style.fontWeight = String(input.weight);
  el.style.fontSize = `${size}px`;
  el.style.lineHeight = `${lineHeight}px`;
  el.style.textIndent = `${input.indent}px`;
  if (el.textContent !== input.text) el.textContent = input.text;
  const box = el.getBoundingClientRect();
  const height = box.height;
  const lines = Math.max(1, Math.round(height / lineHeight));
  let lastRight = box.width;
  const node = el.firstChild;
  if (input.lastLine && node && node.nodeType === Node.TEXT_NODE) {
    const len = (node as Text).length;
    if (len) {
      const r = document.createRange();
      r.setStart(node, len - 1);
      r.setEnd(node, len);
      const rects = r.getClientRects();
      const last = rects[rects.length - 1];
      if (last) lastRight = last.right - box.left;
    }
  }
  return { height, lines, width: box.width, lastRight };
}

function fits(input: FitInput, size: number, lineHeight: number): { ok: boolean; height: number; lines: number } {
  const m = measure(input, size, lineHeight);
  if (input.nowrap) return { ok: m.width <= input.width + 0.5, height: m.height, lines: 1 };
  let ok = m.height <= input.maxHeight + lineHeight * 0.25;
  if (ok && input.lastLine) {
    if (m.lines > input.lastLine.maxLines) ok = false;
    else if (m.lines === input.lastLine.maxLines && m.lastRight > input.lastLine.maxRight + size * 0.4) ok = false;
  }
  return { ok, height: m.height, lines: m.lines };
}

/** Natural single-line width of a text, in page points. */
export function measureWidth(text: string, size: number, family: string, weight: number, lang: string): number {
  return measure({ text, width: 0, indent: 0, maxHeight: 0, base: size, family, weight, leading: { multiples: [1.2] }, lang, nowrap: true }, size, size * 1.2).width;
}

export function fitText(input: FitInput): FitResult {
  const key = JSON.stringify(input);
  const hit = cache.get(key);
  if (hit) return hit;
  const minScale = input.minScale ?? 0.8;
  const leadingFor = (size: number, i: number) =>
    "pitch" in input.leading ? input.leading.pitch : size * input.leading.multiples[Math.min(i, input.leading.multiples.length - 1)];
  const tries = "pitch" in input.leading ? 1 : input.leading.multiples.length;

  let result: FitResult | null = null;
  // 1. The paper's size, tightening the leading step by step.
  for (let i = 0; i < tries && !result; i++) {
    const lh = leadingFor(input.base, i);
    const f = fits(input, input.base, lh);
    if (f.ok) result = { size: input.base, lineHeight: lh, height: f.height, lines: f.lines, overflow: false };
  }
  // 2. Shrink, never below the floor, at the tightest leading.
  if (!result) {
    let lo = input.base * minScale;
    let hi = input.base;
    let best: FitResult | null = null;
    for (let k = 0; k < 7; k++) {
      const mid = (lo + hi) / 2;
      const lh = "pitch" in input.leading ? input.leading.pitch : mid * input.leading.multiples[input.leading.multiples.length - 1];
      const f = fits(input, mid, lh);
      if (f.ok) {
        best = { size: mid, lineHeight: lh, height: f.height, lines: f.lines, overflow: false };
        lo = mid;
      } else {
        hi = mid;
      }
    }
    if (!best) {
      const size = input.base * minScale;
      const lh = "pitch" in input.leading ? input.leading.pitch : size * input.leading.multiples[input.leading.multiples.length - 1];
      const m = measure(input, size, lh);
      best = { size, lineHeight: lh, height: m.height, lines: m.lines, overflow: true };
    }
    result = best;
  }
  if (cache.size > 4000) cache.clear();
  cache.set(key, result);
  return result;
}

let resolved: { serifCjk: string } | null = null;

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Font stack for translated text: follows the paper (serif or sans) and the target script. */
export function overlayFamily(lang: string, serif: boolean): string {
  resolved ??= { serifCjk: cssVar("--font-noto-serif-sc") || '"Noto Serif SC"' };
  const noto = resolved.serifCjk;
  switch (lang) {
    case "zh-Hans":
      return serif
        ? `${noto}, "Songti SC", "STSong", "SimSun", serif`
        : `"PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei", sans-serif`;
    case "zh-Hant":
      return serif ? `"Songti TC", ${noto}, "PMingLiU", serif` : `"PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif`;
    case "ja":
      return serif ? `"Hiragino Mincho ProN", "Yu Mincho", ${noto}, serif` : `"Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif`;
    case "ko":
      return serif ? `"AppleMyungjo", "Nanum Myeongjo", "Noto Serif KR", serif` : `"Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif`;
    default:
      return serif ? `"Times New Roman", Times, "Liberation Serif", "Noto Serif", serif` : `"Helvetica Neue", Helvetica, Arial, sans-serif`;
  }
}

/** CJK glyphs look larger than Latin ones at the same size; start a little smaller so pages keep their colour. */
export function sizeFactor(lang: string): number {
  return languageByCode(lang)?.cjk ? 0.95 : 1;
}

/** Make sure the web fonts the text needs are loaded before measuring it. */
export async function ensureFonts(family: string, weight: number, text: string): Promise<void> {
  if (typeof document === "undefined" || !document.fonts?.load) return;
  try {
    await document.fonts.load(`${weight} 16px ${family}`, text.slice(0, 400));
  } catch {
    /* measuring with a fallback is better than not showing the translation */
  }
}
