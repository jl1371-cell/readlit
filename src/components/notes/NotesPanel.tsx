"use client";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import clsx from "clsx";
import { Check, ChevronDown, MoreHorizontal } from "lucide-react";
import { type ReactNode, useEffect, useMemo } from "react";
import { Tip } from "@/components/ui/primitives";
import { useNotes } from "@/lib/store/notes";
import { useReader } from "@/lib/store/reader";
import { type NotesView, useUi } from "@/lib/store/ui";
import { draftMindMap, usePassageOver } from "./actions";
import { exportMarkdown, exportPng } from "./export";
import { MapView, mapApi } from "./MapView";
import { NotesEmpty } from "./NotesEmpty";
import { OutlineView } from "./OutlineView";

/**
 * The notes column: what the reader keeps. One tree, seen two ways: an outline written down the page, or a mind
 * map. Excerpts, the reader's own lines and the AI's drafts all live in the same tree.
 */
export function NotesPanel() {
  const view = useUi((s) => s.notesView);
  return (
    <div className="relative h-full">
      {view === "map" ? (
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 70% 55% at 15% 10%, rgba(209,75,40,0.06), transparent 60%), radial-gradient(ellipse 60% 50% at 90% 95%, rgba(233,167,82,0.07), transparent 60%), #FAF6EF" }}>
          <MapArea />
        </div>
      ) : (
        <OutlineView />
      )}
      {/* The foot of the column: what just happened (with Undo), and the AI draft waiting for a decision. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex flex-col items-center gap-2 px-4" data-export-hide="true">
        <PassageHint />
        <Toast />
        <DraftBar />
      </div>
    </div>
  );
}

/** The column's name in the header, with what is in it. */
export function NotesTitle() {
  const count = useNotes((s) => (s.doc ? Object.keys(s.doc.nodes).length - 1 : 0));
  return (
    <div className="min-w-0 shrink pr-1">
      <div className="truncate font-display text-body/5 text-ink">Notes</div>
      <div className="tabular truncate text-caption text-latte">{count > 0 ? `${count} ${count === 1 ? "note" : "notes"}` : "What you keep"}</div>
    </div>
  );
}

/** While a passage is dragged over the notes: where it can go. */
function PassageHint() {
  const over = usePassageOver((s) => s.over);
  const view = useUi((s) => s.notesView);
  const empty = useNotes((s) => !!s.doc && s.doc.nodes[s.doc.rootId].children.length === 0);
  if (!over || empty) return null;
  return (
    <div className="glass card-in flex items-center rounded-full px-4 py-2 text-ui text-ink shadow-card-hover">
      {view === "map" ? "Drop it on a branch to keep it there" : "Drop it on a line to keep it there"}
    </div>
  );
}

/** "Deleted … · Undo": a mistake is one click from undone, so nothing needs an "Are you sure?". */
function Toast() {
  const toast = useNotes((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => useNotes.getState().dismissToast(), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return (
    <div key={toast.key} role="status" className="glass card-in pointer-events-auto flex max-w-full items-center gap-1 rounded-full py-1.5 pl-4 pr-1.5 text-ui text-ink shadow-card-hover">
      <span className="mr-1 min-w-0 truncate">{toast.text}</span>
      <button type="button" onClick={() => useNotes.getState().undo()} className="shrink-0 rounded-full px-3 py-1 font-medium text-paprika hover:bg-paprika-ghost pointer-coarse:py-2">
        Undo
      </button>
    </div>
  );
}

const VIEWS: { id: NotesView; label: string }[] = [
  { id: "notes", label: "Outline" },
  { id: "map", label: "Mind map" },
];

/** Outline ⇄ Mind map, in the header above the column. */
export function NotesViewSwitch() {
  const view = useUi((s) => s.notesView);
  return (
    <div className="flex shrink-0 items-center rounded-full bg-canvas/80 p-[3px] ring-1 ring-latte-line/40" role="tablist" aria-label="Show the notes as">
      {VIEWS.map((v) => (
        <button
          key={v.id}
          type="button"
          role="tab"
          aria-selected={view === v.id}
          onClick={() => useUi.getState().set({ notesView: v.id, ...(v.id === "notes" ? { mapExpanded: false } : {}) })}
          className={clsx("h-7 whitespace-nowrap rounded-full px-3 text-ui font-medium transition-colors", view === v.id ? "bg-paper text-ink shadow-card" : "text-latte-deep hover:text-ink")}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

function MapArea() {
  const doc = useNotes((s) => s.doc);
  const empty = !!doc && doc.nodes[doc.rootId].children.length === 0;
  const generating = useNotes((s) => !!s.generating);
  return (
    <>
      <MapView />
      {empty && !generating && (
        <div className="pointer-events-none absolute inset-x-0 bottom-16 flex justify-center px-6">
          <NotesEmpty />
        </div>
      )}
    </>
  );
}

function Item({ children, hint, keys, onSelect, disabled, checked }: { children: ReactNode; hint?: string; keys?: string; onSelect: () => void; disabled?: boolean; checked?: boolean }) {
  return (
    <Dropdown.Item
      disabled={disabled}
      onSelect={onSelect}
      className="flex cursor-default items-start gap-2 rounded-xl px-2.5 py-2 outline-none data-[disabled]:opacity-45 data-[highlighted]:bg-canvas pointer-coarse:py-2.5"
    >
      {checked !== undefined && <span className="mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center">{checked && <Check className="h-4 w-4 text-paprika" />}</span>}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-ui font-medium text-ink">{children}</span>
        {hint && <span className="text-label text-latte">{hint}</span>}
      </span>
      {keys && <span className="mt-[2px] shrink-0 text-caption text-latte">{keys}</span>}
    </Dropdown.Item>
  );
}

const CONTENT = "card-in z-[70] rounded-2xl border border-latte-line/40 bg-paper p-1.5 shadow-card-hover";
const SEP = "my-1 h-px bg-latte-line/30";

/**
 * The map's zoom, in the header beside the view switch, like the paper's: zoom out, in, fit, actual size, and more
 * room for the map. Nothing floats over the map but what the selected node needs.
 */
export function MapZoom() {
  const view = useUi((s) => s.notesView);
  const zoom = useUi((s) => s.mapZoom);
  const expanded = useUi((s) => s.mapExpanded);
  if (view !== "map") return null;
  return (
    <Dropdown.Root>
      <Tip label="Zoom and room">
        <Dropdown.Trigger asChild>
          <button
            type="button"
            aria-label="Zoom the map"
            className="tabular inline-flex h-8 shrink-0 items-center gap-1 rounded-full pl-2.5 pr-2 text-ui font-medium text-latte-deep hover:bg-parchment/70 hover:text-ink data-[state=open]:bg-parchment/70"
          >
            {Math.round(zoom * 100)}%
            <ChevronDown className="h-3.5 w-3.5 text-latte" />
          </button>
        </Dropdown.Trigger>
      </Tip>
      <Dropdown.Portal>
        <Dropdown.Content align="end" sideOffset={6} className={clsx(CONTENT, "w-[15rem]")}>
          <Item onSelect={() => mapApi.zoom(1)}>Zoom in</Item>
          <Item onSelect={() => mapApi.zoom(-1)}>Zoom out</Item>
          <Item onSelect={() => mapApi.frame()} hint="The whole map, or the title at a reading size">
            Fit the map
          </Item>
          <Item onSelect={() => mapApi.zoomTo(1)}>Actual size</Item>
          <Dropdown.Separator className={SEP} />
          <Item checked={expanded} onSelect={() => useUi.getState().set({ mapExpanded: !expanded })} hint="The paper stays beside it, narrower">
            Give the map more room
          </Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

/** Everything else the notes can do, in one place. */
export function NotesMenu() {
  const view = useUi((s) => s.notesView);
  const generating = useNotes((s) => !!s.generating);
  const recall = useNotes((s) => s.recall.on);
  const anyFolded = useNotes((s) => !!s.doc && Object.values(s.doc.nodes).some((n) => n.collapsed));
  const canUndo = useNotes((s) => s.past.length > 0);
  const canRedo = useNotes((s) => s.future.length > 0);
  const title = useReader((s) => s.title);
  const ready = useReader((s) => s.textPages > 0);

  return (
    <Dropdown.Root>
      <Tip label="More">
        <Dropdown.Trigger asChild>
          <button type="button" aria-label="More for the notes" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-latte-deep hover:bg-parchment/70 hover:text-ink data-[state=open]:bg-parchment/70">
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </Dropdown.Trigger>
      </Tip>
      <Dropdown.Portal>
        <Dropdown.Content align="end" sideOffset={6} className={clsx(CONTENT, "w-[17.5rem]")}>
          <Item disabled={!canUndo} onSelect={() => useNotes.getState().undo()} keys="⌘ Z">
            Undo
          </Item>
          <Item disabled={!canRedo} onSelect={() => useNotes.getState().redo()} keys="⇧ ⌘ Z">
            Redo
          </Item>
          <Dropdown.Separator className={SEP} />
          <Item disabled={generating || !ready} onSelect={draftMindMap} hint="Branches follow the paper; your own notes stay.">
            Draft a mind map
          </Item>
          <Item onSelect={() => useNotes.getState().foldAll(!anyFolded)} hint={anyFolded ? "Show every branch in full." : "Leave only the main branches open."}>
            {anyFolded ? "Unfold everything" : "Fold to the main branches"}
          </Item>
          {view === "map" && (
            <Item onSelect={() => useNotes.getState().setRecall(!recall)} hint="Hide the details, recall them, then reveal.">
              {recall ? "Stop testing yourself" : "Test yourself"}
            </Item>
          )}
          <Dropdown.Separator className={SEP} />
          <ExportItems title={title} view={view} />
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

function ExportItems({ title, view }: { title: string; view: NotesView }) {
  const doc = useNotes((s) => s.doc);
  return (
    <>
      <Item onSelect={() => doc && exportMarkdown(doc, title)} hint="A nested list, with both languages and page numbers.">
        Export as Markdown
      </Item>
      {view === "map" && (
        <Item onSelect={() => void exportPng(mapApi.getNodes(), title)} hint="The whole map, on paper, at 2×.">
          Export the map as an image
        </Item>
      )}
    </>
  );
}

/** Write the last AI draft again: the same branch grown again, or the whole map drafted again. */
function redraft() {
  const st = useNotes.getState();
  const round = st.lastRound;
  const d = st.doc;
  if (round?.kind === "expand" && d?.nodes[round.id]) {
    st.discardDrafts(round.id, true);
    void st.expand(round.id, round.style, round.ask);
    return;
  }
  st.discardDrafts();
  draftMindMap();
}

function DraftBar() {
  const doc = useNotes((s) => s.doc);
  const generating = useNotes((s) => s.generating);
  const recall = useNotes((s) => s.recall);
  // A selected draft has its own Keep and Discard; the bar steps back so only one red button shows.
  const draftSelected = useNotes((s) => s.selected.length === 1 && !!s.doc?.nodes[s.selected[0]]?.draft);
  const drafts = useMemo(() => (doc ? Object.values(doc.nodes).filter((n) => n.draft).length : 0), [doc]);
  const tally = useMemo(() => {
    const v = Object.values(recall.revealed);
    return { got: v.filter((x) => x === "recalled").length, total: v.filter((x) => x !== "open").length };
  }, [recall.revealed]);

  if (generating) {
    return (
      <div className="glass card-in pointer-events-auto flex items-center gap-2.5 rounded-full py-1.5 pl-4 pr-1.5 text-ui text-ink shadow-card-hover">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-paprika/50" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-paprika" />
        </span>
        {generating.label}
        {generating.total > 1 && (
          <span className="tabular text-latte">
            {generating.done} of {generating.total} branches
          </span>
        )}
        <button
          type="button"
          onClick={() => useNotes.getState().stopGenerating()}
          className="rounded-full px-3 py-1 font-medium text-latte-deep hover:bg-parchment/70 hover:text-ink pointer-coarse:py-2"
        >
          Stop
        </button>
      </div>
    );
  }
  if (recall.on) {
    return (
      <div className="glass card-in pointer-events-auto flex items-center gap-3 rounded-full py-1.5 pl-4 pr-1.5 text-ui text-ink shadow-card-hover">
        <span>{tally.total ? <span className="tabular">Remembered {tally.got} of {tally.total}</span> : "Click a hidden line, recall it, then reveal"}</span>
        <button type="button" onClick={() => useNotes.getState().setRecall(false)} className="rounded-full bg-paper px-3 py-1 font-medium ring-1 ring-latte-line/50 hover:bg-parchment/60">
          Done
        </button>
      </div>
    );
  }
  if (!drafts) return null;
  return (
    <div className="glass card-in pointer-events-auto flex items-center gap-1 rounded-full py-1.5 pl-4 pr-1.5 text-ui text-ink shadow-card-hover">
      <span className="mr-1.5 whitespace-nowrap">
        AI draft · <span className="tabular">{drafts}</span>
      </span>
      <button
        type="button"
        onClick={() => useNotes.getState().keepDrafts()}
        className={clsx(
          "whitespace-nowrap rounded-full px-3 py-1 font-medium transition-colors pointer-coarse:py-2",
          draftSelected ? "bg-paprika-ghost text-paprika hover:bg-paprika/15" : "bg-paprika text-white hover:bg-paprika-soft",
        )}
      >
        Keep all
      </button>
      <Tip label="Discard what you haven't touched and draft again" side="top">
        <button type="button" onClick={redraft} className="whitespace-nowrap rounded-full px-3 py-1 font-medium text-latte-deep hover:bg-parchment/70 hover:text-ink pointer-coarse:py-2">
          Redraft
        </button>
      </Tip>
      <Tip label="Everything you edited, added to or kept stays" side="top">
        <button
          type="button"
          onClick={() => {
            useNotes.getState().discardDrafts();
            useNotes.getState().notify("Draft discarded");
          }}
          className="whitespace-nowrap rounded-full px-3 py-1 font-medium text-latte-deep hover:bg-parchment/70 hover:text-ink pointer-coarse:py-2"
        >
          Discard all
        </button>
      </Tip>
    </div>
  );
}
