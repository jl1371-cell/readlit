"use client";
import { memo, useEffect, useRef, useState } from "react";
import { zoneAt } from "@/lib/pdf/gesture-zone";
import type { Rect } from "@/lib/pdf/text-model";
import { type RegionSelectionInfo, useReader } from "@/lib/store/reader";

type Drag =
  | { kind: "draw"; x0: number; y0: number }
  | { kind: "move"; dx: number; dy: number; rect: Rect }
  | { kind: "resize"; corner: "nw" | "ne" | "sw" | "se"; rect: Rect };

const MIN = 6;
/** Screen pixels a press must move before it becomes a box; less is a click, which only clears the selection. */
const START = 4;

/** Whether the press is on the current text selection (which can be dragged into the notes). */
function onSelection(x: number, y: number): boolean {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
  return [...sel.getRangeAt(0).getClientRects()].some((r) => x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2);
}

/** Box selection on one page: drawing it (Box tool) and adjusting it afterwards with corner handles. */
export const RegionLayer = memo(function RegionLayer({ page, width, height, scale }: { page: number; width: number; height: number; scale: number }) {
  const tool = useReader((s) => s.tool);
  const region = useReader((s) => (s.selection?.kind === "region" && s.selection.page === page ? s.selection : null));
  const [live, setLive] = useState<Rect | null>(null);
  const drag = useRef<Drag | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  const toPage = (e: React.PointerEvent): { x: number; y: number } => {
    const box = hostRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(width, (e.clientX - box.left) / scale)),
      y: Math.max(0, Math.min(height, (e.clientY - box.top) / scale)),
    };
  };

  const commit = (rect: Rect) => {
    const host = hostRef.current;
    const content = host?.closest<HTMLElement>("[data-reader-content]");
    if (!host || !content) return;
    const hb = host.getBoundingClientRect();
    const cb = content.getBoundingClientRect();
    const sel: RegionSelectionInfo = {
      kind: "region",
      page,
      rect,
      anchor: {
        x: hb.left - cb.left + (rect.x + rect.w) * scale,
        y: hb.top - cb.top + (rect.y + rect.h) * scale,
        top: hb.top - cb.top + rect.y * scale,
      },
    };
    useReader.getState().setSelection(sel);
  };

  const onDown = (e: React.PointerEvent, d: Drag | null) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (!d) {
      const p = toPage(e);
      drag.current = { kind: "draw", x0: p.x, y0: p.y };
      setLive({ x: p.x, y: p.y, w: 0, h: 0 });
      useReader.getState().setSelection(null);
    } else {
      drag.current = d;
      setLive(d.kind === "move" || d.kind === "resize" ? d.rect : null);
    }
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toPage(e);
    if (d.kind === "draw") {
      setLive({ x: Math.min(d.x0, p.x), y: Math.min(d.y0, p.y), w: Math.abs(p.x - d.x0), h: Math.abs(p.y - d.y0) });
    } else if (d.kind === "move") {
      const x = Math.max(0, Math.min(width - d.rect.w, p.x - d.dx));
      const y = Math.max(0, Math.min(height - d.rect.h, p.y - d.dy));
      setLive({ ...d.rect, x, y });
    } else {
      const r = d.rect;
      let x0 = r.x;
      let y0 = r.y;
      let x1 = r.x + r.w;
      let y1 = r.y + r.h;
      if (d.corner.includes("w")) x0 = Math.min(p.x, x1 - MIN);
      if (d.corner.includes("e")) x1 = Math.max(p.x, x0 + MIN);
      if (d.corner.includes("n")) y0 = Math.min(p.y, y1 - MIN);
      if (d.corner.includes("s")) y1 = Math.max(p.y, y0 + MIN);
      setLive({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    const r = live;
    setLive(null);
    if (!d || !r) return;
    if (r.w < MIN || r.h < MIN) {
      if (d.kind === "draw") useReader.getState().setTool("select");
      return;
    }
    commit(r);
    // Like a screenshot tool: one box, then back to reading.
    if (d.kind === "draw") useReader.getState().setTool("select");
  };

  const armed = useReader((s) => s.boxArmed);
  const shown = live ?? region?.rect ?? null;
  const drawing = tool === "box" || armed;

  // Without the Box tool: a drag that starts in blank space (or on a figure) draws a box; one that starts on text
  // selects it. The cursor shows which before the press. Commit and the selection bar work as with the tool.
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });
  useEffect(() => {
    const host = hostRef.current;
    const pageEl = host?.parentElement;
    if (!host || !pageEl) return;
    const pointOf = (e: PointerEvent | MouseEvent) => {
      const box = host.getBoundingClientRect();
      return { x: Math.max(0, Math.min(width, (e.clientX - box.left) / scale)), y: Math.max(0, Math.min(height, (e.clientY - box.top) / scale)) };
    };
    const zoneOf = (e: PointerEvent | MouseEvent) => {
      const t = e.target as HTMLElement;
      const p = pointOf(e);
      return zoneAt(useReader.getState().pageText[page], p.x, p.y, scale, !!t.closest(".textLayer span"));
    };

    let raf = 0;
    const onHover = (e: PointerEvent) => {
      if (e.pointerType === "touch" || e.buttons) return;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const t = e.target as HTMLElement;
        pageEl.dataset.zone = t.closest(".textLayer") ? zoneOf(e) : "";
      });
    };
    const onLeave = () => {
      pageEl.dataset.zone = "";
    };

    let cleanup: (() => void) | null = null;
    const onPress = (e: PointerEvent) => {
      const st = useReader.getState();
      if (st.tool === "box" || st.boxArmed) return; // the box layer is on top and draws
      if (e.button !== 0 || e.pointerType === "touch" || e.detail >= 2 || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;
      const t = e.target as HTMLElement;
      const textLayer = t.closest<HTMLElement>(".textLayer");
      // Translations, cards and the box itself handle their own presses.
      if (!textLayer || onSelection(e.clientX, e.clientY)) return;
      if (zoneOf(e) === "text") {
        textLayer.classList.add("selecting");
        const done = () => {
          textLayer.classList.remove("selecting");
          window.removeEventListener("pointerup", done, true);
          window.removeEventListener("pointercancel", done, true);
        };
        window.addEventListener("pointerup", done, true);
        window.addEventListener("pointercancel", done, true);
        return;
      }
      // A box. Nothing is drawn until the pointer has moved a little; a click clears the selection and no more.
      e.preventDefault();
      window.getSelection()?.removeAllRanges();
      const start = pointOf(e);
      const sx = e.clientX;
      const sy = e.clientY;
      let rect: Rect | null = null;
      const stopSelect = (ev: Event) => ev.preventDefault();
      const move = (ev: PointerEvent) => {
        if (!rect && Math.hypot(ev.clientX - sx, ev.clientY - sy) < START) return;
        const p = pointOf(ev);
        rect = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
        setLive(rect);
      };
      const up = () => {
        cleanup?.();
        setLive(null);
        if (rect && rect.w >= MIN && rect.h >= MIN) commitRef.current(rect);
      };
      cleanup = () => {
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", up, true);
        window.removeEventListener("pointercancel", up, true);
        document.removeEventListener("selectstart", stopSelect, true);
        document.removeEventListener("mousedown", stopSelect, true);
        cleanup = null;
      };
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
      window.addEventListener("pointercancel", up, true);
      // Belt and braces: no browser starts a text selection while a box is being drawn.
      document.addEventListener("selectstart", stopSelect, true);
      document.addEventListener("mousedown", stopSelect, true);
    };

    pageEl.addEventListener("pointermove", onHover);
    pageEl.addEventListener("pointerleave", onLeave);
    pageEl.addEventListener("pointerdown", onPress, true);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      cleanup?.();
      pageEl.removeEventListener("pointermove", onHover);
      pageEl.removeEventListener("pointerleave", onLeave);
      pageEl.removeEventListener("pointerdown", onPress, true);
    };
  }, [page, width, height, scale]);

  return (
    <div ref={hostRef} className="absolute inset-0" style={{ zIndex: 5, pointerEvents: drawing ? "auto" : "none", cursor: drawing ? "crosshair" : undefined }} onPointerDown={drawing ? (e) => onDown(e, null) : undefined} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      {shown && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="absolute rounded-[3px]"
            style={{
              left: shown.x * scale,
              top: shown.y * scale,
              width: shown.w * scale,
              height: shown.h * scale,
              border: "1.5px solid rgba(209, 75, 40, 0.9)",
              background: "rgba(209, 75, 40, 0.05)",
              boxShadow: "0 0 0 9999px rgba(43, 38, 33, 0.07)",
            }}
          />
        </div>
      )}
      {shown && (region || live) && (
        <>
          {/* Move by dragging the inside; resize by the corners. */}
          <div
            className="absolute cursor-move"
            style={{ left: shown.x * scale, top: shown.y * scale, width: shown.w * scale, height: shown.h * scale, pointerEvents: "auto" }}
            onPointerDown={(e) => {
              const p = toPage(e);
              onDown(e, { kind: "move", dx: p.x - shown.x, dy: p.y - shown.y, rect: shown });
            }}
          />
          {(["nw", "ne", "sw", "se"] as const).map((c) => {
            const cx = (c.includes("w") ? shown.x : shown.x + shown.w) * scale;
            const cy = (c.includes("n") ? shown.y : shown.y + shown.h) * scale;
            return (
              <div
                key={c}
                className="absolute h-[11px] w-[11px] rounded-[3px] border-[1.5px] border-paprika bg-white shadow-card"
                style={{ left: cx - 5.5, top: cy - 5.5, cursor: c === "nw" || c === "se" ? "nwse-resize" : "nesw-resize", pointerEvents: "auto" }}
                onPointerDown={(e) => onDown(e, { kind: "resize", corner: c, rect: shown })}
              />
            );
          })}
        </>
      )}
    </div>
  );
});
