"use client";
import clsx from "clsx";
import {
  BookOpenText,
  Highlighter,
  Languages,
  MessageCircleQuestion,
  Sigma,
  TextQuote,
} from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";
import { Tip } from "@/components/ui/primitives";
import { postJSON } from "@/lib/ai/client";
import { languageByCode } from "@/lib/languages";
import { renderRegion } from "@/lib/pdf/render";
import { useChat } from "@/lib/store/chat";
import { useNotes } from "@/lib/store/notes";
import { errorMessage, type ReaderSelection, type TextSelectionInfo, useReader } from "@/lib/store/reader";
import { useSettings } from "@/lib/store/settings";
import { useUi } from "@/lib/store/ui";
import { regionText } from "./selection";
import { keepPassage } from "@/components/notes/actions";

/** Four things to do with a selection: translate it in place, have it explained (or summarized), ask about it, keep it. */
export type SelAction = "translate" | "explain" | "summarize" | "ask" | "note" | "formula";

// ── A word or two: a small card under the selection instead of an in-place translation. ──
interface LookupState {
  status: "idle" | "loading" | "ready" | "error";
  term: string;
  translation: string;
  sense: string;
  error?: string;
}
const useLookup = create<LookupState>(() => ({ status: "idle", term: "", translation: "", sense: "" }));

export function isShortSelection(sel: TextSelectionInfo): boolean {
  return sel.words <= 3 && sel.text.length <= 48 && !/[.!?。！？]\s*$/.test(sel.text.trim());
}

export function clearSelection() {
  window.getSelection()?.removeAllRanges();
  useReader.getState().setSelection(null);
  useLookup.setState({ status: "idle", term: "" });
}

function contextOf(sel: TextSelectionInfo): string {
  const { pageText } = useReader.getState();
  const page = sel.pages[0];
  const pt = pageText[page];
  const s = sel.sids.map((id) => pt?.sentences.find((x) => x.id === id)?.text).filter(Boolean);
  return s.join(" ") || sel.text;
}

function availableActions(sel: ReaderSelection): SelAction[] {
  if (sel.kind === "text") {
    // A passage longer than a paragraph is summarized; anything shorter is explained.
    const long = !isShortSelection(sel) && (sel.byBlock.length > 1 || sel.words > 140);
    return ["translate", long ? "summarize" : "explain", "ask", "note"];
  }
  const info = regionText(sel.page, sel.rect);
  if (info.mathy) return ["formula", "ask", "note"];
  return ["translate", "explain", "ask", "note"];
}

async function regionRef(sel: Extract<ReaderSelection, { kind: "region" }>) {
  const doc = useReader.getState().doc;
  const info = regionText(sel.page, sel.rect);
  const [image, thumb] = doc
    ? await Promise.all([renderRegion(doc, sel.page, sel.rect, 1568), renderRegion(doc, sel.page, sel.rect, 420)])
    : [null, null];
  return { page: sel.page, image: image ?? undefined, thumb: thumb ?? undefined, text: info.text, caption: info.caption };
}

/** Run a selection action; shared by the bar's buttons and the reader's single-key shortcuts. */
export async function runSelectionAction(action: SelAction): Promise<void> {
  const { selection } = useReader.getState();
  if (!selection) return;
  const chat = useChat.getState();
  if (selection.kind === "text") {
    // Explain and Summarize both work from the keyboard, whichever one the bar shows.
    if (!availableActions(selection).includes(action) && action !== "explain" && action !== "summarize") return;
    const quote = { text: selection.text, page: selection.pages[0], sids: selection.sids };
    switch (action) {
      case "translate": {
        if (isShortSelection(selection)) {
          const term = selection.text.trim();
          useLookup.setState({ status: "loading", term, translation: "", sense: "" });
          try {
            const res = await postJSON<{ translation: string; sense: string }>("/api/lookup", {
              title: useReader.getState().title,
              lang: useSettings.getState().lang,
              term,
              context: contextOf(selection),
            });
            if (useLookup.getState().term === term) useLookup.setState({ status: "ready", ...res });
          } catch (err) {
            if (useLookup.getState().term === term) useLookup.setState({ status: "error", error: errorMessage(err, "Couldn't look that up.") });
          }
          return;
        }
        useReader.getState().translateSentences(selection.byBlock);
        clearSelection();
        return;
      }
      case "explain":
      case "summarize":
        clearSelection();
        await chat.send({ action, quotes: [quote] });
        return;
      case "ask":
        chat.addQuote(quote);
        clearSelection();
        return;
      case "note":
        // Keeping a passage marks it in the paper and files it in the notes, with its place: one action, not two.
        keepPassage(selection);
        clearSelection();
        return;
    }
    return;
  }

  // A boxed region of a page.
  const sel = selection;
  switch (action) {
    case "translate": {
      const doc = useReader.getState().doc;
      useReader.getState().translateRegion(sel.page, sel.rect, doc ? () => renderRegion(doc, sel.page, sel.rect, 1568) : undefined);
      clearSelection();
      return;
    }
    case "explain":
    case "summarize":
    case "formula": {
      clearSelection();
      const region = await regionRef(sel);
      await chat.send({ action: action === "formula" ? "region-formula" : action === "explain" ? "region-explain" : "region-summarize", region });
      return;
    }
    case "ask": {
      clearSelection();
      chat.setRegion(await regionRef(sel));
      return;
    }
    case "note": {
      clearSelection();
      const r = await regionRef(sel);
      if (!useUi.getState().notesOpen) useUi.getState().set({ notesOpen: true });
      useNotes.getState().addExcerpt({ text: r.caption || r.text || `Figure on page ${sel.page}`, page: sel.page, sids: [], image: r.thumb });
      return;
    }
  }
}

const META: Record<SelAction, { label: string; key: string; icon: ReactNode }> = {
  translate: { label: "Translate", key: "T", icon: <Languages className="h-[15px] w-[15px]" strokeWidth={1.9} /> },
  explain: { label: "Explain", key: "E", icon: <BookOpenText className="h-[15px] w-[15px]" strokeWidth={1.9} /> },
  summarize: { label: "Summarize", key: "S", icon: <TextQuote className="h-[15px] w-[15px]" strokeWidth={1.9} /> },
  ask: { label: "Ask", key: "A", icon: <MessageCircleQuestion className="h-[15px] w-[15px]" strokeWidth={1.9} /> },
  formula: { label: "Explain formula", key: "E", icon: <Sigma className="h-[15px] w-[15px]" strokeWidth={1.9} /> },
  note: { label: "Note", key: "N", icon: <Highlighter className="h-[15px] w-[15px]" strokeWidth={1.9} /> },
};

/** The key that runs an action, for the reader's keyboard handler. H keeps working as Note. */
export function actionForKey(sel: ReaderSelection, key: string): SelAction | null {
  const k = key.toLowerCase();
  const list = availableActions(sel);
  if (k === "h") return "note";
  if (k === "e" && list.includes("formula")) return "formula";
  if (sel.kind === "text" && k === "e") return "explain";
  if (sel.kind === "text" && k === "s" && !isShortSelection(sel)) return "summarize";
  return list.find((a) => META[a].key.toLowerCase() === k) ?? null;
}

export function SelectionBar({ scrollEl }: { scrollEl: HTMLElement | null }) {
  const selection = useReader((s) => s.selection);
  const target = useSettings((s) => s.lang);
  const lookup = useLookup();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!selection || !el) {
      setPos(null);
      return;
    }
    const content = el.offsetParent as HTMLElement | null;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const maxLeft = (content?.clientWidth ?? 1000) - w - 12;
    const a = selection.anchor;
    const left = selection.kind === "region" ? a.x - w : a.x - w / 2;
    let top = a.y + 10;
    if (scrollEl) {
      const viewBottom = scrollEl.scrollTop + scrollEl.clientHeight;
      // No room below: hang above the selection instead; never cover it.
      if (top + h + 16 > viewBottom && a.top - h - 10 > scrollEl.scrollTop) top = a.top - h - 10;
    }
    setPos({ left: Math.max(12, Math.min(maxLeft, left)), top });
  }, [selection, scrollEl, lookup.status]);

  if (!selection) return null;
  const actions = availableActions(selection);
  const lang = languageByCode(target);
  const showLookup = selection.kind === "text" && lookup.status !== "idle" && lookup.term === selection.text.trim();

  return (
    <div
      ref={ref}
      data-keep-selection
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.preventDefault()}
      className={clsx("bar-in absolute z-30", !pos && "invisible")}
      style={pos ?? { left: 0, top: 0 }}
    >
      {showLookup ? (
        <div className="glass-strong w-[320px] rounded-2xl p-3.5 shadow-card-hover" role="dialog" aria-label="Translation">
          {lookup.status === "loading" && (
            <div className="space-y-2 py-0.5">
              <div className="tr-shimmer h-[18px] w-2/5 rounded" />
              <div className="tr-shimmer h-3 w-4/5 rounded" />
            </div>
          )}
          {lookup.status === "error" && <div className="text-ui text-latte-deep">{lookup.error}</div>}
          {lookup.status === "ready" && (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <div lang={target} className="text-heading text-ink">
                  {lookup.translation}
                </div>
                <div className="shrink-0 text-caption text-latte">{lang.name}</div>
              </div>
              <div lang={target} className="ai-text mt-1.5 text-body-sm text-ink-soft">
                {lookup.sense}
              </div>
              <div className="mt-2.5 flex gap-1">
                <BarButton action="ask" compact />
                <BarButton action="note" compact />
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="glass-strong flex h-10 items-center gap-0.5 rounded-full px-1 shadow-card-hover" role="toolbar" aria-label="Selection actions">
          {actions
            .filter((a) => a !== "note")
            .map((a) => (
              <BarButton key={a} action={a} suffix={a === "translate" && selection.kind === "text" ? lang.name : undefined} region={selection.kind === "region"} />
            ))}
          <span className="mx-1 h-4 w-px bg-latte-line/50" aria-hidden />
          <BarButton action="note" />
        </div>
      )}
    </div>
  );
}

function BarButton({ action, suffix, iconOnly, compact, region }: { action: SelAction; suffix?: string; iconOnly?: boolean; compact?: boolean; region?: boolean }) {
  const m = META[action];
  const label = region && action === "translate" ? "Translate text" : m.label;
  const tip = action === "note" ? "Mark it and keep it in your notes" : label;
  const button = (
    <button
      type="button"
      onClick={() => void runSelectionAction(action)}
      className={clsx(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full text-ui font-medium text-ink-soft transition-colors duration-150 hover:bg-parchment/80 hover:text-ink",
        iconOnly ? "h-8 w-8 justify-center" : compact ? "h-7 px-2.5" : "h-8 px-3",
      )}
      aria-label={iconOnly ? label : undefined}
    >
      {m.icon}
      {!iconOnly && <span>{label}</span>}
      {suffix && <span className="font-normal text-latte">· {suffix}</span>}
    </button>
  );
  return (
    <Tip label={tip} keys={m.key} side="bottom">
      {button}
    </Tip>
  );
}
