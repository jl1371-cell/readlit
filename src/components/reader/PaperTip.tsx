"use client";
import { TextSelect, X } from "lucide-react";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { useReader } from "@/lib/store/reader";

const KEY = "readlit.tip.paper";

function seen(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function remember() {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* a convenience */
  }
}

const useTip = create<{ hidden: boolean }>(() => ({ hidden: typeof window === "undefined" ? true : seen() }));

function dismiss() {
  remember();
  useTip.setState({ hidden: true });
}

// The first selection of any kind is the lesson learned.
if (typeof window !== "undefined") {
  useReader.subscribe((s) => {
    if (s.selection && !useTip.getState().hidden) dismiss();
  });
}

/**
 * The paper's one lesson, given once, in place: what selecting does, and how to box a figure. It goes for good the
 * first time the reader selects anything (or closes it), so it never has to be read twice.
 */
export function PaperTip() {
  const ready = useReader((s) => s.textPages > 0);
  const hidden = useTip((s) => s.hidden);
  const [shown, setShown] = useState(false);

  // Let the paper settle first; then the tip, quietly.
  useEffect(() => {
    if (!ready || hidden) return;
    const t = setTimeout(() => setShown(true), 1400);
    return () => clearTimeout(t);
  }, [ready, hidden]);

  if (hidden || !shown) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex justify-center px-4">
      <div role="note" className="card-in pointer-events-auto flex max-w-[34rem] items-start gap-3 rounded-2xl border border-latte-line/50 bg-paper py-2.5 pl-3.5 pr-2 text-ui text-ink shadow-card-hover">
        <TextSelect className="mt-0.5 h-4 w-4 shrink-0 text-paprika" />
        <p className="min-w-0 flex-1">
          Select any sentence to translate, explain, ask about or keep it. To ask about a figure, drag from the blank space beside it.
        </p>
        <button
          type="button"
          aria-label="Got it"
          onClick={dismiss}
          className="-my-0.5 shrink-0 rounded-full p-1.5 text-latte hover:bg-parchment/70 hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
