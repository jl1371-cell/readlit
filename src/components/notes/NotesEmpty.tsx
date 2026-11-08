"use client";
import clsx from "clsx";
import { Plus, Sparkles } from "lucide-react";
import { useNotes } from "@/lib/store/notes";
import { useReader } from "@/lib/store/reader";
import { draftMindMap, usePassageOver } from "./actions";

/**
 * The notes column before anything is kept: what the column is for, and the three ways in as real actions. The AI
 * draft is the column's one solid button; starting by hand is the quieter second; and the whole card is where a
 * sentence dragged from the paper can land. One card for the outline and the mind map: one tree, one way in.
 */
export function NotesEmpty() {
  const doc = useNotes((s) => s.doc);
  const ready = useReader((s) => s.textPages > 0);
  const over = usePassageOver((s) => s.over);
  if (!doc) return null;
  const start = () => {
    const id = useNotes.getState().addChild(doc.rootId, { kind: "topic" }, true);
    if (id) useNotes.getState().select([id], true);
  };
  return (
    <div
      className={clsx(
        "card-in pointer-events-auto w-full max-w-[22rem] rounded-3xl border border-dashed px-6 py-6 text-center transition-colors",
        over ? "border-paprika/60 bg-paprika-ghost" : "border-latte-line/70 bg-paper/95 shadow-card backdrop-blur",
      )}
    >
      <h3 className="font-display text-heading text-ink">Keep what matters here</h3>
      <p className="mt-1 text-ui text-latte">One tree of notes, as an outline or a mind map.</p>
      <button
        type="button"
        disabled={!ready}
        onClick={draftMindMap}
        className="mt-5 inline-flex h-10 items-center gap-2 rounded-full bg-paprika px-5 text-ui font-medium text-white shadow-card transition-colors hover:bg-paprika-soft disabled:opacity-50 pointer-coarse:h-12"
      >
        <Sparkles className="h-4 w-4" />
        Draft a mind map
      </button>
      <p className="mt-2 text-label text-latte">AI drafts it from the paper. You keep or change any part.</p>
      <button
        type="button"
        onClick={start}
        className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-full bg-canvas px-4 text-ui font-medium text-ink ring-1 ring-latte-line/50 transition-colors hover:bg-parchment/60 pointer-coarse:h-11"
      >
        <Plus className="h-4 w-4 text-latte-deep" />
        Start my own
      </button>
      <p className="mt-4 text-label text-latte">{over ? "Drop it here to keep it" : "Or drag a sentence from the paper here."}</p>
    </div>
  );
}
