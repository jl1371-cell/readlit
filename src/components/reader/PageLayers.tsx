"use client";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import clsx from "clsx";
import { Languages, RotateCw, X } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { languageByCode } from "@/lib/languages";
import { type FitResult, ensureFonts, fitText, measureWidth, overlayFamily, sizeFactor } from "@/lib/pdf/fit";
import { paperColorAround, paperColorBehind } from "@/lib/pdf/render";
import { type Block, type PageText, type Rect, rangeRects, sentenceRects } from "@/lib/pdf/text-model";
import { type BlockTranslation, type BriefPoint, type LabelTranslation, useReader } from "@/lib/store/reader";
import { useSettings } from "@/lib/store/settings";

const INK = "rgb(22, 20, 18)";

/** A size in screen pixels inside a layer that is scaled with the page. */
const px = (n: number) => `calc(${n}px / var(--scale-factor))`;

// ─────────────────────────────────────────────────────────────────────────────
// In-place translation
// ─────────────────────────────────────────────────────────────────────────────

export const TranslationLayer = memo(function TranslationLayer({ page, pageWidth, pageHeight }: { page: number; pageWidth: number; pageHeight: number }) {
  const pt = useReader((s) => s.pageText[page]);
  const items = useReader(useShallow((s) => Object.values(s.translations).filter((t) => t.page === page)));
  const lang = useSettings((s) => s.lang);
  if (!pt) return null;
  return (
    <>
      {items.map((t) => (
        <BlockTranslationView key={t.blockId} t={t} pt={pt} lang={lang} pageWidth={pageWidth} pageHeight={pageHeight} />
      ))}
    </>
  );
});

/** Split the shown sentences into runs of neighbours: each run is replaced as one piece of text. */
function runsOf(block: Block, ids: Set<string>): string[][] {
  const runs: string[][] = [];
  let cur: string[] = [];
  for (const sid of block.sids) {
    if (ids.has(sid)) cur.push(sid);
    else if (cur.length) {
      runs.push(cur);
      cur = [];
    }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

function BlockTranslationView({ t, pt, lang, pageWidth, pageHeight }: { t: BlockTranslation; pt: PageText; lang: string; pageWidth: number; pageHeight: number }) {
  const block = pt.blocks.find((b) => b.id === t.blockId);
  if (!block || t.hidden) return null;
  const ready = new Set(t.shown.filter((sid) => sid in t.sentences));
  const waiting = t.shown.filter((sid) => t.pending.includes(sid));
  return (
    <>
      {runsOf(block, ready).map((run) => (
        <TranslatedRun key={run.join(",")} block={block} pt={pt} run={run} t={t} lang={lang} pageWidth={pageWidth} pageHeight={pageHeight} />
      ))}
      {waiting.length > 0 && <PendingMark block={block} pt={pt} sids={waiting} />}
    </>
  );
}

interface Layout {
  left: number;
  top: number;
  width: number;
  indent: number;
  patches: Rect[];
  fit: FitResult;
  family: string;
  weight: number;
  align: "justify" | "left" | "center";
  clipHeight: number | null;
}

function TranslatedRun({
  block,
  pt,
  run,
  t,
  lang,
  pageWidth,
  pageHeight,
}: {
  block: Block;
  pt: PageText;
  run: string[];
  t: BlockTranslation;
  lang: string;
  pageWidth: number;
  pageHeight: number;
}) {
  const setBlockHidden = useReader((s) => s.setBlockHidden);
  // pdf.js's judgement of the body face wins when it says serif; the text layer's generic family often says sans.
  const serif = useReader((s) => block.serif || s.paperSerif === true);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [expanded, setExpanded] = useState(false);
  const cjk = languageByCode(lang).cjk;
  const texts = run.map((sid) => t.sentences[sid] ?? "");
  const joined = texts.join(cjk ? "" : " ");
  const runKey = run.join(",");

  useEffect(() => {
    let cancelled = false;
    const sents = run.map((sid) => pt.sentences.find((s) => s.id === sid)).filter((s): s is NonNullable<typeof s> => !!s);
    if (!sents.length) return;
    const a = sents[0].a;
    const b = sents[sents.length - 1].b;
    const rects = rangeRects(pt, block, a, b);
    if (!rects.length) return;
    const whole = run.length === block.sids.length;
    const heading = block.kind === "heading";
    const family = overlayFamily(lang, serif);
    const weight = heading ? 600 : 400;
    const base = Math.min(block.size, block.kind === "heading" ? block.size : pt.bodySize * 1.6) * sizeFactor(lang);
    let left = block.rect.x;
    let width = block.rect.w;
    const first = rects[0];
    const last = rects[rects.length - 1];
    const indent = Math.max(0, first.x - left);
    const pitch = block.lines.length > 1 ? block.pitch : block.size * 1.25;

    void ensureFonts(family, weight, joined).then(() => {
      if (cancelled) return;
      let fit: FitResult;
      let patches: Rect[];
      let clipHeight: number | null = null;
      const top = first.y;
      // A one-line heading or caption whose translation is wider than the original grows sideways, not downward.
      if (whole && block.lines.length === 1) {
        const need = measureWidth(joined, base, family, weight, lang);
        if (need > width) {
          const centered = Math.abs(block.rect.x + block.rect.w / 2 - pageWidth / 2) < 12;
          const room = centered ? pageWidth - 72 : pageWidth - 36 - left;
          const w = Math.min(need + 2, room);
          if (centered) left = pageWidth / 2 - w / 2;
          width = w;
        }
      }
      if (whole) {
        // The whole paragraph: one patch over it; the text may use the leading CJK reads best with.
        const strict = block.rect.y + block.rect.h - top;
        fit = fitText({
          text: joined,
          width,
          indent,
          maxHeight: strict,
          base,
          family,
          weight,
          leading: heading || block.lines.length === 1 ? { multiples: [1.25] } : { multiples: [1.5, 1.4, 1.3, 1.25] },
          lang,
        });
        let bottom = block.rect.y + block.rect.h;
        if (fit.overflow) {
          // Spill into the empty space below, down to the next text, before giving up.
          const limit = spaceBelow(pt, block, pageHeight);
          const roomy = fitText({ text: joined, width, indent, maxHeight: limit - top, base, family, weight, leading: { multiples: [1.3, 1.25] }, lang });
          fit = roomy;
          if (roomy.overflow) clipHeight = limit - top;
          bottom = Math.max(bottom, top + Math.min(roomy.height, limit - top));
        }
        const x0 = Math.min(block.rect.x, left);
        const x1 = Math.max(block.rect.x + block.rect.w, left + width);
        patches = [pad({ x: x0, y: block.rect.y, w: x1 - x0, h: bottom - block.rect.y }, 1.6, 1.2)];
      } else {
        // Part of a paragraph: keep the paper's line rhythm so the original text around it stays aligned.
        const endsEarly = last.x + last.w < left + width - block.size * 1.2;
        fit = fitText({
          text: joined,
          width,
          indent,
          maxHeight: rects.length * pitch,
          base,
          family,
          weight,
          leading: { pitch },
          lastLine: endsEarly ? { maxLines: rects.length, maxRight: last.x + last.w - left } : undefined,
          lang,
        });
        if (fit.overflow) clipHeight = rects.length * pitch;
        // Where the run starts or ends mid-line, the neighbouring sentence is right there: keep the patch tight.
        const startsMid = first.x > left + 1;
        patches = rects.map((r, i) => {
          const l = i === 0 && startsMid ? 0.3 : 1.2;
          const rr = i === rects.length - 1 && endsEarly ? 0.2 : 1.2;
          return { x: r.x - l, y: r.y - 0.7, w: r.w + l + rr, h: r.h + 1.4 };
        });
      }
      // Align the first translated baseline with the original first baseline.
      const firstLine = block.lines.map((li) => pt.lines[li]).find((l) => l.rect.y + l.rect.h > first.y + first.h / 2) ?? pt.lines[block.lines[0]];
      const textTop = firstLine.base - (fit.lineHeight / 2 + 0.36 * fit.size);
      const centeredLine = block.lines.length === 1 && Math.abs(block.rect.x + block.rect.w / 2 - pageWidth / 2) < 12;
      const align = block.lines.length > 1 && !heading ? "justify" : centeredLine ? "center" : "left";
      setLayout({ left, top: textTop, width, indent, patches, fit, family, weight, align, clipHeight });
    });
    return () => {
      cancelled = true;
    };
    // `joined` captures the text and `runKey` the sentences; geometry depends on the block.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block, pt, runKey, joined, lang, pageHeight, pageWidth, serif]);

  const color = useMemo(() => (layout ? paperColorAround(block.page, block.rect, pageWidth) : "#fff"), [layout, block, pageWidth]);

  if (!layout) return null;
  const { fit } = layout;
  const clipped = layout.clipHeight != null && !expanded;
  return (
    <div className="translation-block tr-in group">
      {layout.patches.map((r, i) => (
        <div key={i} className="pointer-events-auto absolute" style={{ left: r.x, top: r.y, width: r.w, height: r.h, background: color }} />
      ))}
      <div
        lang={lang}
        className={clsx("tr-text pointer-events-auto absolute select-text", clipped && "tr-clip")}
        style={{
          left: layout.left,
          top: layout.top,
          width: layout.width,
          fontFamily: layout.family,
          fontWeight: layout.weight,
          fontSize: fit.size,
          lineHeight: `${fit.lineHeight}px`,
          textIndent: layout.indent,
          textAlign: layout.align,
          color: INK,
          maxHeight: clipped ? layout.clipHeight! : undefined,
          overflow: clipped ? "hidden" : undefined,
          background: expanded && layout.clipHeight != null ? color : undefined,
          zIndex: expanded ? 2 : undefined,
        }}
      >
        {run.map((sid, i) => (
          <span key={sid} data-sid={sid}>
            {i > 0 && !languageByCode(lang).cjk ? " " : ""}
            {t.sentences[sid]}
          </span>
        ))}
      </div>
      {/* Quiet affordances, only on hover: the AI rule and a way back to the original. */}
      <div
        className="absolute rounded-full bg-paprika-soft/70 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
        style={{ left: layout.left - 5, top: layout.top, width: px(1.5), height: Math.max(fit.height, fit.lineHeight) }}
      />
      <button
        type="button"
        aria-label="Show the original"
        title="Show the original"
        onClick={() => setBlockHidden(block.id, true)}
        className="pointer-events-auto absolute flex items-center justify-center rounded-full border border-latte-line/50 bg-paper text-latte-deep opacity-0 shadow-card transition-opacity duration-150 hover:text-paprika group-hover:opacity-100"
        style={{ left: `calc(${layout.left - 5}px - ${px(11)})`, top: `calc(${layout.top}px - ${px(22)})`, width: px(22), height: px(22) }}
      >
        <Languages style={{ width: px(12), height: px(12) }} strokeWidth={2} />
      </button>
      {layout.clipHeight != null && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="pointer-events-auto absolute rounded-full border border-latte-line/50 bg-paper text-latte-deep shadow-card hover:text-ink"
          style={{
            left: layout.left + layout.width - 52,
            top: layout.top + (expanded ? fit.height : layout.clipHeight!) + 2,
            fontSize: px(12),
            padding: `${px(1)} ${px(8)}`,
            zIndex: 3,
          }}
        >
          {expanded ? "Less" : "More"}
        </button>
      )}
    </div>
  );
}

function pad(r: Rect, dx: number, dy: number): Rect {
  return { x: r.x - dx, y: r.y - dy, w: r.w + 2 * dx, h: r.h + 2 * dy };
}

/** How far a paragraph may grow downward: to just above the next text below it in the same column. */
function spaceBelow(pt: PageText, block: Block, pageHeight: number): number {
  const bottom = block.rect.y + block.rect.h;
  let limit = pageHeight - 30;
  for (const b of pt.blocks) {
    if (b === block || b.rect.y < bottom - 1) continue;
    const overlap = b.rect.x < block.rect.x + block.rect.w && b.rect.x + b.rect.w > block.rect.x;
    if (overlap) limit = Math.min(limit, b.rect.y - 2.5);
  }
  return Math.max(limit, bottom);
}

function PendingMark({ block, pt, sids }: { block: Block; pt: PageText; sids: string[] }) {
  const rects = sids.flatMap((sid) => sentenceRects(pt, sid));
  if (!rects.length) return null;
  const top = Math.min(...rects.map((r) => r.y));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return (
    <div
      className="tr-pending absolute rounded-full bg-paprika-soft"
      style={{ left: block.rect.x - 6, top, width: px(2), height: bottom - top }}
      aria-hidden
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Labels inside a boxed figure or table
// ─────────────────────────────────────────────────────────────────────────────

export const LabelLayer = memo(function LabelLayer({ page, pageWidth }: { page: number; pageWidth: number }) {
  const labels = useReader(useShallow((s) => Object.values(s.labels).filter((l) => l.page === page && !l.hidden)));
  const lang = useSettings((s) => s.lang);
  return (
    <>
      {labels.map((l) => (
        <LabelView key={l.id} l={l} lang={lang} pageWidth={pageWidth} />
      ))}
    </>
  );
});

function LabelView({ l, lang, pageWidth }: { l: LabelTranslation; lang: string; pageWidth: number }) {
  const [fit, setFit] = useState<FitResult | null>(null);
  const family = overlayFamily(lang, l.serif);
  useEffect(() => {
    if (l.status !== "done" || !l.text) return;
    let cancelled = false;
    void ensureFonts(family, 400, l.text).then(() => {
      if (cancelled) return;
      setFit(
        fitText({
          text: l.text!,
          width: Math.max(l.rect.w, l.size * 2),
          indent: 0,
          maxHeight: l.rect.h,
          base: l.size * sizeFactor(lang),
          family,
          weight: 400,
          leading: { multiples: [1.15] },
          lang,
          minScale: 0.7,
          nowrap: true,
        }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [l, family, lang]);
  const color = useMemo(() => (fit ? (l.sample ? paperColorBehind(l.page, l.sample, pageWidth) : paperColorAround(l.page, l.rect, pageWidth)) : "#fff"), [fit, l, pageWidth]);

  if (l.status === "pending") {
    return <div className="tr-shimmer absolute rounded-[1px]" style={{ left: l.rect.x - 1, top: l.rect.y - 0.5, width: l.rect.w + 2, height: l.rect.h + 1 }} />;
  }
  if (l.status !== "done" || !fit || !l.text) return null;
  return (
    <div
      lang={lang}
      className="translation-block tr-in pointer-events-auto absolute flex items-center whitespace-nowrap"
      title={l.original}
      style={{
        left: l.rect.x - 1,
        top: l.rect.y - 0.5,
        minWidth: l.rect.w + 2,
        height: l.rect.h + 1,
        padding: "0 1px",
        background: color,
        fontFamily: family,
        fontSize: fit.size,
        lineHeight: 1.1,
        color: INK,
      }}
    >
      {l.text}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The reader's own highlights, AI key points, and the flash after a jump
// ─────────────────────────────────────────────────────────────────────────────

const HL_COLOR = {
  champagne: "rgba(240, 215, 163, 0.62)",
  sage: "rgba(172, 202, 178, 0.5)",
  crystal: "rgba(166, 209, 230, 0.5)",
} as const;

export const HighlightLayer = memo(function HighlightLayer({ page }: { page: number }) {
  const highlights = useReader(useShallow((s) => s.highlights.filter((h) => h.page === page)));
  return (
    <>
      {highlights.flatMap((h) =>
        h.rects.map((r, i) => (
          <div
            key={`${h.id}-${i}`}
            className="absolute rounded-[1.5px] mix-blend-multiply"
            style={{ left: r.x - 0.5, top: r.y - 0.4, width: r.w + 1, height: r.h + 0.8, background: HL_COLOR[h.color] }}
          />
        )),
      )}
    </>
  );
});

export const LENS_COLOR = {
  claim: { line: "#D14B28", label: "Claim", text: "#A33A1F" },
  method: { line: "#7FA5BC", label: "Method", text: "#4E7994" },
  result: { line: "#7FA885", label: "Result", text: "#4F7757" },
  limitation: { line: "#D8923A", label: "Limitation", text: "#A87025" },
} as const;

const NO_POINTS: BriefPoint[] = [];

/** The brief's key points on one page, when the reader has them marked. */
function usePagePoints(page: number): BriefPoint[] {
  const on = useSettings((s) => s.marks);
  const points = useReader(useShallow((s) => s.brief.data?.points.filter((p) => p.page === page) ?? NO_POINTS));
  return on ? points : NO_POINTS;
}

export const LensUnderlines = memo(function LensUnderlines({ page }: { page: number }) {
  const items = usePagePoints(page);
  const pt = useReader((s) => s.pageText[page]);
  if (!items.length || !pt) return null;
  return (
    <>
      {items.flatMap((it) =>
        sentenceRects(pt, it.sid).map((r, i) => (
          <div
            key={`${it.sid}-${i}`}
            className="lens-in absolute"
            style={{ left: r.x, top: r.y + r.h - 0.6, width: r.w, height: 0, borderBottom: `${px(1.5)} dotted ${LENS_COLOR[it.kind].line}` }}
          />
        )),
      )}
    </>
  );
});

export const LensMarks = memo(function LensMarks({ page }: { page: number }) {
  const items = usePagePoints(page);
  const pt = useReader((s) => s.pageText[page]);
  if (!items.length || !pt) return null;
  return (
    <>
      {items.map((it) => {
        const rects = sentenceRects(pt, it.sid);
        if (!rects.length) return null;
        const sentence = pt.sentences.find((s) => s.id === it.sid);
        const block = pt.blocks.find((b) => b.id === sentence?.block);
        const top = Math.min(...rects.map((r) => r.y));
        const bottom = Math.max(...rects.map((r) => r.y + r.h));
        const x = (block?.rect.x ?? rects[0].x) - 7;
        const c = LENS_COLOR[it.kind];
        return (
          <TooltipPrimitive.Root key={it.sid} delayDuration={120}>
            <TooltipPrimitive.Trigger asChild>
              <button
                type="button"
                aria-label={`${c.label}: ${it.text}`}
                className="lens-in pointer-events-auto absolute rounded-full transition-[filter] hover:brightness-90"
                style={{ left: x, top, width: px(3), height: bottom - top, background: c.line, opacity: 0.85 }}
              />
            </TooltipPrimitive.Trigger>
            <TooltipPrimitive.Portal>
              <TooltipPrimitive.Content side="left" sideOffset={8} className="z-[80] max-w-[280px] rounded-xl border border-latte-line/40 bg-paper px-3 py-2.5 shadow-card-hover">
                <div className="text-label font-medium" style={{ color: c.text }}>
                  {c.label}
                </div>
                <div className="mt-0.5 text-body-sm text-ink">{it.text}</div>
              </TooltipPrimitive.Content>
            </TooltipPrimitive.Portal>
          </TooltipPrimitive.Root>
        );
      })}
    </>
  );
});

/** Where a page chip or key point points, while the pointer rests on it: soft, steady, gone when it moves away. */
export const PointingLayer = memo(function PointingLayer({ page }: { page: number }) {
  const pointing = useReader((s) => (s.pointing?.page === page ? s.pointing : null));
  if (!pointing) return null;
  return (
    <div className="pointer-events-none">
      {pointing.rects.map((r, i) => (
        <div key={i} className="card-in absolute rounded-[2px] bg-paprika/[0.13] ring-1 ring-paprika/25" style={{ left: r.x - 1.5, top: r.y - 1, width: r.w + 3, height: r.h + 2 }} />
      ))}
    </div>
  );
});

export const FlashLayer = memo(function FlashLayer({ page }: { page: number }) {
  const flash = useReader((s) => (s.flash?.page === page ? s.flash : null));
  if (!flash) return null;
  return (
    <div key={flash.key}>
      {flash.rects.map((r, i) => (
        <div key={i} className="flash-in absolute rounded-[2px]" style={{ left: r.x - 1.5, top: r.y - 1, width: r.w + 3, height: r.h + 2 }} />
      ))}
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Text read from an image, shown beside the region it came from
// ─────────────────────────────────────────────────────────────────────────────

export const FigureCards = memo(function FigureCards({ page, scale, pageWidth }: { page: number; scale: number; pageWidth: number }) {
  const cards = useReader(useShallow((s) => Object.values(s.figureTexts).filter((f) => f.page === page)));
  const lang = useSettings((s) => s.lang);
  if (!cards.length) return null;
  return (
    <>
      {cards.map((f) => {
        const roomRight = (pageWidth - f.rect.x - f.rect.w) * scale;
        const left = roomRight > 300 ? (f.rect.x + f.rect.w) * scale + 10 : Math.max(8, (f.rect.x + f.rect.w) * scale - 290);
        const top = roomRight > 300 ? f.rect.y * scale : (f.rect.y + f.rect.h) * scale + 10;
        return (
          <div key={f.id} className="card-in absolute z-[6] w-[290px] rounded-2xl border border-latte-line/40 bg-paper p-3 shadow-card-hover" style={{ left, top }}>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-label font-medium text-latte">Text in this image</span>
              <button
                type="button"
                aria-label="Close"
                className="rounded-full p-1 text-latte hover:bg-parchment/70 hover:text-ink"
                onClick={() =>
                  useReader.setState((s) => {
                    const next = { ...s.figureTexts };
                    delete next[f.id];
                    return { figureTexts: next };
                  })
                }
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {f.status === "pending" && <div className="py-2 text-ui text-latte">Reading the image…</div>}
            {f.status === "error" && <div className="py-2 text-ui text-latte">Couldn&apos;t read this image.</div>}
            {f.status === "done" && !f.lines.length && <div className="py-2 text-ui text-latte">No text found in this area.</div>}
            {f.status === "done" && f.lines.length > 0 && (
              <ul className="quiet-scroll max-h-[320px] space-y-2 overflow-auto pr-1" lang={lang}>
                {f.lines.map((line, i) => (
                  <li key={i}>
                    <div className="text-body-sm text-ink">{line.text}</div>
                    <div lang="en" className="text-label text-latte">{line.original}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Per-page account: what is still translating, and what failed
// ─────────────────────────────────────────────────────────────────────────────

export const PageStatus = memo(function PageStatus({ page }: { page: number }) {
  const { pending, failed } = useReader(
    useShallow((s) => {
      let pending = 0;
      let failed = 0;
      for (const t of Object.values(s.translations)) {
        if (t.page !== page || t.hidden) continue;
        if (t.pending.length) pending += 1;
        if (t.failed.length) failed += 1;
      }
      return { pending, failed };
    }),
  );
  const retryPage = useReader((s) => s.retryPage);
  if (!failed) return null;
  return (
    <div className="absolute right-2 top-2 z-[6] flex items-center gap-1 rounded-full border border-latte-line/50 bg-paper/95 py-0.5 pl-2.5 pr-1 text-caption text-latte-deep shadow-card">
      <span className="tabular">
        {failed} {failed === 1 ? "paragraph" : "paragraphs"} not translated
      </span>
      <button
        type="button"
        onClick={() => retryPage(page)}
        disabled={pending > 0}
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-ink hover:bg-parchment/70"
      >
        <RotateCw className="h-3 w-3" />
        Retry
      </button>
    </div>
  );
});
