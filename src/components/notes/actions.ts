"use client";
import { create } from "zustand";
import { useNotes } from "@/lib/store/notes";
import { type TextSelectionInfo, useReader } from "@/lib/store/reader";
import { useUi } from "@/lib/store/ui";

/**
 * Start the AI's draft of the mind map. Asking for a map is asking to see one, so the map gets the room it needs
 * to be read (the paper stays beside it, narrower); one click on the header gives the paper its room back.
 */
export function draftMindMap() {
  const ui = useUi.getState();
  // Widen only when the window has room for the paper (460 px) beside a map wider than the usual column.
  const room = window.innerWidth - (ui.aiOpen ? ui.aiWidth : 0) - 460 > ui.notesWidth + 100;
  ui.set({ notesOpen: true, notesView: "map", ...(room ? { mapExpanded: true } : {}) });
  void useNotes.getState().generate("statements");
}

/**
 * Keep a passage: mark it in the paper and file it in the notes with its page, in one step. `parentId` is where it
 * was dropped (null: the excerpts branch); left out, it goes under the selected node or into the excerpts.
 */
export function keepPassage(selection: TextSelectionInfo, parentId?: string | null) {
  for (const { page, rects } of selection.rects) {
    const sids = selection.sids.filter((s) => Number(s.slice(1, s.indexOf("s"))) === page);
    useReader.getState().addHighlight({ page, rects, text: selection.text, sids, color: "champagne" });
  }
  if (!useUi.getState().notesOpen) useUi.getState().set({ notesOpen: true });
  return useNotes.getState().addExcerpt({ text: selection.text, page: selection.pages[0], sids: selection.sids }, parentId);
}

/** A passage on its way from the paper to the notes, dragged with the pointer. */
export const PASSAGE_TYPE = "application/x-readlit-passage";
export const passageDrag: { sel: TextSelectionInfo | null } = { sel: null };
/** Whether a dragged passage is over the notes right now (the notes then say where it can go). */
export const usePassageOver = create<{ over: boolean }>(() => ({ over: false }));
