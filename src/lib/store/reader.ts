"use client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { create } from "zustand";
import { postJSON } from "@/lib/ai/client";
import { englishOf } from "@/lib/ai/pair";
import { dbGet, dbSet, keys } from "@/lib/db";
import { uid } from "@/lib/hash";
import {
  type Block,
  type PageText,
  type Rect,
  pageForModel,
  pageTranslatable,
  runsInRect,
  selectionTranslatable,
  sentenceRects,
} from "@/lib/pdf/text-model";
import { pngSize } from "@/lib/pdf/render";
import { type LensKind, pairsWanted, useSettings } from "./settings";

export type Tool = "select" | "box";

export interface Anchor {
  /** Scroll-content coordinates (px): the point the action bar hangs from, and the top of the selection. */
  x: number;
  y: number;
  top: number;
}

export interface TextSelectionInfo {
  kind: "text";
  text: string;
  pages: number[];
  sids: string[];
  /** Selected sentences grouped by paragraph, in reading order. */
  byBlock: { blockId: string; sids: string[] }[];
  anchor: Anchor;
  words: number;
  /** Page rectangles of the selection (scale-1 page points), for highlights. */
  rects: { page: number; rects: Rect[] }[];
}

export interface RegionSelectionInfo {
  kind: "region";
  page: number;
  rect: Rect;
  anchor: Anchor;
}

export type ReaderSelection = TextSelectionInfo | RegionSelectionInfo;

export interface BlockTranslation {
  blockId: string;
  page: number;
  /** Finished translations by sentence id. */
  sentences: Record<string, string>;
  /** Sentences the reader wants shown in place, in reading order. */
  shown: string[];
  /** Sentences waiting for a translation. */
  pending: string[];
  /** Sentences whose translation failed; they stay in the original until retried. */
  failed: string[];
  /** The reader switched this paragraph back to the original. */
  hidden?: boolean;
}

interface SavedBlock {
  s: Record<string, string>;
  shown: string[];
}

export interface LabelTranslation {
  id: string;
  page: number;
  rect: Rect;
  /** Where the patch takes its colour from, when that isn't the patch itself (a label read from an image). */
  sample?: Rect;
  original: string;
  size: number;
  serif: boolean;
  status: "pending" | "done" | "error";
  text?: string;
  hidden?: boolean;
}

export interface FigureText {
  id: string;
  page: number;
  rect: Rect;
  status: "pending" | "done" | "error";
  lines: { original: string; text: string }[];
}

export interface Highlight {
  id: string;
  page: number;
  rects: Rect[];
  text: string;
  sids: string[];
  color: "champagne" | "sage" | "crystal";
  createdAt: number;
}

/** One of the paper's key points, anchored to the sentence that states it. */
export interface BriefPoint {
  sid: string;
  page: number;
  kind: LensKind;
  /** The point restated in the reader's language. */
  text: string;
}

/** A figure or table to look at first, by its caption sentence. */
export interface LookFirst {
  sid: string;
  page: number;
  label: string;
  why: string;
}

/**
 * What a reader wants in the first minute (Keshav's first pass): what kind of paper it is and on what evidence, what is
 * new and against what, the gist, where to look first, the key points, and questions to read with.
 */
export interface Brief {
  gist: string;
  /** The kind of paper and the form of its evidence. Briefs written before this field have none. */
  kind?: string;
  /** What is new compared with the earlier work the paper names, by the sentence that says it. */
  novelty?: { sid: string; page: number; text: string };
  lookFirst?: LookFirst[];
  points: BriefPoint[];
  questions: string[];
  /** For each question, the sentence where the paper answers it ("" when it gave none that exists). */
  questionSids?: string[];
  /** The language it was written in; a brief in another language is written again. */
  lang: string;
  /** The English version of the gist ("gist"), each point ("pt:<sid>") and each question ("q<i>"). */
  en?: Record<string, string>;
}

interface BriefState {
  status: "idle" | "loading" | "ready" | "error";
  data: Brief | null;
  error?: string;
  /** The English version of the gist, while it is being written (or when it couldn't be). */
  pairing?: "loading" | "error";
}

interface ReaderState {
  paperId: string | null;
  title: string;
  doc: PDFDocumentProxy | null;
  sizes: { w: number; h: number }[];
  pageText: Record<number, PageText>;
  textPages: number;
  scale: number;
  tool: Tool;
  selection: ReaderSelection | null;
  translations: Record<string, BlockTranslation>;
  translateAll: boolean;
  labels: Record<string, LabelTranslation>;
  figureTexts: Record<string, FigureText>;
  highlights: Highlight[];
  brief: BriefState;
  flash: { page: number; rects: Rect[]; key: number } | null;
  /** Sentences shown softly in the paper while the pointer rests on a reference to them (a page chip, a key point). */
  pointing: { page: number; rects: Rect[] } | null;
  scrollRequest: { page: number; y: number; key: number; remember?: boolean } | null;
  /** Where "Back" returns to after following a citation (scroll offset in px at the scale of the time). */
  returnTo: { top: number; scale: number } | null;
  currentPage: number;
  peek: boolean;
  /** ⌘ (Ctrl elsewhere) is held: a drag on the page draws a box, as with the Box tool. */
  boxArmed: boolean;
  /** The paper's body face is serif (null: unknown); translated text follows it. */
  paperSerif: boolean | null;
  notice: string | null;

  openDoc: (paperId: string, title: string, doc: PDFDocumentProxy, sizes: { w: number; h: number }[]) => void;
  reset: () => void;
  setPageText: (page: number, pt: PageText) => void;
  setScale: (s: number) => void;
  setTool: (t: Tool) => void;
  setSelection: (s: ReaderSelection | null) => void;
  setCurrentPage: (p: number) => void;
  setPeek: (on: boolean) => void;
  setBoxArmed: (on: boolean) => void;
  setPaperSerif: (serif: boolean | null) => void;
  setNotice: (msg: string | null) => void;
  setReturnTo: (r: { top: number; scale: number } | null) => void;

  translateSentences: (items: { blockId: string; sids: string[] }[]) => void;
  translateBlocks: (blockIds: string[]) => void;
  retryPage: (page: number) => void;
  setTranslateAll: (on: boolean) => void;
  ensurePageTranslated: (page: number) => void;
  setBlockHidden: (blockId: string, hidden: boolean) => void;
  restoreOriginal: () => void;
  reloadTranslations: () => Promise<void>;
  translateRegion: (page: number, rect: Rect, image?: () => Promise<string | null>) => void;

  addHighlight: (h: Omit<Highlight, "id" | "createdAt">) => Highlight;
  removeHighlight: (id: string) => void;

  /** Write the brief; it is written once per paper and language, then kept. */
  loadBrief: (opts?: { force?: boolean }) => Promise<void>;
  /** Write the English version of the brief, when the reader wants English under what the AI writes. */
  pairBrief: () => Promise<void>;

  jumpTo: (page: number, sids?: string[], opts?: { remember?: boolean }) => void;
  /** Show these sentences softly where they are (no scrolling); null clears it. */
  pointAt: (page: number | null, sids?: string[]) => void;
  paperText: () => string;
  /** The language the paper is written in, guessed from its text. */
  paperLang: () => string;
}

// ── Translation queue: a few requests at a time; each paragraph appears as soon as it is finished. ──
type Job = { items: { blockId: string; sids: string[] }[] };
const queue: Job[] = [];
let running = 0;
const MAX_CONCURRENT = 4;
let generation = 0;

/** Letters and digits only, lower case: for telling whether two pieces of text say the same thing. */
function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** The brief whose English version is being written ("<paper>:<lang>"), so it is asked for once. */
let pairing: string | null = null;

// The brief is written once the whole text is read, and only after the saved one (if any) has been looked for.
let briefCheckedFor: string | null = null;
function maybeBrief() {
  const s = useReader.getState();
  if (!s.paperId || briefCheckedFor !== s.paperId || s.brief.status !== "idle") return;
  if (!s.doc || s.textPages < s.doc.numPages) return;
  void s.loadBrief();
}

export function pageOfBlock(blockId: string): number {
  return Number(blockId.slice(1, blockId.indexOf("b")));
}

export function pageOfSentence(sid: string): number {
  return Number(sid.slice(1, sid.indexOf("s")));
}

function blockOf(pageText: Record<number, PageText>, blockId: string): { pt: PageText; block: Block } | null {
  const pt = pageText[pageOfBlock(blockId)];
  const block = pt?.blocks.find((b) => b.id === blockId);
  return pt && block ? { pt, block } : null;
}

/** Context for a request: the paragraph itself when only part of it is asked for, and neighbours when it is cut. */
function contextFor(pageText: Record<number, PageText>, block: Block, partial: boolean): string | undefined {
  const pt = pageText[block.page];
  const idx = pt.blocks.indexOf(block);
  const cutStart = /^\p{Ll}/u.test(block.text.trimStart());
  const cutEnd = !/[.!?:;)\]"”。！？]\s*$/u.test(block.text);
  if (!partial && !cutStart && !cutEnd) return undefined;
  const parts: string[] = [];
  if (cutStart) {
    const prev = idx > 0 ? pt.blocks[idx - 1] : pageText[block.page - 1]?.blocks.at(-1);
    if (prev) parts.push(`(previous text) …${prev.text.slice(-400)}`);
  }
  parts.push(block.text);
  if (cutEnd) {
    const next = idx < pt.blocks.length - 1 ? pt.blocks[idx + 1] : pageText[block.page + 1]?.blocks[0];
    if (next) parts.push(`(next text) ${next.text.slice(0, 400)}…`);
  }
  return parts.join("\n");
}

export const useReader = create<ReaderState>((set, get) => {
  const persistTranslations = () => {
    const { paperId, translations } = get();
    if (!paperId) return;
    const lang = useSettings.getState().lang;
    const saved: Record<string, SavedBlock> = {};
    for (const t of Object.values(translations)) {
      if (Object.keys(t.sentences).length) saved[t.blockId] = { s: t.sentences, shown: t.hidden ? [] : t.shown };
    }
    void dbSet(keys.translations(paperId, lang), saved);
  };

  const pump = () => {
    while (running < MAX_CONCURRENT && queue.length) {
      const job = queue.shift()!;
      running += 1;
      const gen = generation;
      void runJob(job, gen).finally(() => {
        running -= 1;
        pump();
      });
    }
  };

  const finish = (items: Job["items"], ok: Record<string, Record<string, string>> | null) =>
    set((s) => {
      const translations = { ...s.translations };
      for (const { blockId, sids } of items) {
        const t = translations[blockId];
        if (!t) continue;
        const sentences = { ...t.sentences, ...(ok?.[blockId] ?? {}) };
        const missing = sids.filter((id) => !(id in sentences));
        translations[blockId] = {
          ...t,
          sentences,
          pending: t.pending.filter((id) => !sids.includes(id)),
          failed: [...t.failed.filter((id) => !sids.includes(id)), ...missing],
        };
      }
      return { translations };
    });

  const runJob = async ({ items }: Job, gen: number) => {
    const state = get();
    const lang = useSettings.getState().lang;
    const passages = items
      .map(({ blockId, sids }) => {
        const found = blockOf(state.pageText, blockId);
        if (!found) return null;
        const { pt, block } = found;
        const sentences = sids
          .map((id) => ({ id, text: pt.sentences.find((x) => x.id === id)?.text ?? "" }))
          .filter((x) => x.text);
        if (!sentences.length) return null;
        return { id: blockId, context: contextFor(state.pageText, block, sids.length < block.sids.length), sentences };
      })
      .filter((p): p is NonNullable<typeof p> => !!p);
    if (!passages.length) return finish(items, {});
    try {
      const res = await postJSON<{ passages: { id: string; sentences: { id: string; text: string }[] }[] }>("/api/translate", {
        title: state.title,
        lang,
        passages,
      });
      if (gen !== generation) return;
      const ok: Record<string, Record<string, string>> = {};
      for (const p of res.passages) {
        const asked = new Set(items.find((i) => i.blockId === p.id)?.sids ?? []);
        ok[p.id] = {};
        for (const x of p.sentences) if (asked.has(x.id) && x.text.trim()) ok[p.id][x.id] = x.text.trim();
      }
      finish(items, ok);
      persistTranslations();
    } catch (err) {
      if (gen !== generation) return;
      finish(items, null);
      set({ notice: errorMessage(err, "Translation didn't finish. Try again in a moment.") });
    }
  };

  return {
    paperId: null,
    title: "",
    doc: null,
    sizes: [],
    pageText: {},
    textPages: 0,
    scale: 1,
    tool: "select",
    selection: null,
    translations: {},
    translateAll: false,
    labels: {},
    figureTexts: {},
    highlights: [],
    brief: { status: "idle", data: null },
    flash: null,
    pointing: null,
    scrollRequest: null,
    returnTo: null,
    currentPage: 1,
    peek: false,
    boxArmed: false,
    paperSerif: null,
    notice: null,

    openDoc: (paperId, title, doc, sizes) => {
      queue.length = 0;
      generation += 1;
      set({
        paperId,
        title,
        doc,
        sizes,
        pageText: {},
        textPages: 0,
        selection: null,
        translations: {},
        translateAll: false,
        labels: {},
        figureTexts: {},
        highlights: [],
        brief: { status: "idle", data: null },
        flash: null,
        pointing: null,
        returnTo: null,
        currentPage: 1,
        tool: "select",
        paperSerif: null,
      });
      void (async () => {
        const [hl, brief] = await Promise.all([dbGet<Highlight[]>(keys.highlights(paperId)), dbGet<Brief>(keys.brief(paperId))]);
        if (get().paperId !== paperId) return;
        set({ highlights: hl ?? [] });
        briefCheckedFor = paperId;
        if (brief && brief.lang === useSettings.getState().lang && brief.kind !== undefined && get().brief.status === "idle") {
          set({ brief: { status: "ready", data: brief } });
          if (pairsWanted() && !brief.en) void get().pairBrief();
        } else maybeBrief();
        await get().reloadTranslations();
      })();
    },

    reset: () => {
      queue.length = 0;
      generation += 1;
      const doc = get().doc;
      if (doc) void doc.loadingTask.destroy();
      set({ paperId: null, doc: null, sizes: [], pageText: {}, selection: null, translations: {}, labels: {}, figureTexts: {} });
    },

    setPageText: (page, pt) => {
      set((s) => ({ pageText: { ...s.pageText, [page]: pt }, textPages: s.textPages + (s.pageText[page] ? 0 : 1) }));
      const { translateAll, currentPage } = get();
      if (translateAll && Math.abs(page - currentPage) <= 1) get().ensurePageTranslated(page);
      maybeBrief();
    },
    setScale: (scale) => set({ scale }),
    setTool: (tool) => set({ tool }),
    setSelection: (selection) => set({ selection }),
    setCurrentPage: (currentPage) => {
      if (currentPage === get().currentPage) return;
      set({ currentPage });
      if (get().translateAll) {
        get().ensurePageTranslated(currentPage);
        get().ensurePageTranslated(currentPage + 1);
      }
    },
    setPeek: (peek) => set({ peek }),
    setPaperSerif: (paperSerif) => set({ paperSerif }),
    setBoxArmed: (boxArmed) => {
      if (get().boxArmed !== boxArmed) set({ boxArmed });
    },
    setNotice: (notice) => set({ notice }),
    setReturnTo: (returnTo) => set({ returnTo }),

    translateSentences: (items) => {
      const { translations, pageText } = get();
      const next = { ...translations };
      const fresh: Job["items"] = [];
      for (const { blockId, sids } of items) {
        const found = blockOf(pageText, blockId);
        if (!found || !selectionTranslatable(found.block)) continue;
        const order = found.block.sids;
        const wanted = sids.filter((id) => order.includes(id));
        if (!wanted.length) continue;
        const t: BlockTranslation = next[blockId] ?? { blockId, page: found.block.page, sentences: {}, shown: [], pending: [], failed: [] };
        const shown = order.filter((id) => t.shown.includes(id) || wanted.includes(id));
        const missing = wanted.filter((id) => !(id in t.sentences) && !t.pending.includes(id));
        next[blockId] = {
          ...t,
          shown,
          hidden: false,
          pending: [...t.pending, ...missing],
          failed: t.failed.filter((id) => !missing.includes(id)),
        };
        if (missing.length) fresh.push({ blockId, sids: missing });
      }
      set({ translations: next });
      persistTranslations();
      // Group neighbouring paragraphs into one request so headings and captions don't cost a round trip each.
      let batch: Job["items"] = [];
      let chars = 0;
      for (const item of fresh) {
        const found = blockOf(pageText, item.blockId);
        const len = item.sids.reduce((n, id) => n + (found?.pt.sentences.find((x) => x.id === id)?.text.length ?? 0), 0);
        if (batch.length && (chars + len > 1600 || batch.length >= 4)) {
          queue.push({ items: batch });
          batch = [];
          chars = 0;
        }
        batch.push(item);
        chars += len;
      }
      if (batch.length) queue.push({ items: batch });
      pump();
    },

    translateBlocks: (blockIds) => {
      const { pageText } = get();
      get().translateSentences(
        blockIds.map((id) => ({ blockId: id, sids: blockOf(pageText, id)?.block.sids ?? [] })).filter((x) => x.sids.length),
      );
    },

    retryPage: (page) => {
      const items = Object.values(get().translations)
        .filter((t) => t.page === page && t.failed.length)
        .map((t) => ({ blockId: t.blockId, sids: t.failed }));
      set((s) => {
        const translations = { ...s.translations };
        for (const it of items) translations[it.blockId] = { ...translations[it.blockId], failed: [] };
        return { translations };
      });
      get().translateSentences(items);
    },

    setTranslateAll: (on) => {
      set({ translateAll: on });
      const { paperId } = get();
      if (paperId) void dbSet(keys.reading(paperId), { translateAll: on });
      if (on) {
        set((s) => {
          const translations: Record<string, BlockTranslation> = {};
          for (const [k, t] of Object.entries(s.translations)) translations[k] = { ...t, hidden: false };
          const labels: Record<string, LabelTranslation> = {};
          for (const [k, l] of Object.entries(s.labels)) labels[k] = { ...l, hidden: false };
          return { translations, labels };
        });
        const { currentPage, pageText } = get();
        for (const p of [currentPage, currentPage + 1, currentPage - 1]) if (pageText[p]) get().ensurePageTranslated(p);
      } else {
        get().restoreOriginal();
      }
    },

    ensurePageTranslated: (page) => {
      const pt = get().pageText[page];
      if (!pt) return;
      get().translateBlocks(pt.blocks.filter((b) => pageTranslatable(pt, b)).map((b) => b.id));
    },

    setBlockHidden: (blockId, hidden) => {
      set((s) => {
        const t = s.translations[blockId];
        if (!t) return {};
        return { translations: { ...s.translations, [blockId]: { ...t, hidden } } };
      });
      persistTranslations();
    },

    restoreOriginal: () => {
      set((s) => {
        const translations: Record<string, BlockTranslation> = {};
        for (const [k, t] of Object.entries(s.translations)) translations[k] = { ...t, hidden: true };
        const labels: Record<string, LabelTranslation> = {};
        for (const [k, l] of Object.entries(s.labels)) labels[k] = { ...l, hidden: true };
        return { translations, labels, translateAll: false, figureTexts: {} };
      });
      persistTranslations();
    },

    reloadTranslations: async () => {
      const { paperId } = get();
      if (!paperId) return;
      queue.length = 0;
      generation += 1;
      const lang = useSettings.getState().lang;
      const [cached, reading] = await Promise.all([
        dbGet<Record<string, SavedBlock>>(keys.translations(paperId, lang)),
        dbGet<{ translateAll?: boolean }>(keys.reading(paperId)),
      ]);
      if (get().paperId !== paperId) return;
      const translations: Record<string, BlockTranslation> = {};
      for (const [blockId, saved] of Object.entries(cached ?? {})) {
        if (!saved || typeof saved !== "object" || !("s" in saved)) continue;
        translations[blockId] = { blockId, page: pageOfBlock(blockId), sentences: saved.s, shown: saved.shown ?? [], pending: [], failed: [] };
      }
      set({ translations, labels: {}, figureTexts: {}, translateAll: !!reading?.translateAll });
      if (reading?.translateAll) {
        const { currentPage, pageText } = get();
        for (const p of [currentPage, currentPage + 1]) if (pageText[p]) get().ensurePageTranslated(p);
      }
    },

    translateRegion: (page, rect, image) => {
      const pt = get().pageText[page];
      if (!pt) return;
      // Paragraphs mostly inside the box are translated as paragraphs; everything else as individual labels.
      const inside = pt.blocks.filter((b) => {
        const ix = Math.max(0, Math.min(b.rect.x + b.rect.w, rect.x + rect.w) - Math.max(b.rect.x, rect.x));
        const iy = Math.max(0, Math.min(b.rect.y + b.rect.h, rect.y + rect.h) - Math.max(b.rect.y, rect.y));
        return (ix * iy) / Math.max(b.rect.w * b.rect.h, 1) > 0.6 && selectionTranslatable(b) && b.lines.length >= 2;
      });
      const covered = new Set<number>();
      for (const b of inside) for (const s of b.segs) covered.add(s.run);
      if (inside.length) get().translateBlocks(inside.map((b) => b.id));

      const runs = runsInRect(pt, rect).filter((r) => !covered.has(pt.runs.indexOf(r)));
      // Merge runs that sit on the same baseline and touch into one label.
      const groups: { x: number; y: number; w: number; h: number; text: string; size: number; serif: boolean }[] = [];
      for (const r of [...runs].sort((a, b) => a.base - b.base || a.x - b.x)) {
        const g = groups[groups.length - 1];
        if (g && Math.abs(g.y + g.h - (r.y + r.h)) < r.size * 0.45 && r.x - (g.x + g.w) < r.size * 1.2) {
          const x1 = Math.max(g.x + g.w, r.x + r.w);
          g.text += (r.x - (g.x + g.w) > r.size * 0.15 ? " " : "") + r.str;
          g.y = Math.min(g.y, r.y);
          g.h = Math.max(g.h, r.h);
          g.w = x1 - g.x;
          g.size = Math.max(g.size, r.size);
        } else {
          groups.push({ x: r.x, y: r.y, w: r.w, h: r.h, text: r.str, size: r.size, serif: r.serif });
        }
      }
      // Tick numbers, units and lone symbols stay as they are.
      const labels = groups.filter((g) => /\p{L}{2,}/u.test(g.text) && !/^[\d.,%−\-+×eE\s()]+$/.test(g.text.trim()));
      if (labels.length) {
        const created: Record<string, LabelTranslation> = {};
        for (const g of labels) {
          const id = uid("l");
          created[id] = { id, page, rect: { x: g.x, y: g.y, w: g.w, h: g.h }, original: g.text.trim(), size: g.size, serif: g.serif, status: "pending" };
        }
        set((s) => ({ labels: { ...s.labels, ...created } }));
        const lang = useSettings.getState().lang;
        void postJSON<{ labels: { id: string; text: string }[] }>("/api/translate-labels", {
          lang,
          title: get().title,
          labels: Object.values(created).map((l) => ({ id: l.id, text: l.original })),
        })
          .then((res) =>
            set((s) => {
              const next = { ...s.labels };
              for (const l of res.labels) if (next[l.id]) next[l.id] = { ...next[l.id], status: "done", text: l.text };
              for (const id of Object.keys(created)) if (next[id]?.status === "pending") next[id] = { ...next[id], status: "error" };
              return { labels: next };
            }),
          )
          .catch((err) =>
            set((s) => {
              const next = { ...s.labels };
              for (const id of Object.keys(created)) next[id] = { ...next[id], status: "error" };
              return { labels: next, notice: errorMessage(err, "Couldn't translate the text in that area.") };
            }),
          );
      }

      // A box that is mostly picture (a figure, often with its caption) is also read with vision: the text drawn
      // inside an image isn't in the text layer. Text the layer already gave us is handled above, not twice.
      const textArea = runsInRect(pt, rect).reduce((a, r) => a + r.w * r.h, 0);
      const mostlyPicture = textArea / Math.max(rect.w * rect.h, 1) < 0.12;
      const known = [...labels.map((g) => g.text), ...inside.map((b) => b.text)].map(normalizeText).filter(Boolean);
      const isKnown = (s: string) => {
        const n = normalizeText(s);
        return !!n && known.some((k) => k === n || (n.length >= 6 && k.includes(n)));
      };
      if (image && (mostlyPicture || (!inside.length && !labels.length))) {
        const id = uid("f");
        set((s) => ({ figureTexts: { ...s.figureTexts, [id]: { id, page, rect, status: "pending", lines: [] } } }));
        void (async () => {
          try {
            const png = await image();
            if (!png) throw new Error("Couldn't capture that area.");
            const lang = useSettings.getState().lang;
            // The image's real size, read from the PNG itself: renderRegion draws a very large figure smaller.
            const size = pngSize(png);
            const k0 = Math.min(4, 1568 / Math.max(rect.w, rect.h, 1));
            const W = size?.width ?? Math.max(1, Math.round(rect.w * k0));
            const H = size?.height ?? Math.max(1, Math.round(rect.h * k0));
            const k = W / Math.max(rect.w, 1e-6);
            const answer = await postJSON<{ lines: { original: string; text: string; box?: number[] }[] }>("/api/figure-text", {
              lang,
              title: get().title,
              image: png,
              width: W,
              height: H,
            });
            const res = { lines: answer.lines.filter((l) => !isKnown(l.original)) };
            if (!res.lines.length) {
              set((s) => {
                const figureTexts = { ...s.figureTexts };
                delete figureTexts[id];
                return { figureTexts };
              });
              return;
            }
            const placed = res.lines.filter((l) => {
              const b = l.box;
              if (!b || b.length !== 4) return false;
              const [x0, y0, x1, y1] = b;
              const area = ((x1 - x0) * (y1 - y0)) / (W * H);
              return x0 >= -2 && y0 >= -2 && x1 <= W + 2 && y1 <= H + 2 && x1 > x0 && y1 > y0 && area < 0.4;
            });
            // In place when the positions look right; otherwise a list beside the figure.
            if (res.lines.length && placed.length >= Math.ceil(res.lines.length * 0.7)) {
              const created: Record<string, LabelTranslation> = {};
              for (const l of placed) {
                const [x0, y0, x1, y1] = l.box!;
                const lid = uid("l");
                const h = (y1 - y0) / k;
                const box = { x: rect.x + x0 / k, y: rect.y + y0 / k, w: (x1 - x0) / k, h };
                // A model's box is drawn tight: a little room covers the original letters, while the colour comes
                // from right around the text, so a label inside a coloured box keeps that box's colour.
                const padX = h * 0.15;
                const padY = h * 0.08;
                const r = { x: box.x - padX, y: box.y - padY, w: box.w + padX * 2, h: h + padY * 2 };
                created[lid] = { id: lid, page, rect: r, sample: box, original: l.original, size: Math.max(4, h * 0.82), serif: false, status: "done", text: l.text };
              }
              set((s) => {
                const figureTexts = { ...s.figureTexts };
                delete figureTexts[id];
                return { labels: { ...s.labels, ...created }, figureTexts };
              });
            } else {
              set((s) => ({ figureTexts: { ...s.figureTexts, [id]: { ...s.figureTexts[id], status: "done", lines: res.lines } } }));
            }
          } catch (err) {
            set((s) => ({
              figureTexts: { ...s.figureTexts, [id]: { ...s.figureTexts[id], status: "error" } },
              notice: errorMessage(err, "Couldn't read the text in that image."),
            }));
          }
        })();
      }
    },

    addHighlight: (h) => {
      const highlight: Highlight = { ...h, id: uid("h"), createdAt: Date.now() };
      set((s) => ({ highlights: [...s.highlights, highlight] }));
      const { paperId, highlights } = get();
      if (paperId) void dbSet(keys.highlights(paperId), highlights);
      return highlight;
    },

    removeHighlight: (id) => {
      set((s) => ({ highlights: s.highlights.filter((h) => h.id !== id) }));
      const { paperId, highlights } = get();
      if (paperId) void dbSet(keys.highlights(paperId), highlights);
    },

    loadBrief: async (opts) => {
      const { paperId, brief } = get();
      if (!paperId || brief.status === "loading") return;
      if (brief.status === "ready" && !opts?.force) return;
      const lang = useSettings.getState().lang;
      set({ brief: { status: "loading", data: opts?.force ? brief.data : null } });
      try {
        const res = await postJSON<{
          gist: string;
          kind?: string;
          novelty?: { sid: string; text: string };
          look_first?: { sid: string; label: string; why: string }[];
          points: { kind: LensKind; sid: string; text: string }[];
          questions: string[];
          question_sources?: string[];
        }>("/api/brief", {
          title: get().title,
          paper: get().paperText(),
          lang,
        });
        if (get().paperId !== paperId) return;
        const pageText = get().pageText;
        const seen = new Set<string>();
        // Keep only points anchored to a real sentence, once each: a point that can't be shown in the paper isn't kept.
        const points: BriefPoint[] = res.points
          .map((p) => ({ ...p, page: pageOfSentence(p.sid) }))
          .filter((p) => {
            if (!p.text.trim() || seen.has(p.sid) || !pageText[p.page]?.sentences.some((s) => s.id === p.sid)) return false;
            seen.add(p.sid);
            return true;
          });
        const real = (sid?: string) => !!sid && !!pageText[pageOfSentence(sid)]?.sentences.some((x) => x.id === sid);
        const questions = res.questions.map((q) => q.trim()).filter(Boolean).slice(0, 3);
        const data: Brief = {
          gist: res.gist.trim(),
          kind: res.kind?.trim() ?? "",
          novelty: res.novelty && res.novelty.text.trim() && real(res.novelty.sid) ? { sid: res.novelty.sid, page: pageOfSentence(res.novelty.sid), text: res.novelty.text.trim() } : undefined,
          // Only figures and tables whose caption is a real sentence of the paper: a place that can be shown.
          lookFirst: (res.look_first ?? [])
            .filter((f) => f.label.trim() && real(f.sid))
            .slice(0, 2)
            .map((f) => ({ sid: f.sid, page: pageOfSentence(f.sid), label: f.label.trim(), why: f.why.trim() })),
          points,
          questions,
          questionSids: questions.map((_, i) => (real(res.question_sources?.[i]) ? res.question_sources![i] : "")),
          lang,
        };
        set({ brief: { status: "ready", data } });
        void dbSet(keys.brief(paperId), data);
        if (pairsWanted()) void get().pairBrief();
      } catch (err) {
        if (get().paperId !== paperId) return;
        set({ brief: { status: "error", data: get().brief.data, error: errorMessage(err, "The brief couldn't be written.") } });
      }
    },

    pairBrief: async () => {
      const { paperId, brief } = get();
      const data = brief.data;
      if (!paperId || !data || data.en || pairing === `${paperId}:${data.lang}`) return;
      if (data.lang.toLowerCase().startsWith("en")) return;
      pairing = `${paperId}:${data.lang}`;
      // English follows the brief's one paragraph, the gist; its short rows stay in the reader's language.
      set({ brief: { ...get().brief, pairing: "loading" } });
      let failed = false;
      try {
        const en = await englishOf([{ id: "gist", text: data.gist }], data.lang, get().title);
        const now = get().brief.data;
        if (get().paperId !== paperId || now !== data) return;
        const next = { ...data, en };
        set({ brief: { ...get().brief, data: next } });
        void dbSet(keys.brief(paperId), next);
      } catch {
        // No English line is a quiet loss: the brief itself is all there.
        failed = true;
      } finally {
        pairing = null;
        if (get().paperId === paperId) set({ brief: { ...get().brief, pairing: failed ? "error" : undefined } });
      }
    },

    pointAt: (page, sids) => {
      if (page == null || !sids?.length) {
        if (get().pointing) set({ pointing: null });
        return;
      }
      const pt = get().pageText[page];
      const rects = pt ? sids.filter((sid) => pageOfSentence(sid) === page).flatMap((sid) => sentenceRects(pt, sid)) : [];
      set({ pointing: rects.length ? { page, rects } : null });
    },

    jumpTo: (page, sids, opts) => {
      const pt = get().pageText[page];
      const rects = pt && sids ? sids.filter((sid) => pageOfSentence(sid) === page).flatMap((sid) => sentenceRects(pt, sid)) : [];
      const y = rects.length ? Math.min(...rects.map((r) => r.y)) : 0;
      set({ scrollRequest: { page, y, key: Date.now(), remember: opts?.remember } });
      if (rects.length) set({ flash: { page, rects, key: Date.now() } });
    },

    paperText: () => {
      const { pageText, doc } = get();
      const n = doc?.numPages ?? 0;
      const parts: string[] = [];
      for (let p = 1; p <= n; p++) {
        const pt = pageText[p];
        if (pt) parts.push(`# Page ${p}\n${pageForModel(pt)}`);
      }
      return parts.join("\n\n");
    },

    paperLang: () => {
      const sample = Object.values(get().pageText)
        .slice(0, 3)
        .map((pt) => pt.blocks.map((b) => b.text).join(" "))
        .join(" ")
        .slice(0, 6000);
      const letters = (sample.match(/\p{L}/gu) ?? []).length || 1;
      if ((sample.match(/[぀-ヿ]/g) ?? []).length / letters > 0.05) return "ja";
      if ((sample.match(/[가-힯]/g) ?? []).length / letters > 0.3) return "ko";
      if ((sample.match(/[㐀-鿿]/g) ?? []).length / letters > 0.3) return "zh-Hans";
      return "en";
    },
  };
});

export function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "message" in err && typeof err.message === "string" && err.message.length < 200) {
    return err.message;
  }
  return fallback;
}
