"use client";
/**
 * The reader's notes for one paper: a single tree, shown as a mind map or as an outline.
 *
 * Sources are stored next to the text, never inside it, so editing a node never loses where it came from.
 * Everything the AI writes arrives as a draft (dashed) until the reader keeps it, and each AI round is one undo step.
 */
import { create } from "zustand";
import { postJSON } from "@/lib/ai/client";
import { dbGet, dbSet, keys } from "@/lib/db";
import { uid } from "@/lib/hash";
import { languageByCode } from "@/lib/languages";
import { errorMessage, pageOfSentence, useReader } from "./reader";
import { useSettings, pairsWanted } from "./settings";
import { expandCitationRanges } from "@/lib/citations";

export type NodeKind = "root" | "topic" | "question" | "claim" | "excerpt" | "answer" | "note";
export type Marker = "question" | "important" | "check" | "disagree";

export interface SourceRef {
  page: number;
  sids: string[];
}

export interface MapNode {
  id: string;
  parentId: string | null;
  children: string[];
  kind: NodeKind;
  /** First line: in the reader's language, or whatever the reader typed. */
  t: string;
  /** Second line: the same text in the paper's language (AI nodes), shown smaller. */
  s?: string;
  /** Longer text that belongs to the node: an answer, a definition, the reader's own words. */
  note?: string;
  sources: SourceRef[];
  /** A small picture for excerpts taken from a figure. */
  image?: string;
  author: "user" | "ai";
  draft?: boolean;
  collapsed?: boolean;
  marker?: Marker;
  /** The branch that collects excerpts and answers until the reader files them somewhere. */
  inbox?: boolean;
  /**
   * The part of the paper's argument a main branch stands for ("Problem", "Evidence" …), in the reader's language and
   * the paper's: kept apart from its statement, so it can label the branch and later line up maps of several papers.
   */
  role?: { t: string; s?: string };
  createdAt: number;
}

export type MapDisplay = "bilingual" | "reader" | "paper";

export interface MapDoc {
  rootId: string;
  nodes: Record<string, MapNode>;
  display: MapDisplay;
}

export interface Editing {
  id: string;
  /** `replace` starts from the key the reader typed; `append` keeps the text and puts the caret at the end. */
  mode: "replace" | "append";
  initial?: string;
}

interface Generating {
  label: string;
  nodeId?: string;
  done: number;
  total: number;
}

/** A short message at the foot of the notes, with Undo, after a change that is easy to make by accident. */
export interface NotesToast {
  text: string;
  key: number;
}

interface NotesState {
  paperId: string | null;
  doc: MapDoc | null;
  selected: string[];
  /** Whether the reader picked the selection (it then travels with chat questions) or the app did. */
  selectedByUser: boolean;
  editing: Editing | null;
  past: MapDoc[];
  future: MapDoc[];
  generating: Generating | null;
  recall: { on: boolean; revealed: Record<string, "recalled" | "forgot" | "open"> };
  /** Bumped to ask the map to bring nodes into view: the first is the anchor, the rest come along if they fit. */
  focusRequest: { ids: string[]; key: number } | null;
  /** The last AI round, so "Another" can run the same one again. */
  lastRound: { kind: "map"; style: "questions" | "statements" } | { kind: "expand"; id: string; style: "statements" | "questions" | "explain"; ask?: string } | null;
  /** Bumped to ask the map to frame itself again (after AI grows it). */
  frameKey: number;
  toast: NotesToast | null;

  load: (paperId: string, title: string) => Promise<void>;
  select: (ids: string[], byUser?: boolean) => void;
  startEdit: (id: string, mode: Editing["mode"], initial?: string) => void;
  stopEdit: (text?: string) => void;
  setText: (id: string, t: string) => void;
  setNote: (id: string, note: string) => void;
  addChild: (parentId: string, init?: Partial<MapNode>, edit?: boolean) => string | null;
  addSibling: (id: string, before?: boolean) => string | null;
  addParent: (id: string) => string | null;
  remove: (ids: string[]) => void;
  move: (id: string, parentId: string, index: number) => void;
  outdent: (id: string) => void;
  /** Move a node under the sibling above it, as its last child. */
  indent: (id: string) => void;
  /** Move a node one place up (-1) or down (1) among its siblings. */
  reorder: (id: string, by: -1 | 1) => void;
  toggleCollapse: (id: string, collapsed?: boolean) => void;
  /** Fold every main branch (true) or unfold the whole tree (false); one undo step. */
  foldAll: (folded: boolean) => void;
  setMarker: (id: string, marker?: Marker) => void;
  /** File a passage: under `parentId` (null: the excerpts branch), or, left out, under the selected node. */
  addExcerpt: (x: { text: string; page: number; sids: string[]; image?: string }, parentId?: string | null) => string | null;
  addAnswer: (markdown: string, title?: string) => string | null;
  generate: (style: "questions" | "statements") => Promise<void>;
  /** Stop the AI round in progress; what has arrived stays. */
  stopGenerating: () => void;
  expand: (id: string, style: "statements" | "questions" | "explain", ask?: string) => Promise<void>;
  keepDrafts: (id?: string) => void;
  /** Remove AI drafts nobody has touched: in the whole map, in a branch, or (`under`) only below a node. */
  discardDrafts: (id?: string, under?: boolean) => void;
  translateNode: (id: string) => Promise<void>;
  setDisplay: (d: MapDisplay) => void;
  setRecall: (on: boolean) => void;
  reveal: (id: string, result: "recalled" | "forgot" | "open") => void;
  focusNode: (id: string) => void;
  /** Bring these nodes into view together, the first one above all. */
  revealNodes: (ids: string[]) => void;
  notify: (text: string) => void;
  dismissToast: () => void;
  undo: () => void;
  redo: () => void;
}

const HISTORY = 100;

function newNode(init: Partial<MapNode> & { parentId: string | null }): MapNode {
  return {
    id: uid("n"),
    children: [],
    kind: "note",
    t: "",
    sources: [],
    author: "user",
    createdAt: Date.now(),
    ...init,
  };
}

/** Copy-on-write helper: the doc and its node table are copied; touched nodes are copied by `edit`. */
function draftOf(doc: MapDoc) {
  const next: MapDoc = { ...doc, nodes: { ...doc.nodes } };
  const edit = (id: string): MapNode => {
    const n = { ...next.nodes[id], children: [...next.nodes[id].children], sources: [...next.nodes[id].sources] };
    next.nodes[id] = n;
    return n;
  };
  return { next, edit };
}

function subtreeIds(doc: MapDoc, id: string): string[] {
  const out: string[] = [];
  const walk = (x: string) => {
    out.push(x);
    for (const c of doc.nodes[x]?.children ?? []) walk(c);
  };
  walk(id);
  return out;
}

export function pathOf(doc: MapDoc, id: string): MapNode[] {
  const out: MapNode[] = [];
  let cur: MapNode | undefined = doc.nodes[id];
  while (cur) {
    out.unshift(cur);
    cur = cur.parentId ? doc.nodes[cur.parentId] : undefined;
  }
  return out;
}

export function depthOf(doc: MapDoc, id: string): number {
  return pathOf(doc, id).length - 1;
}

/**
 * How nodes show their two languages, from the one language setting: the reader's language, with the paper's own
 * wording under it while the reader wants English under what the AI writes.
 */
export function mapDisplay(): MapDisplay {
  return pairsWanted() ? "bilingual" : "reader";
}

export function useMapDisplay(): MapDisplay {
  return useSettings((s) => (pairsWanted(s) ? "bilingual" : "reader"));
}

/** The text a node shows first, honouring the display setting. */
export function primaryText(n: MapNode, display: MapDisplay): string {
  if (n.kind === "root") return n.s || n.t;
  if (display === "paper") return n.s || n.t;
  return n.t || n.s || "";
}

export function secondaryText(n: MapNode, display: MapDisplay): string | null {
  if (n.kind === "root") return n.s && n.t && n.t !== n.s ? n.t : null;
  if (display !== "bilingual") return null;
  return n.t && n.s && n.s !== n.t ? n.s : null;
}

/** Sentence citations such as [[p3s12, p4s2]] in an AI answer. */
export const CITATION = /\[\[\s*(p\d+s\d+(?:\s*[,;]\s*p\d+s\d+)*)\s*\]\]/g;

export function sourcesFromSids(sids: string[]): SourceRef[] {
  const byPage = new Map<number, string[]>();
  for (const sid of sids) {
    const page = pageOfSentence(sid);
    if (!Number.isFinite(page) || page < 1) continue;
    byPage.set(page, [...(byPage.get(page) ?? []), sid]);
  }
  return [...byPage.entries()].sort((a, b) => a[0] - b[0]).map(([page, ids]) => ({ page, sids: [...new Set(ids)] }));
}

/** Keep only sentence ids that exist in this paper: the model may only point at real sentences. */
function realSids(sids: string[]): string[] {
  const { pageText } = useReader.getState();
  return sids.filter((sid) => pageText[pageOfSentence(sid)]?.sentences.some((s) => s.id === sid));
}

function stripCitations(s: string): string {
  return expandCitationRanges(s).replace(CITATION, "").replace(/\[\[(?:beyond|openalex)\]\]\s*/gi, "").replace(/\s+([,.;:!?。，；：！？])/g, "$1").replace(/[ \t]{2,}/g, " ").trim();
}

function shorten(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const at = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("，"), cut.lastIndexOf(","));
  return `${(at > n * 0.6 ? cut.slice(0, at) : cut).trim()}…`;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** The AI round in progress; a stopped (or superseded) round's late answers are dropped. */
let round = 0;

type AiNode = {
  in_paper_language: string;
  in_reader_language: string;
  sids: string[];
  children?: AiNode[];
  role_in_paper_language?: string;
  role_in_reader_language?: string;
};

/** The name of the excerpts branch, in the language the reader takes notes in. */
const INBOX_LABEL: Record<string, string> = {
  "zh-Hans": "摘录",
  "zh-Hant": "摘錄",
  ja: "抜粋",
  ko: "발췌",
  es: "Extractos",
  fr: "Extraits",
  de: "Auszüge",
  pt: "Trechos",
  ru: "Выдержки",
};

export const useNotes = create<NotesState>((set, get) => {
  /** The excerpts branch under the root, made the first time something needs filing. */
  const inboxOf = (doc: MapDoc): string | null => {
    const root = doc.nodes[doc.rootId];
    const found = root.children.find((c) => doc.nodes[c]?.inbox || (doc.nodes[c]?.kind === "topic" && doc.nodes[c].t === "Unsorted"));
    if (found) return found;
    const label = INBOX_LABEL[useSettings.getState().lang] ?? "Excerpts";
    return get().addChild(doc.rootId, { kind: "topic", t: label, inbox: true }, false);
  };
  const save = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const { paperId, doc } = get();
      if (paperId && doc) void dbSet(keys.map(paperId), doc);
    }, 250);
  };

  /**
   * Touching a node inside an AI draft (writing in it, adding under it, keeping it, moving it, writing a note on it)
   * makes its whole path up to the title the reader's, so discarding the draft can never take the reader's work.
   */
  const keepPath = (d: ReturnType<typeof draftOf>, id: string | null | undefined) => {
    let cur = id ? d.next.nodes[id] : undefined;
    while (cur) {
      if (cur.draft) d.edit(cur.id).draft = false;
      cur = cur.parentId ? d.next.nodes[cur.parentId] : undefined;
    }
  };

  /** Apply a change as one undo step. */
  const commit = (fn: (d: ReturnType<typeof draftOf>) => void) => {
    const { doc, past } = get();
    if (!doc) return;
    const d = draftOf(doc);
    fn(d);
    set({ doc: d.next, past: [...past, doc].slice(-HISTORY), future: [] });
    save();
  };

  /** Apply a change that belongs to an undo step already taken (streaming AI results). */
  const patch = (fn: (d: ReturnType<typeof draftOf>) => void) => {
    const { doc } = get();
    if (!doc) return;
    const d = draftOf(doc);
    fn(d);
    set({ doc: d.next });
    save();
  };

  const toNodes = (items: AiNode[], parentId: string, kind: NodeKind, childKind: NodeKind, d: ReturnType<typeof draftOf>): string[] => {
    const ids: string[] = [];
    for (const it of items) {
      const t = (it.in_reader_language || it.in_paper_language || "").trim();
      const s = (it.in_paper_language || "").trim();
      if (!t) continue;
      const roleT = (it.role_in_reader_language || it.role_in_paper_language || "").trim();
      const roleS = (it.role_in_paper_language || "").trim();
      const node = newNode({
        parentId,
        kind,
        t,
        s: s && s !== t ? s : undefined,
        sources: sourcesFromSids(realSids(it.sids ?? [])),
        author: "ai",
        draft: true,
        ...(roleT ? { role: { t: roleT, s: roleS && roleS !== roleT ? roleS : undefined } } : {}),
      });
      d.next.nodes[node.id] = node;
      ids.push(node.id);
      if (it.children?.length) node.children = toNodes(it.children, node.id, childKind, childKind, d);
    }
    return ids;
  };

  const callMap = <T,>(body: Record<string, unknown>) => {
    const reader = useReader.getState();
    return postJSON<T>("/api/mindmap", {
      title: reader.title,
      paper: reader.paperText(),
      lang: useSettings.getState().lang,
      ...body,
    });
  };

  const labelOf = (n: MapNode) => n.s || n.t;

  return {
    paperId: null,
    doc: null,
    selected: [],
    selectedByUser: false,
    editing: null,
    past: [],
    future: [],
    generating: null,
    recall: { on: false, revealed: {} },
    focusRequest: null,
    lastRound: null,
    frameKey: 0,
    toast: null,

    load: async (paperId, title) => {
      set({ paperId, doc: null, selected: [], editing: null, past: [], future: [], generating: null, recall: { on: false, revealed: {} }, toast: null, lastRound: null });
      const saved = await dbGet<MapDoc>(keys.map(paperId));
      if (get().paperId !== paperId) return;
      if (saved?.rootId && saved.nodes?.[saved.rootId]) {
        // Drop nodes that were created and never written in (a tab closed mid-edit).
        const nodes = { ...saved.nodes };
        for (const n of Object.values(nodes)) {
          if (n.kind === "root" || n.t || n.s || n.note || n.image || n.children.length) continue;
          delete nodes[n.id];
          const p = n.parentId ? nodes[n.parentId] : null;
          if (p) nodes[p.id] = { ...p, children: p.children.filter((c) => c !== n.id) };
        }
        set({ doc: { ...saved, nodes } });
        return;
      }
      const root = newNode({ parentId: null, kind: "root", t: "", s: title, author: "user" });
      set({ doc: { rootId: root.id, nodes: { [root.id]: root }, display: "bilingual" } });
    },

    select: (ids, byUser = false) => set({ selected: ids, selectedByUser: byUser && ids.length > 0 }),

    startEdit: (id, mode, initial) => {
      if (get().recall.on) return;
      set({ editing: { id, mode, initial }, selected: [id] });
    },

    stopEdit: (text) => {
      const { editing, doc } = get();
      if (!editing || !doc) return;
      set({ editing: null });
      const node = doc.nodes[editing.id];
      if (!node) return;
      if (text === undefined) {
        // Cancelled: a node that was never given text disappears again.
        if (!node.t && !node.s && node.kind !== "root" && !node.children.length && !node.note) get().remove([node.id]);
        return;
      }
      const t = text.replace(/\s+$/g, "").replace(/^\s+/g, "");
      if (!t && node.kind !== "root") {
        if (!node.children.length && !node.note && !node.image) get().remove([node.id]);
        return;
      }
      get().setText(node.id, t);
    },

    setText: (id, t) => {
      const node = get().doc?.nodes[id];
      if (!node || primaryText(node, mapDisplay()) === t) return;
      commit((d) => {
        const n = d.edit(id);
        if (n.kind === "root") {
          // The root's first line is the paper's title as written; editing it renames the map.
          n.s = t;
        } else if (mapDisplay() === "paper" && n.s) {
          n.s = t;
          n.t = n.t && n.author === "ai" ? "" : n.t;
        } else {
          n.t = t;
          // The second line was a translation of the old text; it no longer matches.
          n.s = undefined;
        }
        n.author = "user";
        n.draft = false;
        keepPath(d, id);
      });
    },

    setNote: (id, note) => {
      const node = get().doc?.nodes[id];
      if (!node || (node.note ?? "") === note) return;
      commit((d) => {
        d.edit(id).note = note || undefined;
        keepPath(d, id);
      });
    },

    addChild: (parentId, init, editNow = true) => {
      const { doc } = get();
      if (!doc?.nodes[parentId]) return null;
      const node = newNode({ parentId, ...init });
      commit((d) => {
        d.next.nodes[node.id] = node;
        const p = d.edit(parentId);
        p.children.push(node.id);
        p.collapsed = false;
        keepPath(d, parentId);
      });
      set({ selected: [node.id], selectedByUser: false });
      if (editNow) set({ editing: { id: node.id, mode: "replace", initial: "" } });
      get().revealNodes([node.id, parentId]);
      return node.id;
    },

    addSibling: (id, before = false) => {
      const { doc } = get();
      const n = doc?.nodes[id];
      if (!doc || !n) return null;
      if (!n.parentId) return get().addChild(id);
      const node = newNode({ parentId: n.parentId });
      commit((d) => {
        d.next.nodes[node.id] = node;
        const p = d.edit(n.parentId!);
        const at = p.children.indexOf(id);
        p.children.splice(before ? at : at + 1, 0, node.id);
        keepPath(d, n.parentId);
      });
      set({ selected: [node.id], selectedByUser: false, editing: { id: node.id, mode: "replace", initial: "" } });
      get().revealNodes([node.id, n.parentId]);
      return node.id;
    },

    addParent: (id) => {
      const { doc } = get();
      const n = doc?.nodes[id];
      if (!doc || !n?.parentId) return null;
      const node = newNode({ parentId: n.parentId, children: [id] });
      commit((d) => {
        d.next.nodes[node.id] = node;
        const p = d.edit(n.parentId!);
        p.children.splice(p.children.indexOf(id), 1, node.id);
        d.edit(id).parentId = node.id;
        keepPath(d, n.parentId);
      });
      set({ selected: [node.id], selectedByUser: false, editing: { id: node.id, mode: "replace", initial: "" } });
      return node.id;
    },

    remove: (ids) => {
      const { doc } = get();
      if (!doc) return;
      const targets = ids.filter((id) => doc.nodes[id] && doc.nodes[id].kind !== "root");
      if (!targets.length) return;
      // Select a neighbour so the keyboard keeps working.
      const first = doc.nodes[targets[0]];
      const siblings = first.parentId ? doc.nodes[first.parentId].children : [];
      const at = siblings.indexOf(first.id);
      const after = siblings.filter((s) => !targets.includes(s));
      const nextSel = after[Math.min(at, after.length - 1)] ?? first.parentId;
      commit(({ next, edit }) => {
        for (const id of targets) {
          if (!next.nodes[id]) continue;
          const n = next.nodes[id];
          if (n.parentId && next.nodes[n.parentId]) {
            const p = edit(n.parentId);
            p.children = p.children.filter((c) => c !== id);
          }
          for (const x of subtreeIds(next, id)) delete next.nodes[x];
        }
      });
      set({ selected: nextSel ? [nextSel] : [], selectedByUser: false, editing: null });
    },

    move: (id, parentId, index) => {
      const { doc } = get();
      const n = doc?.nodes[id];
      if (!doc || !n || !n.parentId || !doc.nodes[parentId]) return;
      if (subtreeIds(doc, id).includes(parentId)) return;
      commit((d) => {
        const from = d.edit(n.parentId!);
        const oldIndex = from.children.indexOf(id);
        from.children.splice(oldIndex, 1);
        const to = n.parentId === parentId ? from : d.edit(parentId);
        const at = n.parentId === parentId && oldIndex < index ? index - 1 : index;
        to.children.splice(Math.max(0, Math.min(at, to.children.length)), 0, id);
        to.collapsed = false;
        d.edit(id).parentId = parentId;
        // Placing a node is a decision about it: it and the branch it now hangs from are the reader's.
        keepPath(d, id);
      });
    },

    outdent: (id) => {
      const { doc } = get();
      const n = doc?.nodes[id];
      const p = n?.parentId ? doc!.nodes[n.parentId] : null;
      if (!doc || !n || !p?.parentId) return;
      const gp = doc.nodes[p.parentId];
      get().move(id, gp.id, gp.children.indexOf(p.id) + 1);
    },

    reorder: (id, by) => {
      const { doc } = get();
      const n = doc?.nodes[id];
      if (!doc || !n?.parentId) return;
      const siblings = doc.nodes[n.parentId].children;
      const i = siblings.indexOf(id);
      const j = i + by;
      if (j < 0 || j >= siblings.length) return;
      // `move` counts the slot before removing the node, so moving down skips past the next sibling.
      get().move(id, n.parentId, by < 0 ? j : j + 1);
      get().focusNode(id);
    },

    indent: (id) => {
      const { doc } = get();
      const n = doc?.nodes[id];
      if (!doc || !n?.parentId) return;
      const siblings = doc.nodes[n.parentId].children;
      const above = siblings[siblings.indexOf(id) - 1];
      if (above) get().move(id, above, doc.nodes[above].children.length);
    },

    toggleCollapse: (id, collapsed) => {
      const n = get().doc?.nodes[id];
      if (!n || !n.children.length) return;
      commit(({ edit }) => {
        edit(id).collapsed = collapsed ?? !n.collapsed;
      });
    },

    foldAll: (folded) => {
      const doc = get().doc;
      if (!doc) return;
      const root = doc.nodes[doc.rootId];
      commit(({ next, edit }) => {
        if (folded) {
          for (const id of root.children) if (next.nodes[id]?.children.length) edit(id).collapsed = true;
        } else {
          for (const n of Object.values(next.nodes)) if (n.collapsed) edit(n.id).collapsed = false;
        }
      });
      set((st) => ({ frameKey: st.frameKey + 1 }));
    },

    setMarker: (id, marker) =>
      commit(({ edit }) => {
        edit(id).marker = marker;
      }),

    addExcerpt: ({ text, page, sids, image }, target) => {
      const { doc, selected } = get();
      if (!doc) return null;
      let parentId = target === undefined ? (selected.find((id) => doc.nodes[id]) ?? null) : target && doc.nodes[target] ? target : null;
      // An excerpt can't hang under another excerpt; it goes next to it.
      if (parentId && doc.nodes[parentId].kind === "excerpt") parentId = doc.nodes[parentId].parentId;
      if (!parentId) parentId = inboxOf(doc);
      if (!parentId) return null;
      const clean = text.replace(/\s+/g, " ").trim();
      const id = get().addChild(
        parentId,
        { kind: "excerpt", t: shorten(clean, 900), sources: sourcesFromSids(sids).length ? sourcesFromSids(sids) : [{ page, sids: [] }], image },
        false,
      );
      if (id) set({ selected: [id], selectedByUser: false });
      return id;
    },

    addAnswer: (markdown, title) => {
      const { doc, selected } = get();
      if (!doc) return null;
      let parentId = selected.find((id) => doc.nodes[id]) ?? null;
      if (!parentId) parentId = inboxOf(doc);
      if (!parentId) return null;

      // A list in the answer becomes a branch, keeping its nesting; its citations become sources.
      const lines = markdown.split("\n");
      type Item = { text: string; depth: number; sids: string[]; children: Item[] };
      const items: Item[] = [];
      const stack: Item[] = [];
      const allSids: string[] = [];
      for (const raw of lines) {
        const m = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/.exec(raw);
        const sids = [...expandCitationRanges(raw).matchAll(CITATION)].flatMap((x) => x[1].split(/\s*[,;]\s*/));
        allSids.push(...sids);
        if (!m) continue;
        const depth = Math.floor(m[1].replace(/\t/g, "  ").length / 2);
        const item: Item = { text: stripCitations(m[2]).replace(/\*\*/g, ""), depth, sids, children: [] };
        while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
        if (stack.length) stack[stack.length - 1].children.push(item);
        else items.push(item);
        stack.push(item);
      }
      const plain = stripCitations(markdown.replace(/\*\*/g, "").replace(/^#+\s*/gm, ""));
      const firstPara = plain.split(/\n\s*\n/)[0] ?? plain;
      const head = title?.trim() || shorten(firstPara.split(/(?<=[.!?。！？])\s*/)[0] ?? firstPara, 90);
      // List items become child nodes; the note keeps only the prose around them.
      const prose = items.length
        ? plain
            .split("\n")
            .filter((l) => !/^\s*(?:[-*+]|\d+[.)])\s+/.test(l))
            .join("\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim()
        : plain;
      const answer = newNode({
        parentId,
        kind: "answer",
        t: head,
        note: prose && prose !== head ? prose : undefined,
        sources: sourcesFromSids(realSids(allSids)).slice(0, 6),
        author: "ai",
      });
      const build = (list: Item[], pid: string, d: ReturnType<typeof draftOf>): string[] =>
        list
          .filter((it) => it.text)
          .slice(0, 12)
          .map((it) => {
            const n = newNode({ parentId: pid, kind: "claim", t: shorten(it.text, 120), note: it.text.length > 120 ? it.text : undefined, sources: sourcesFromSids(realSids(it.sids)), author: "ai" });
            d.next.nodes[n.id] = n;
            n.children = build(it.children, n.id, d);
            return n.id;
          });
      commit((d) => {
        d.next.nodes[answer.id] = answer;
        answer.children = build(items, answer.id, d);
        const p = d.edit(parentId!);
        p.children.push(answer.id);
        p.collapsed = false;
        keepPath(d, parentId);
      });
      set({ selected: [answer.id], selectedByUser: false });
      get().revealNodes([answer.id, parentId!, ...answer.children]);
      return answer.id;
    },

    generate: async (style) => {
      const { doc, generating } = get();
      if (!doc || generating) return;
      const reader = useReader.getState();
      if (!reader.textPages) {
        reader.setNotice("The paper is still being read. Try again in a moment.");
        return;
      }
      // One undo step for the whole round.
      const mine = ++round;
      set({ past: [...get().past, doc].slice(-HISTORY), future: [], lastRound: { kind: "map", style }, generating: { label: style === "questions" ? "Writing questions" : "Drafting the map", done: 0, total: 1 } });
      try {
        const outline = await callMap<{ root: { in_paper_language: string; in_reader_language: string }; branches: AiNode[] }>({ mode: "outline" });
        if (get().paperId !== reader.paperId || round !== mine) return;
        let topicIds: string[] = [];
        patch((d) => {
          const root = d.edit(d.next.rootId);
          const tr = outline.root.in_reader_language?.trim();
          if (tr && tr !== root.s) root.t = tr;
          topicIds = toNodes(outline.branches, root.id, "topic", "topic", d);
          root.children.push(...topicIds);
          root.collapsed = false;
        });
        set((st) => ({ generating: { ...st.generating!, done: 0, total: topicIds.length }, frameKey: st.frameKey + 1 }));
        const siblings = outline.branches.map((b) => b.in_paper_language);
        let next = 0;
        const worker = async () => {
          while (next < topicIds.length && round === mine) {
            const id = topicIds[next++];
            const topic = get().doc?.nodes[id];
            if (!topic) continue;
            try {
              const res = await callMap<{ children: AiNode[] }>({
                mode: "branch",
                style,
                path: [get().doc!.nodes[get().doc!.rootId].s ?? reader.title, labelOf(topic)],
                siblings: siblings.filter((s) => s !== topic.s && s !== topic.t),
              });
              if (round !== mine) return;
              patch((d) => {
                if (!d.next.nodes[id]) return;
                const kids = toNodes(res.children, id, style === "questions" ? "question" : "claim", "claim", d);
                const topic = d.edit(id);
                topic.children.push(...kids);
                // Each branch arrives folded, with its count: the map grows calmly as the paper's outline, instead of
                // spreading out and folding up again at the end. Unfold a branch to read on.
                if (kids.length) topic.collapsed = true;
              });
            } catch (err) {
              console.warn("Branch failed", err);
            } finally {
              const g = get().generating;
              if (g && round === mine) set({ generating: { ...g, done: g.done + 1 } });
            }
          }
        };
        await Promise.all([worker(), worker(), worker(), worker()]);
        set((st) => ({ frameKey: st.frameKey + 1 }));
      } catch (err) {
        if (round === mine) useReader.getState().setNotice(errorMessage(err, "The map couldn't be generated. Try again."));
      } finally {
        if (round === mine) set({ generating: null });
      }
    },

    stopGenerating: () => {
      if (!get().generating) return;
      round++;
      set({ generating: null });
    },

    expand: async (id, style, ask) => {
      const { doc, generating } = get();
      const node = doc?.nodes[id];
      if (!doc || !node || generating) return;
      const mine = ++round;
      set({ past: [...get().past, doc].slice(-HISTORY), future: [], lastRound: { kind: "expand", id, style, ask }, generating: { label: "Growing this branch", nodeId: id, done: 0, total: 1 } });
      try {
        const path = pathOf(doc, id).map((n) => (n.kind === "root" ? n.s || n.t : labelOf(n)));
        const res = await callMap<{ children: AiNode[] }>({
          mode: "expand",
          style,
          path,
          existing: node.children.map((c) => doc.nodes[c]).filter(Boolean).map(labelOf),
          ask: ask ?? "",
        });
        if (round !== mine) return;
        let added: string[] = [];
        patch((d) => {
          if (!d.next.nodes[id]) return;
          added = toNodes(res.children, id, style === "questions" ? "question" : "claim", "claim", d);
          const n = d.edit(id);
          n.children.push(...added);
          n.collapsed = false;
        });
        get().revealNodes([id, ...added]);
      } catch (err) {
        if (round === mine) useReader.getState().setNotice(errorMessage(err, "That branch couldn't be grown. Try again."));
      } finally {
        if (round === mine) set({ generating: null });
      }
    },

    keepDrafts: (id) => {
      const { doc } = get();
      if (!doc) return;
      const ids = id ? subtreeIds(doc, id) : Object.keys(doc.nodes);
      if (!ids.some((x) => doc.nodes[x]?.draft)) return;
      commit((d) => {
        for (const x of ids) if (d.next.nodes[x]?.draft) d.edit(x).draft = false;
        if (id) keepPath(d, id);
      });
    },

    discardDrafts: (id, under = false) => {
      const { doc } = get();
      if (!doc) return;
      const scope = new Set(id ? subtreeIds(doc, id) : Object.keys(doc.nodes));
      if (id && under) scope.delete(id);
      // A draft goes only if nothing under it is the reader's; then only the top of each such branch needs removing.
      const memo = new Map<string, boolean>();
      const untouched = (x: string): boolean => {
        if (memo.has(x)) return memo.get(x)!;
        const n = doc.nodes[x];
        const v = !!n?.draft && n.children.every(untouched);
        memo.set(x, v);
        return v;
      };
      const tops = [...scope].filter((x) => untouched(x) && !(scope.has(doc.nodes[x].parentId ?? "") && untouched(doc.nodes[x].parentId!)));
      if (tops.length) get().remove(tops);
    },

    translateNode: async (id) => {
      const { doc } = get();
      const node = doc?.nodes[id];
      if (!doc || !node || node.kind === "root") return;
      const readerLang = useSettings.getState().lang;
      const paperLang = useReader.getState().paperLang();
      const text = node.t || node.s || "";
      if (!text) return;
      const cjk = /[぀-ヿ㐀-鿿가-힯]/.test(text);
      const inReaderLang = languageByCode(readerLang).cjk === cjk;
      const target = inReaderLang ? paperLang : readerLang;
      if (target === (inReaderLang ? readerLang : paperLang)) return;
      try {
        const res = await postJSON<{ labels: { id: string; text: string }[] }>("/api/translate-labels", {
          lang: target,
          title: useReader.getState().title,
          labels: [{ id: "x", text }],
        });
        const out = res.labels[0]?.text?.trim();
        if (!out) return;
        commit(({ edit }) => {
          const n = edit(id);
          if (inReaderLang) {
            n.t = text;
            n.s = out;
          } else {
            n.s = text;
            n.t = out;
          }
        });
      } catch (err) {
        useReader.getState().setNotice(errorMessage(err, "Couldn't translate that node."));
      }
    },

    setDisplay: (display) => {
      const { doc } = get();
      if (!doc) return;
      set({ doc: { ...doc, display } });
      save();
    },

    setRecall: (on) => set({ recall: { on, revealed: {} }, editing: null }),
    reveal: (id, result) => set((s) => ({ recall: { ...s.recall, revealed: { ...s.recall.revealed, [id]: result } } })),

    focusNode: (id) => set({ focusRequest: { ids: [id], key: Date.now() } }),
    revealNodes: (ids) => set({ focusRequest: { ids: ids.filter(Boolean), key: Date.now() } }),

    notify: (text) => set({ toast: { text, key: Date.now() } }),
    dismissToast: () => set({ toast: null }),

    undo: () => {
      const { past, doc, future } = get();
      if (!past.length || !doc) return;
      const prev = past[past.length - 1];
      set({ doc: prev, past: past.slice(0, -1), future: [doc, ...future].slice(0, HISTORY), editing: null, selected: get().selected.filter((id) => prev.nodes[id]), toast: null });
      save();
    },

    redo: () => {
      const { past, doc, future } = get();
      if (!future.length || !doc) return;
      const nxt = future[0];
      set({ doc: nxt, past: [...past, doc].slice(-HISTORY), future: future.slice(1), editing: null, selected: get().selected.filter((id) => nxt.nodes[id]) });
      save();
    },
  };
});
