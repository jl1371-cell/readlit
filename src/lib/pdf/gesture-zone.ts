import { type PageText, pageTranslatable } from "./text-model";

/** What a drag that starts at a point on the page does: select text, or draw a box. */
export type Zone = "text" | "box";

/**
 * Decided only by where the drag starts, so the cursor can say it before the press (research: 调研记录/
 * 阅读器交互-2026-11-07/11-框选与选字的手势判定.md).
 *
 * - On a paragraph, or close beside it (a little before a line's first word, between its lines, between two columns
 *   of text): text. A paragraph counts with room around it: max(1.2 em, 10 px) at the sides, max(0.35 em, 4 px) above
 *   and below.
 * - Anywhere else (the margins, a figure or table, the space around them): a box.
 * - A figure's own labels and a table's cells are text only exactly on their letters, so a figure can be boxed from
 *   inside it. Display formulas are boxed even on their letters: as an image they can be explained; as text they
 *   come apart.
 * - A page without text (a scanned page) is all box. Before the page's text is read, the letters alone decide.
 *
 * `x` and `y` are in page points; `scale` is screen pixels per point; `onGlyph` says the press is on a letter.
 */
export function zoneAt(pt: PageText | undefined, x: number, y: number, scale: number, onGlyph: boolean): Zone {
  if (!pt) return onGlyph ? "text" : "box";
  if (!pt.runs.length) return "box";
  const inside = (r: { x: number; y: number; w: number; h: number }, px: number, py: number) =>
    x >= r.x - px && x <= r.x + r.w + px && y >= r.y - py && y <= r.y + r.h + py;
  if (pt.blocks.some((b) => b.kind === "math" && inside(b.rect, 2, 2))) return "box";
  if (onGlyph) return "text";
  for (const b of pt.blocks) {
    if (b.kind === "math" || !isProse(pt, b)) continue;
    const padX = Math.max(1.2 * b.size, 10 / scale);
    const padY = Math.max(0.35 * b.size, 4 / scale);
    if (inside(b.rect, padX, padY)) return "text";
  }
  return "box";
}

/** Running text: paragraphs, headings, captions, references and author lines; not a figure label or table cell. */
function isProse(pt: PageText, b: PageText["blocks"][number]): boolean {
  if (b.kind !== "body") return true;
  return b.lines.length >= 2 || pageTranslatable(pt, b);
}
