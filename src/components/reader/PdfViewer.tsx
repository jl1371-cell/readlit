"use client";
import clsx from "clsx";
import { CornerUpLeft } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { loadPaperFile, useLibrary } from "@/lib/store/library";
import { bodyIsSerif, openPdf } from "@/lib/pdf/pdfjs";
import { getTextContent } from "@/lib/pdf/render";
import { type PageText, buildPageText } from "@/lib/pdf/text-model";
import { useNotes } from "@/lib/store/notes";
import { useReader } from "@/lib/store/reader";
import { PdfPage } from "./PdfPage";
import { SelectionBar, clearSelection } from "./SelectionBar";
import { readTextSelection } from "./selection";
import { PASSAGE_TYPE, passageDrag, usePassageOver } from "@/components/notes/actions";

/** A title read from the file's metadata is often missing or junk ("1706.03762", "main.pdf"); use the page's. */
function adoptTitle(paperId: string, pt: PageText) {
  const meta = useLibrary.getState().papers.find((p) => p.id === paperId);
  if (!meta) return;
  const weak = !meta.title || /^\d{4}\.\d{4,5}(v\d+)?$/.test(meta.title) || meta.title === meta.fileName.replace(/\.pdf$/i, "") || /^(paper|main|manuscript|untitled)\b/i.test(meta.title);
  if (!weak) return;
  const candidates = pt.blocks
    .filter((b) => b.rect.y < pt.height * 0.45 && b.kind !== "furniture" && b.size >= pt.bodySize * 1.25)
    .filter((b) => {
      const words = b.text.trim().split(/\s+/).length;
      return words >= 2 && words <= 32 && /\p{L}{3,}/u.test(b.text);
    })
    .sort((a, b) => b.size - a.size || a.rect.y - b.rect.y);
  const title = candidates[0]?.text.replace(/\s+/g, " ").trim();
  if (!title) return;
  useLibrary.getState().rename(paperId, title);
  useReader.setState({ title });
  const notes = useNotes.getState();
  const root = notes.doc && notes.doc.nodes[notes.doc.rootId];
  if (root && (!root.s || root.s === meta.title)) {
    useNotes.setState({ doc: { ...notes.doc!, nodes: { ...notes.doc!.nodes, [root.id]: { ...root, s: title } } } });
  }
}

const PAD_TOP = 28;
const PAD_X = 28;
const GAP = 20;
export const MIN_SCALE = 0.5;
export const MAX_SCALE = 4;

/** Imperative handle the dock and keyboard use to zoom. */
export const viewerControls: {
  zoomBy: (factor: number) => void;
  fitWidth: () => void;
  scrollToPage: (p: number) => void;
} = { zoomBy: () => {}, fitWidth: () => {}, scrollToPage: () => {} };

export function PdfViewer({ paperId }: { paperId: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const doc = useReader((s) => s.doc);
  const sizes = useReader((s) => s.sizes);
  const scale = useReader((s) => s.scale);
  const tool = useReader((s) => s.tool);
  const peek = useReader((s) => s.peek);
  const returnTo = useReader((s) => s.returnTo);
  const [near, setNear] = useState<{ from: number; to: number }>({ from: 1, to: 2 });
  const fitMode = useRef(true);
  const zoomAnchor = useRef<{ page: number; x: number; y: number; cx: number; cy: number } | null>(null);

  // ── Open the file, measure every page, then read the text of each page in order in the background. ──
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await loadPaperFile(paperId);
        if (!data) throw new Error("missing file");
        const pdf = await openPdf(data);
        const dims = await Promise.all(
          Array.from({ length: pdf.numPages }, async (_, i) => {
            const p = await pdf.getPage(i + 1);
            const v = p.getViewport({ scale: 1 });
            return { w: v.width, h: v.height };
          }),
        );
        if (cancelled) {
          void pdf.loadingTask.destroy();
          return;
        }
        const meta = useLibrary.getState().papers.find((p) => p.id === paperId);
        useReader.getState().openDoc(paperId, meta?.title ?? "", pdf, dims);
        fitMode.current = true;
        applyFit(dims);
        setStatus("ready");
        let inReferences = false;
        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) return;
          const page = await pdf.getPage(i);
          const content = await getTextContent(pdf, i);
          if (cancelled) return;
          const pt = buildPageText(i, page.getViewport({ scale: 1 }), content, { inReferences });
          inReferences = pt.refsAtEnd;
          useReader.getState().setPageText(i, pt);
          if (i === 1) {
            adoptTitle(paperId, pt);
            void bodyIsSerif(page, content).then((serif) => {
              if (!cancelled) useReader.getState().setPaperSerif(serif);
            });
          }
          // Yield so scrolling stays smooth on long papers.
          await new Promise((r) => setTimeout(r, 0));
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      useReader.getState().reset();
    };
    // applyFit is stable for our purposes; it reads the container size at call time.
  }, [paperId]);

  const tops = useMemo(() => {
    const out: number[] = [];
    let y = PAD_TOP;
    for (const s of sizes) {
      out.push(y);
      y += s.h * scale + GAP;
    }
    out.push(y);
    return out;
  }, [sizes, scale]);

  const maxW = useMemo(() => Math.max(1, ...sizes.map((s) => s.w)), [sizes]);

  function applyFit(dims = useReader.getState().sizes) {
    const el = scrollRef.current;
    if (!el || !dims.length) return;
    const w = Math.max(1, ...dims.map((s) => s.w));
    const s = Math.max(MIN_SCALE, Math.min(2.2, (el.clientWidth - PAD_X * 2) / w));
    useReader.getState().setScale(Math.round(s * 1000) / 1000);
  }

  // Keep fitting the width while the reader hasn't zoomed by hand.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (fitMode.current) applyFit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pageAt = useCallback(
    (y: number) => {
      let lo = 0;
      let hi = sizes.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (tops[mid] <= y) lo = mid;
        else hi = mid - 1;
      }
      return lo + 1;
    },
    [tops, sizes.length],
  );

  const zoomTo = useCallback(
    (next: number, clientX?: number, clientY?: number) => {
      const el = scrollRef.current;
      if (!el || !sizes.length) return;
      const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next));
      const cur = useReader.getState().scale;
      if (Math.abs(s - cur) < 0.001) return;
      const box = el.getBoundingClientRect();
      const cx = (clientX ?? box.left + box.width / 2) - box.left;
      const cy = (clientY ?? box.top + box.height * 0.4) - box.top;
      const y = el.scrollTop + cy;
      const page = pageAt(y);
      const content = contentRef.current!;
      const pageLeft = (content.clientWidth - sizes[page - 1].w * cur) / 2;
      zoomAnchor.current = { page, y: (y - tops[page - 1]) / cur, x: (el.scrollLeft + cx - Math.max(PAD_X, pageLeft)) / cur, cx, cy };
      fitMode.current = false;
      useReader.getState().setScale(Math.round(s * 1000) / 1000);
    },
    [sizes, tops, pageAt],
  );

  // After a zoom, put the point that was under the cursor back under it.
  useLayoutEffect(() => {
    const a = zoomAnchor.current;
    const el = scrollRef.current;
    if (!a || !el) return;
    zoomAnchor.current = null;
    el.scrollTop = tops[a.page - 1] + a.y * scale - a.cy;
    const content = contentRef.current!;
    const pageLeft = (content.clientWidth - sizes[a.page - 1].w * scale) / 2;
    el.scrollLeft = Math.max(PAD_X, pageLeft) + a.x * scale - a.cx;
  }, [scale, tops, sizes]);

  useEffect(() => {
    viewerControls.zoomBy = (f) => zoomTo(useReader.getState().scale * f);
    viewerControls.fitWidth = () => {
      fitMode.current = true;
      applyFit();
    };
    viewerControls.scrollToPage = (p) => {
      const el = scrollRef.current;
      if (el && tops[p - 1] != null) el.scrollTo({ top: tops[p - 1] - 12 });
    };
  }, [zoomTo, tops]);

  // Pinch and ⌘/ctrl-scroll zoom around the pointer.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let pending = 1;
    let raf = 0;
    let at: { x: number; y: number } = { x: 0, y: 0 };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      pending *= Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0085));
      at = { x: e.clientX, y: e.clientY };
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          const f = pending;
          pending = 1;
          zoomTo(useReader.getState().scale * f, at.x, at.y);
        });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [zoomTo]);

  // Which pages to render, and which page the reader is on.
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !sizes.length) return;
    const top = el.scrollTop;
    const h = el.clientHeight;
    const from = Math.max(1, pageAt(top - h * 0.75));
    const to = Math.min(sizes.length, pageAt(top + h * 1.75));
    setNear((n) => (n.from === from && n.to === to ? n : { from, to }));
    useReader.getState().setCurrentPage(pageAt(top + h * 0.35));
  }, [pageAt, sizes.length]);

  useEffect(() => {
    onScroll();
  }, [onScroll, scale]);

  // Jumps from citations, map nodes and key points. Layout is read from a ref so only a new request scrolls.
  const scrollRequest = useReader((s) => s.scrollRequest);
  const layoutRef = useRef({ tops, scale });
  useEffect(() => {
    layoutRef.current = { tops, scale };
  }, [tops, scale]);
  useEffect(() => {
    const el = scrollRef.current;
    const { tops, scale } = layoutRef.current;
    if (!scrollRequest || !el || tops[scrollRequest.page - 1] == null) return;
    const target = tops[scrollRequest.page - 1] + scrollRequest.y * scale - el.clientHeight * 0.28;
    if (scrollRequest.remember) useReader.getState().setReturnTo({ top: el.scrollTop, scale });
    const far = Math.abs(target - el.scrollTop) > el.clientHeight * 3;
    el.scrollTo({ top: Math.max(0, target), behavior: far ? "auto" : "smooth" });
  }, [scrollRequest]);

  // ── Text selection: the action bar appears when the mouse is released, never while dragging. ──
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-keep-selection]")) return;
    if (useReader.getState().selection) useReader.getState().setSelection(null);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (tool !== "select" || (e.target as HTMLElement).closest("[data-keep-selection]")) return;
    const x = e.clientX;
    // Let the browser finish updating the selection (double-click selects a word after mouseup).
    setTimeout(() => {
      const content = contentRef.current;
      if (!content) return;
      const info = readTextSelection(content, x);
      if (info) useReader.getState().setSelection(info);
    }, 0);
  };

  // ── Drag selected text into the notes: it is filed where it's dropped, with its page. ──
  const onDragStart = (e: React.DragEvent) => {
    const content = contentRef.current;
    // Pressing on the selection cleared the bar; the browser still has the selection, so read it again.
    const info = content ? readTextSelection(content, e.clientX) : null;
    if (!info) return;
    passageDrag.sel = info;
    e.dataTransfer.setData(PASSAGE_TYPE, "1");
    e.dataTransfer.setData("text/plain", info.text);
    e.dataTransfer.effectAllowed = "copy";
  };
  const onDragEnd = () => {
    passageDrag.sel = null;
    usePassageOver.setState({ over: false });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && useReader.getState().selection) clearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const totalHeight = tops[tops.length - 1] ?? 0;

  return (
    <div className="relative h-full">
      <div
        ref={(el) => {
          scrollRef.current = el;
          setScrollEl(el);
        }}
        onScroll={onScroll}
        className={clsx("quiet-scroll h-full overflow-auto outline-none", tool === "box" && "box-mode", peek && "peek-original")}
        tabIndex={-1}
      >
        <div
          ref={contentRef}
          data-reader-content
          className="relative mx-auto"
          style={{ width: `max(100%, ${maxW * scale + PAD_X * 2}px)`, height: totalHeight + 40 }}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          {doc &&
            sizes.map((s, i) => (
              <div key={i} className="absolute left-1/2" style={{ top: tops[i], transform: "translateX(-50%)" }}>
                <PdfPage doc={doc} page={i + 1} width={s.w} height={s.h} scale={scale} near={i + 1 >= near.from && i + 1 <= near.to} />
              </div>
            ))}
          <SelectionBar scrollEl={scrollEl} />
        </div>
      </div>

      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 flex items-start justify-center pt-24">
          <div className="h-[70%] w-[min(620px,80%)] animate-pulse rounded-[2px] bg-white/70 shadow-card" />
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
          <p className="font-display text-title text-ink">This PDF couldn&apos;t be opened.</p>
          <p className="text-ui text-latte">It may be damaged, or protected with a password.</p>
          <button type="button" className="mt-2 rounded-full border border-latte-line/60 bg-paper px-4 py-1.5 text-ui font-medium text-ink hover:bg-parchment/60" onClick={() => useLibrary.getState().close()}>
            Back to library
          </button>
        </div>
      )}

      {returnTo && (
        <button
          type="button"
          data-keep-selection
          onClick={() => {
            const el = scrollRef.current;
            if (el) el.scrollTo({ top: (returnTo.top * scale) / returnTo.scale, behavior: "smooth" });
            useReader.getState().setReturnTo(null);
          }}
          className="glass card-in absolute left-1/2 top-4 z-20 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-ui font-medium text-ink shadow-card-hover hover:text-paprika"
        >
          <CornerUpLeft className="h-3.5 w-3.5" />
          Back to where you were
        </button>
      )}
    </div>
  );
}
