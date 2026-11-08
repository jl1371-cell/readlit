/**
 * Mind map geometry: a tidy logic chart that grows to the right, XMind-style. Siblings share a column and the
 * next column starts after the widest sibling, so every level lines up. Colours follow MapLit's branch palette:
 * each main branch keeps one hue all the way out.
 */
import type { MapDoc } from "@/lib/store/notes";

export interface BranchColor {
  name: string;
  rgb: [number, number, number];
  deep: string;
}

/** MapLit's paradigm palette, in MapLit's order. */
export const PALETTE: BranchColor[] = [
  { name: "paprika", rgb: [209, 75, 40], deep: "#A33A1F" },
  { name: "beeswax", rgb: [233, 167, 82], deep: "#A87025" },
  { name: "sage", rgb: [127, 168, 133], deep: "#4F7757" },
  { name: "crystal", rgb: [127, 165, 188], deep: "#4E7994" },
  { name: "latte", rgb: [120, 97, 77], deep: "#5A4838" },
];

export const rgba = (c: BranchColor, a: number) => `rgba(${c.rgb[0]}, ${c.rgb[1]}, ${c.rgb[2]}, ${a})`;

/** The soft "bead" material MapLit nodes are made of: a lit top-left, a deeper rim that melts into the canvas. */
export function beadBackground(c: BranchColor, weight: "root" | "topic"): string {
  const [hi, mid, edge] = weight === "root" ? [0.42, 0.28, 0.42] : [0.26, 0.15, 0.24];
  return `radial-gradient(120% 140% at 30% 18%, ${rgba(c, hi)} 0%, ${rgba(c, mid)} 52%, ${rgba(c, edge)} 100%)`;
}

export function beadShadow(c: BranchColor, weight: "root" | "topic", selected: boolean): string {
  const rim = selected ? "0 0 0 2px rgba(209, 75, 40, 0.42), 0 0 22px rgba(209, 75, 40, 0.2)" : `0 0 6px 0 ${rgba(c, 0.16)}`;
  const halo = weight === "root" ? `0 14px 34px -14px ${rgba(c, 0.5)}` : `0 8px 22px -12px ${rgba(c, 0.42)}`;
  const contact = "0 1px 4px rgba(43, 38, 33, 0.05)";
  const top = `inset 0 1.5px 1.5px rgba(255, 255, 255, ${weight === "root" ? 0.6 : 0.5})`;
  const bottom = `inset 0 ${weight === "root" ? "-8px 18px" : "-5px 12px"} ${rgba(c, 0.14)}`;
  return [rim, halo, contact, top, bottom].join(", ");
}

export interface Placed {
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  branch: number;
}

const H_GAP = [64, 44, 34];
const V_GAP = [0, 18, 10, 7];

export function visibleChildren(doc: MapDoc, id: string): string[] {
  const n = doc.nodes[id];
  if (!n || n.collapsed) return [];
  return n.children.filter((c) => doc.nodes[c]);
}

export function layoutMap(doc: MapDoc, size: (id: string) => { w: number; h: number }): Map<string, Placed> {
  const heights = new Map<string, number>();
  const out = new Map<string, Placed>();
  const vgap = (depth: number) => V_GAP[Math.min(depth, V_GAP.length - 1)];
  const hgap = (depth: number) => H_GAP[Math.min(depth, H_GAP.length - 1)];

  const measure = (id: string, depth: number): number => {
    const s = size(id);
    const kids = visibleChildren(doc, id);
    if (!kids.length) {
      heights.set(id, s.h);
      return s.h;
    }
    let sum = 0;
    kids.forEach((k, i) => {
      sum += measure(k, depth + 1) + (i ? vgap(depth + 1) : 0);
    });
    const h = Math.max(s.h, sum);
    heights.set(id, h);
    return h;
  };

  const place = (id: string, x: number, top: number, depth: number, columnW: number, branch: number) => {
    const s = size(id);
    const H = heights.get(id) ?? s.h;
    out.set(id, { x, y: top + (H - s.h) / 2, w: s.w, h: s.h, depth, branch });
    const kids = visibleChildren(doc, id);
    if (!kids.length) return;
    const total = kids.reduce((n, k, i) => n + (heights.get(k) ?? 0) + (i ? vgap(depth + 1) : 0), 0);
    const kidColumn = Math.max(...kids.map((k) => size(k).w));
    const childX = x + columnW + hgap(depth);
    let y = top + (H - total) / 2;
    kids.forEach((k, i) => {
      place(k, childX, y, depth + 1, kidColumn, depth === 0 ? i : branch);
      y += (heights.get(k) ?? 0) + vgap(depth + 1);
    });
  };

  const rootH = measure(doc.rootId, 0);
  place(doc.rootId, 0, -rootH / 2, 0, size(doc.rootId).w, 0);
  return out;
}

/** Root keeps paprika (MapLit's first accent); main branches take the other hues in turn. */
export function branchColor(depth: number, branch: number): BranchColor {
  if (depth === 0) return PALETTE[0];
  return PALETTE[(branch % (PALETTE.length - 1)) + 1];
}
