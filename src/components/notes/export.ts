"use client";
import { getNodesBounds, getViewportForBounds, type Node } from "@xyflow/react";
import { toPng } from "html-to-image";
import { type MapDoc, primaryText, secondaryText } from "@/lib/store/notes";

function download(name: string, href: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function safeName(title: string): string {
  return (title || "map").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "map";
}

/** The map as a nested Markdown list: both languages, page references, and notes under their node. */
export function mapToMarkdown(doc: MapDoc): string {
  const root = doc.nodes[doc.rootId];
  const lines: string[] = [`# ${primaryText(root, "bilingual")}`];
  const sub = secondaryText(root, "bilingual");
  if (sub) lines.push("", sub);
  lines.push("");
  const walk = (id: string, depth: number) => {
    const n = doc.nodes[id];
    if (!n) return;
    const one = primaryText(n, "bilingual");
    const two = secondaryText(n, "bilingual");
    const pages = n.sources.map((s) => `p.${s.page}`).join(", ");
    const indent = "  ".repeat(depth);
    const role = n.role ? `**${n.role.t}** · ` : "";
    lines.push(`${indent}- ${role}${one}${two ? ` ｜ ${two}` : ""}${pages ? ` [${pages}]` : ""}`);
    if (n.note && n.note !== one) {
      for (const para of n.note.split(/\n+/)) if (para.trim()) lines.push(`${indent}  ${para.trim()}`);
    }
    for (const c of n.children) walk(c, depth + 1);
  };
  for (const c of root.children) walk(c, 0);
  return lines.join("\n") + "\n";
}

export function exportMarkdown(doc: MapDoc, title: string) {
  const blob = new Blob([mapToMarkdown(doc)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  download(`${safeName(title)}.md`, url);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** The whole map as a 2× PNG on paper, framed to fit. */
export async function exportPng(nodes: Node[], title: string) {
  const viewport = document.querySelector<HTMLElement>(".mind-map .react-flow__viewport");
  if (!viewport || !nodes.length) return;
  const bounds = getNodesBounds(nodes);
  const width = Math.min(6000, Math.max(800, bounds.width + 160));
  const height = Math.min(6000, Math.max(500, bounds.height + 160));
  const vp = getViewportForBounds(bounds, width, height, 0.2, 1.5, 0.06);
  const url = await toPng(viewport, {
    backgroundColor: "#FAF6EF",
    width,
    height,
    pixelRatio: 2,
    style: { width: `${width}px`, height: `${height}px`, transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` },
    filter: (el) => !(el instanceof HTMLElement && el.dataset?.exportHide === "true"),
  });
  download(`${safeName(title)}.png`, url);
}
