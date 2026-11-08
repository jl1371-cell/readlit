"use client";
import { create } from "zustand";
import { dbDel, dbEntries, dbGet, dbSet, keys } from "@/lib/db";
import { sha256Hex } from "@/lib/hash";
import { LANGUAGES } from "@/lib/languages";
import { openPdf } from "@/lib/pdf/pdfjs";

export interface PaperMeta {
  id: string;
  title: string;
  authors: string;
  fileName: string;
  pages: number;
  size: number;
  addedAt: number;
  openedAt: number;
}

interface LibraryState {
  papers: PaperMeta[];
  loaded: boolean;
  currentId: string | null;
  busy: string | null;
  error: string | null;
  load: () => Promise<void>;
  addFile: (file: File) => Promise<string | null>;
  addFromUrl: (url: string) => Promise<string | null>;
  open: (id: string) => void;
  close: () => void;
  remove: (id: string) => Promise<void>;
  rename: (id: string, title: string) => void;
}

const CURRENT_KEY = "readlit.current";
const LANGS = LANGUAGES.map((l) => l.code);

function remember(id: string | null) {
  try {
    if (id) sessionStorage.setItem(CURRENT_KEY, id);
    else sessionStorage.removeItem(CURRENT_KEY);
  } catch {
    /* session storage is a convenience */
  }
}

function cleanTitle(raw: string | undefined, fileName: string): string {
  const t = (raw ?? "").replace(/\s+/g, " ").trim();
  const junk = !t || /^(untitled|microsoft word|document\d*|\d+)$/i.test(t) || /\.(pdf|docx?|tex)$/i.test(t);
  if (!junk) return t;
  return fileName.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim() || "Untitled paper";
}

export const useLibrary = create<LibraryState>((set, get) => ({
  papers: [],
  loaded: false,
  currentId: null,
  busy: null,
  error: null,

  load: async () => {
    const rows = await dbEntries<PaperMeta>("paper:");
    const papers = rows.map(([, v]) => v).sort((a, b) => b.openedAt - a.openedAt);
    // A refresh keeps the reader on the paper they had open in this tab.
    let currentId: string | null = null;
    try {
      const last = sessionStorage.getItem(CURRENT_KEY);
      if (last && papers.some((p) => p.id === last)) currentId = last;
    } catch {
      /* session storage is a convenience */
    }
    set({ papers, loaded: true, currentId });
  },

  addFile: async (file) => {
    if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) {
      set({ error: "Only PDF files for now." });
      return null;
    }
    set({ busy: file.name, error: null });
    try {
      const data = await file.arrayBuffer();
      const id = await sha256Hex(data);
      const existing = get().papers.find((p) => p.id === id);
      if (existing) {
        get().open(id);
        return id;
      }
      const doc = await openPdf(data);
      const info = (await doc.getMetadata().catch(() => null))?.info as { Title?: string; Author?: string } | undefined;
      const meta: PaperMeta = {
        id,
        title: cleanTitle(info?.Title, file.name),
        authors: (info?.Author ?? "").trim(),
        fileName: file.name,
        pages: doc.numPages,
        size: file.size,
        addedAt: Date.now(),
        openedAt: Date.now(),
      };
      await doc.loadingTask.destroy();
      await dbSet(keys.paperFile(id), data);
      await dbSet(keys.paperMeta(id), meta);
      set({ papers: [meta, ...get().papers], currentId: id });
      remember(id);
      return id;
    } catch (err) {
      console.error(err);
      set({ error: "That file could not be opened as a PDF." });
      return null;
    } finally {
      set({ busy: null });
    }
  },

  addFromUrl: async (url) => {
    set({ busy: url, error: null });
    try {
      const res = await fetch(`/api/fetch-pdf?url=${encodeURIComponent(url)}`);
      if (!res.ok) {
        const msg = (await res.json().catch(() => null))?.error ?? "Could not fetch that PDF.";
        set({ error: msg });
        return null;
      }
      const name = res.headers.get("x-file-name") ?? "paper.pdf";
      const blob = await res.blob();
      return await get().addFile(new File([blob], name, { type: "application/pdf" }));
    } catch {
      set({ error: "Could not fetch that PDF." });
      return null;
    } finally {
      set({ busy: null });
    }
  },

  open: (id) => {
    const papers = get().papers.map((p) => (p.id === id ? { ...p, openedAt: Date.now() } : p));
    const meta = papers.find((p) => p.id === id);
    if (meta) void dbSet(keys.paperMeta(id), meta);
    set({ papers, currentId: id });
    remember(id);
  },

  close: () => {
    set({ currentId: null });
    remember(null);
  },

  remove: async (id) => {
    set({ papers: get().papers.filter((p) => p.id !== id) });
    await Promise.all([
      dbDel(keys.paperMeta(id)),
      dbDel(keys.paperFile(id)),
      dbDel(keys.chat(id)),
      dbDel(keys.map(id)),
      dbDel(keys.brief(id)),
      dbDel(keys.highlights(id)),
      dbDel(keys.reading(id)),
      ...LANGS.map((lang) => dbDel(keys.translations(id, lang))),
    ]);
  },

  rename: (id, title) => {
    const papers = get().papers.map((p) => (p.id === id ? { ...p, title } : p));
    const meta = papers.find((p) => p.id === id);
    if (meta) void dbSet(keys.paperMeta(id), meta);
    set({ papers });
  },
}));

export async function loadPaperFile(id: string): Promise<ArrayBuffer | undefined> {
  return dbGet<ArrayBuffer>(keys.paperFile(id));
}
