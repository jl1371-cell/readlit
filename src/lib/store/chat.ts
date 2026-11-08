"use client";
import { create } from "zustand";
import { type Unit, markdownUnits } from "@/components/ai/Markdown";
import { streamEvents } from "@/lib/ai/client";
import { englishOf } from "@/lib/ai/pair";
import { dbGet, dbSet, keys } from "@/lib/db";
import { uid } from "@/lib/hash";
import { errorMessage, useReader } from "./reader";
import { pairsWanted, useSettings } from "./settings";
import { useUi } from "./ui";

export type ChatAction =
  | "ask"
  | "explain"
  | "summarize"
  | "define"
  | "region-explain"
  | "region-summarize"
  | "region-ask"
  | "region-formula"
  // What a researcher asks of a whole paper.
  | "walkthrough"
  | "relevance"
  | "connections"
  | "critique"
  | "ideas";

export interface Quote {
  text: string;
  page: number;
  sids: string[];
}

export interface RegionRef {
  page: number;
  /** Full-resolution crop sent with the question; dropped from storage after sending. */
  image?: string;
  /** Small preview kept with the conversation. */
  thumb?: string;
  text: string;
  caption: string;
}

export interface NodeRef {
  id: string;
  /** Labels from the root to the node. */
  path: string[];
  sids: string[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  action?: ChatAction;
  text: string;
  quotes?: Quote[];
  region?: RegionRef;
  nodes?: NodeRef[];
  status?: "streaming" | "done" | "error";
  error?: string;
  createdAt: number;
  /** The language an answer was written in (the reader's language when it was asked). */
  lang?: string;
  /** The English version of each paragraph, list item and heading of an answer, keyed as the renderer keys them. */
  en?: Record<string, string>;
  /** While the English version is being written, or when it couldn't be. */
  enState?: "loading" | "error";
}

interface ChatState {
  paperId: string | null;
  messages: ChatMessage[];
  /** Passages waiting above the composer for the reader's question. */
  quotes: Quote[];
  region: RegionRef | null;
  nodes: NodeRef[];
  focusKey: number;
  /** Text to put in the composer (for "Ask about this"); the composer takes it and clears it. */
  draft: string | null;
  busy: boolean;
  load: (paperId: string) => Promise<void>;
  send: (msg: { action: ChatAction; text?: string; quotes?: Quote[]; region?: RegionRef; nodes?: NodeRef[] }) => Promise<void>;
  addQuote: (q: Quote) => void;
  removeQuote: (i: number) => void;
  setRegion: (r: RegionRef | null) => void;
  setNodes: (n: NodeRef[]) => void;
  focusComposer: () => void;
  setDraft: (text: string | null) => void;
  stop: () => void;
  clear: () => void;
  /** Write the English version of an answer: its missing pieces (an older answer, or one that didn't all come). */
  pair: (id: string) => Promise<void>;
  /** Save the conversation now. */
  persistNow: () => void;
  /** The conversation set aside by "New chat", until it's restored or the note about it goes away. */
  stash: { messages: ChatMessage[]; key: number } | null;
  newChat: () => void;
  restoreChat: () => void;
  dropStash: () => void;
}

let controller: AbortController | null = null;

const ACTION_LABEL: Record<ChatAction, string> = {
  ask: "",
  explain: "Explain",
  summarize: "Summarize",
  define: "Define",
  "region-explain": "Explain this area",
  "region-summarize": "Summarize this area",
  "region-ask": "",
  "region-formula": "Explain this formula",
  walkthrough: "Walk me through the paper",
  relevance: "What it means for my research",
  connections: "How it connects to other work",
  critique: "Its weak points",
  ideas: "Ideas it opens up",
};

/** The asks of a whole paper, in the order a reader takes them: understand, place, question, build on. */
// Understand it, question it, place it, then build on it (Adler; Keshav's three passes): report 13.
export const PAPER_ASKS: { action: ChatAction; label: string; hint: string }[] = [
  { action: "walkthrough", label: "Walk through", hint: "The paper in the order to read it, with what to look at" },
  { action: "critique", label: "Weak points", hint: "What the authors admit, what a reviewer would ask, what couldn't be checked" },
  { action: "connections", label: "Connections", hint: "What it builds on, and the papers that cite it (from OpenAlex)" },
  { action: "relevance", label: "For my work", hint: "What carries over to your own research" },
  { action: "ideas", label: "Ideas", hint: "Gaps to work on, each with a first test; novelty not checked" },
];

/** Keep what the reader wrote about their research, with an English version for searching papers by topic. */
export async function saveResearch(text: string) {
  const settings = useSettings.getState();
  const research = text.trim();
  // Latin letters only (English or close to it): searchable as written.
  const plain = /^[\p{Script=Latin}\p{N}\p{P}\p{Zs}\p{S}]*$/u.test(research);
  settings.update({ research, researchEn: plain ? research : "" });
  if (!research || plain) return;
  try {
    const en = await englishOf([{ id: "r", text: research }], settings.lang, "");
    if (useSettings.getState().research === research) useSettings.getState().update({ researchEn: en.r ?? "" });
  } catch {
    /* without it, the AI still uses the reader's own words; only the search for nearby papers is skipped */
  }
}

export function actionLabel(a?: ChatAction): string {
  return a ? ACTION_LABEL[a] : "";
}

/**
 * The English of an answer, piece by piece while it is being written: a paragraph (or list item) is sent once the
 * next one has begun, so it is finished, a few at a time. Its English then arrives behind the text being read, not
 * all at once at the end, and nothing jumps.
 */
function pairer(id: string, lang: string) {
  const asked = new Set<string>();
  const got: Record<string, string> = {};
  let inflight = 0;
  let failed = false;
  let last = 0;
  const update = (p: Partial<ChatMessage>) => useChat.setState((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, ...p } : m)) }));
  const send = (units: Unit[]) => {
    const fresh = units.filter((u) => !asked.has(u.id));
    if (!fresh.length) return;
    for (const u of fresh) asked.add(u.id);
    last = performance.now();
    inflight += 1;
    update({ enState: "loading" });
    englishOf(fresh, lang, useReader.getState().title)
      .then((en) => {
        Object.assign(got, en);
        update({ en: { ...got } });
      })
      .catch(() => {
        failed = true;
      })
      .finally(() => {
        inflight -= 1;
        if (!inflight) update({ enState: failed ? "error" : undefined });
        useChat.getState().persistNow();
      });
  };
  return {
    streaming(text: string) {
      const done = markdownUnits(text).slice(0, -1).filter((u) => !asked.has(u.id));
      // Two finished pieces, or one that has waited a moment: enough to send.
      if (done.length >= 2 || (done.length === 1 && performance.now() - last > 1200)) send(done);
    },
    finish(text: string) {
      send(markdownUnits(text));
    },
  };
}

export const useChat = create<ChatState>((set, get) => {
  const persist = () => {
    const { paperId, messages } = get();
    if (!paperId) return;
    // Large crops stay out of storage; the thumbnail is enough to show what was asked about.
    const slim = messages.map((m) => (m.region ? { ...m, region: { ...m.region, image: undefined } } : m));
    void dbSet(keys.chat(paperId), slim);
  };

  return {
    paperId: null,
    messages: [],
    quotes: [],
    region: null,
    nodes: [],
    focusKey: 0,
    draft: null,
    busy: false,

    load: async (paperId) => {
      controller?.abort();
      set({ paperId, messages: [], quotes: [], region: null, nodes: [], busy: false, stash: null });
      const saved = await dbGet<ChatMessage[]>(keys.chat(paperId));
      if (get().paperId === paperId && saved) {
        set({
          messages: saved.map((m) => {
            const settled = m.enState === "loading" ? { ...m, enState: undefined } : m;
            return settled.status === "streaming" ? { ...settled, status: "error", error: "Stopped." } : settled;
          }),
        });
      }
    },

    send: async ({ action, text = "", quotes = [], region, nodes = [] }) => {
      const reader = useReader.getState();
      if (!reader.paperId) return;
      if (get().busy) get().stop();
      if (!useUi.getState().aiOpen) useUi.getState().set({ aiOpen: true });
      const user: ChatMessage = { id: uid("m"), role: "user", action, text, quotes, region, nodes, createdAt: Date.now() };
      const lang = useSettings.getState().lang;
      const reply: ChatMessage = { id: uid("m"), role: "assistant", text: "", status: "streaming", createdAt: Date.now(), lang };
      set((s) => ({ messages: [...s.messages, user, reply], busy: true, quotes: [], region: null, nodes: [] }));

      const turns = get()
        .messages.filter((m) => m.id !== reply.id && (m.role === "user" || (m.status === "done" && m.text)))
        .slice(-24)
        .map((m) => ({
          role: m.role,
          action: m.action,
          text: m.text,
          quotes: m.quotes ?? [],
          region: m.region ? { page: m.region.page, image: m.region.image, text: m.region.text, caption: m.region.caption } : undefined,
          nodes: (m.nodes ?? []).map((n) => ({ path: n.path, sids: n.sids })),
        }));

      const ctrl = new AbortController();
      controller = ctrl;
      let acc = "";
      let lastPaint = 0;
      const english = pairsWanted() ? pairer(reply.id, lang) : null;
      const paint = (force = false) => {
        const now = performance.now();
        if (!force && now - lastPaint < 40) return;
        lastPaint = now;
        const textNow = acc;
        set((s) => ({ messages: s.messages.map((m) => (m.id === reply.id ? { ...m, text: textNow } : m)) }));
        english?.streaming(textNow);
      };
      try {
        await streamEvents(
          "/api/chat",
          { title: reader.title, paper: reader.paperText(), lang, pairs: pairsWanted(), research: useSettings.getState().research, researchEn: useSettings.getState().researchEn, turns },
          (e) => {
            if (e.type === "delta") {
              acc += e.text;
              paint();
            } else if (e.type === "error") {
              throw new Error(e.message);
            }
          },
          ctrl.signal,
        );
        paint(true);
        set((s) => ({ messages: s.messages.map((m) => (m.id === reply.id ? { ...m, text: acc, status: "done" } : m)) }));
      } catch (err) {
        const aborted = ctrl.signal.aborted;
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === reply.id
              ? {
                  ...m,
                  text: acc,
                  status: aborted && acc ? "done" : "error",
                  error: aborted ? "Stopped." : errorMessage(err, "The answer didn't finish."),
                }
              : m,
          ),
        }));
      } finally {
        if (controller === ctrl) {
          controller = null;
          set({ busy: false });
        }
        persist();
      }
      const done = get().messages.find((m) => m.id === reply.id);
      if (done?.status === "done" && done.text) english?.finish(done.text);
    },

    // An answer from before English was wanted, or one whose English didn't all come through: the missing pieces.
    pair: async (id) => {
      const m = get().messages.find((x) => x.id === id);
      if (!m || m.role !== "assistant" || m.status !== "done" || !m.text || m.enState === "loading") return;
      const lang = m.lang ?? useSettings.getState().lang;
      if (lang.toLowerCase().startsWith("en")) return;
      const missing = markdownUnits(m.text).filter((u) => !m.en?.[u.id]);
      if (!missing.length) return;
      const paperId = get().paperId;
      const patch = (p: Partial<ChatMessage>) => set((s) => ({ messages: s.messages.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
      patch({ enState: "loading" });
      try {
        const en = await englishOf(missing, lang, useReader.getState().title);
        if (get().paperId !== paperId) return;
        const now = get().messages.find((x) => x.id === id);
        patch({ en: { ...(now?.en ?? {}), ...en }, enState: undefined });
      } catch {
        if (get().paperId !== paperId) return;
        patch({ enState: "error" });
      }
      persist();
    },

    persistNow: () => persist(),

    addQuote: (q) => {
      if (!useUi.getState().aiOpen) useUi.getState().set({ aiOpen: true });
      set((s) => {
        if (s.quotes.some((x) => x.text === q.text && x.page === q.page)) return { focusKey: s.focusKey + 1 };
        return { quotes: [...s.quotes, q].slice(-8), focusKey: s.focusKey + 1 };
      });
    },
    removeQuote: (i) => set((s) => ({ quotes: s.quotes.filter((_, k) => k !== i) })),
    setRegion: (region) => {
      if (region && !useUi.getState().aiOpen) useUi.getState().set({ aiOpen: true });
      set((s) => ({ region, focusKey: region ? s.focusKey + 1 : s.focusKey }));
    },
    setNodes: (nodes) => set({ nodes }),
    focusComposer: () => set((s) => ({ focusKey: s.focusKey + 1 })),
    setDraft: (draft) => set({ draft }),
    stop: () => controller?.abort(),
    clear: () => {
      controller?.abort();
      set({ messages: [], busy: false });
      persist();
    },
    stash: null,
    // A fresh conversation, with the last one a click away: starting over must never lose what the AI said.
    newChat: () => {
      const { messages } = get();
      if (!messages.length) return;
      controller?.abort();
      set({ stash: { messages, key: Date.now() }, messages: [], busy: false, quotes: [], region: null, nodes: [] });
      persist();
    },
    restoreChat: () => {
      const { stash, messages } = get();
      if (!stash) return;
      set({ messages: [...stash.messages, ...messages], stash: null });
      persist();
    },
    dropStash: () => set({ stash: null }),
  };
});
