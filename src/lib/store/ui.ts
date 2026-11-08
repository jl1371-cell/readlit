"use client";
import { create } from "zustand";

/** The notes column shows one tree two ways: as an outline written down the page, or as a mind map. */
export type NotesView = "notes" | "map";

interface UiPrefs {
  /** The AI column on the left: the brief, answers and the composer. */
  aiOpen: boolean;
  /** The notes column on the right. */
  notesOpen: boolean;
  notesView: NotesView;
  aiWidth: number;
  notesWidth: number;
}

interface Transient {
  /** The mind map takes most of the window; the paper stays beside it, narrower. */
  mapExpanded: boolean;
  shortcutsOpen: boolean;
  /** The language menu in the header (it opens from the AI column's title too). */
  langOpen: boolean;
  /** The "Your research" card: "edit" from the AI menu, "ask" on the way to asking what a paper means for it. */
  researchOpen: "edit" | "ask" | null;
  /** The mind map's zoom, for the zoom menu in the header. */
  mapZoom: number;
}

interface UiState extends UiPrefs, Transient {
  set: (patch: Partial<UiPrefs & Transient>) => void;
}

const KEY = "readlit.ui";

function readPrefs(): Partial<UiPrefs> {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    return raw ? (JSON.parse(raw) as Partial<UiPrefs>) : {};
  } catch {
    return {};
  }
}

// A first visit shows all three columns, so what each one is for can be seen at once, as long as the paper keeps a
// comfortable width (680 px beside the default 340 + 400); on a smaller window the notes wait behind their button.
// After that, the reader's own choice is kept.
const WIDE = 340 + 400 + 680;
const defaults: UiPrefs = {
  aiOpen: true,
  notesOpen: typeof window !== "undefined" && window.innerWidth >= WIDE,
  notesView: "notes",
  aiWidth: 340,
  notesWidth: 400,
};

export const useUi = create<UiState>((set, get) => ({
  ...defaults,
  ...readPrefs(),
  mapExpanded: false,
  shortcutsOpen: false,
  langOpen: false,
  researchOpen: null,
  mapZoom: 1,
  set: (patch) => {
    set(patch);
    const { aiOpen, notesOpen, notesView, aiWidth, notesWidth } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ aiOpen, notesOpen, notesView, aiWidth, notesWidth }));
    } catch {
      /* preferences are a convenience */
    }
  },
}));
