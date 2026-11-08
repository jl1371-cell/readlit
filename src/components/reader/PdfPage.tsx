"use client";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { memo, useEffect, useRef, useState } from "react";
import { pdfjs } from "@/lib/pdf/pdfjs";
import { getTextContent, pageCanvases } from "@/lib/pdf/render";
import { FigureCards, FlashLayer, HighlightLayer, LabelLayer, LensMarks, LensUnderlines, PageStatus, PointingLayer, TranslationLayer } from "./PageLayers";
import { RegionLayer } from "./RegionLayer";

interface Props {
  doc: PDFDocumentProxy;
  page: number;
  width: number;
  height: number;
  scale: number;
  /** Close enough to the viewport to render. */
  near: boolean;
}

/** Device pixels per page canvas are capped so very deep zoom can't exhaust GPU memory. */
const MAX_CANVAS_PIXELS = 14_000_000;

function PdfPageImpl({ doc, page, width, height, scale, near }: Props) {
  const holderRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(false);
  const renderedScale = useRef(0);

  // Canvas: rendered off-screen and swapped in, so zooming never flashes a blank page.
  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    if (!near) {
      const t = setTimeout(() => {
        holder.replaceChildren();
        pageCanvases.delete(page);
        renderedScale.current = 0;
        setRendered(false);
      }, 1500);
      return () => clearTimeout(t);
    }
    if (renderedScale.current === scale) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    const timer = setTimeout(
      async () => {
        try {
          const p = await doc.getPage(page);
          if (cancelled) return;
          const dpr = Math.min(window.devicePixelRatio || 1, 3);
          let renderScale = scale * dpr;
          const pixels = width * height * renderScale * renderScale;
          if (pixels > MAX_CANVAS_PIXELS) renderScale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);
          const viewport = p.getViewport({ scale: renderScale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.setAttribute("aria-hidden", "true");
          task = p.render({ canvas, viewport, background: "#ffffff" });
          await task.promise;
          if (cancelled) return;
          holder.replaceChildren(canvas);
          pageCanvases.set(page, canvas);
          renderedScale.current = scale;
          setRendered(true);
        } catch (err) {
          if ((err as { name?: string })?.name !== "RenderingCancelledException") console.warn("Page render failed", page, err);
        }
      },
      renderedScale.current ? 160 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
      task?.cancel();
    };
  }, [doc, page, near, scale, width, height]);

  // Selectable text: pdf.js lays it out in percentages, so zoom only changes a CSS variable.
  useEffect(() => {
    const container = textRef.current;
    if (!near || !container) return;
    let cancelled = false;
    let layer: { cancel: () => void } | null = null;
    void (async () => {
      try {
        const [lib, p, content] = await Promise.all([pdfjs(), doc.getPage(page), getTextContent(doc, page)]);
        if (cancelled) return;
        container.replaceChildren();
        const tl = new lib.TextLayer({ textContentSource: content, container, viewport: p.getViewport({ scale: 1 }) });
        layer = tl;
        await tl.render();
        if (cancelled) return;
        // Tag each span with its text-item index so a DOM selection maps back to the page text model.
        let k = 0;
        content.items.forEach((item, i) => {
          if (!("str" in item)) return;
          const div = tl.textDivs[k++];
          if (div) div.dataset.i = String(i);
        });
        // As pdf.js's own viewer does: while selecting, this stretches over the page, so a selection dragged through
        // blank space doesn't jump to the top of the page (Safari, older Chrome).
        const end = document.createElement("div");
        end.className = "endOfContent";
        container.append(end);
      } catch (err) {
        if ((err as { name?: string })?.name !== "AbortException") console.warn("Text layer failed", page, err);
      }
    })();
    return () => {
      cancelled = true;
      layer?.cancel();
    };
  }, [doc, page, near]);

  return (
    <div
      className="pdf-page rounded-[2px] shadow-[0_1px_2px_rgba(43,38,33,0.06),0_8px_28px_-10px_rgba(43,38,33,0.18)]"
      data-page={page}
      style={{ width: width * scale, height: height * scale, ["--scale-factor" as string]: scale }}
    >
      <div ref={holderRef} className="absolute inset-0" />
      {!rendered && <div className="absolute inset-0 animate-pulse bg-[linear-gradient(180deg,#fff,#fbf8f2)]" />}
      {near && (
        <>
          <div className="page-layer" style={{ width, height, zIndex: 1 }}>
            <LensUnderlines page={page} />
          </div>
          <div ref={textRef} className="textLayer" />
          <div className="page-layer" style={{ width, height, zIndex: 3 }}>
            <TranslationLayer page={page} pageWidth={width} pageHeight={height} />
            <LabelLayer page={page} pageWidth={width} />
            <HighlightLayer page={page} />
            <LensMarks page={page} />
            <PointingLayer page={page} />
            <FlashLayer page={page} />
          </div>
          <RegionLayer page={page} width={width} height={height} scale={scale} />
          <FigureCards page={page} scale={scale} pageWidth={width} />
          <PageStatus page={page} />
        </>
      )}
    </div>
  );
}

export const PdfPage = memo(PdfPageImpl);
