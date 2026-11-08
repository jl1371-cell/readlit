"use client";
import clsx from "clsx";
import { ChevronRight, Sparkles } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type MapDoc, type MapNode, primaryText, secondaryText, useMapDisplay, useNotes } from "@/lib/store/notes";
import { useReader } from "@/lib/store/reader";
import { branchColor, rgba } from "./layout";
import { keepPassage, passageDrag, usePassageOver } from "./actions";
import { GrowHandle, NodeContextMenu, NodeToolbar, nodeActions } from "./NodeActions";
import { NotesEmpty } from "./NotesEmpty";

interface Row {
  n: MapNode;
  depth: number;
  branch: number;
}

function rows(doc: MapDoc): Row[] {
  const out: Row[] = [];
  const walk = (id: string, depth: number, branch: number) => {
    const n = doc.nodes[id];
    if (!n) return;
    out.push({ n, depth, branch });
    if (n.collapsed) return;
    n.children.forEach((c, i) => walk(c, depth + 1, depth === 0 ? i : branch));
  };
  walk(doc.rootId, 0, 0);
  return out;
}

/** The same tree as the map, as a document: write freely, indent with Tab, add notes under any line. */
export function OutlineView() {
  const doc = useNotes((s) => s.doc);
  const editing = useNotes((s) => s.editing);
  const selected = useNotes((s) => s.selected);
  const generating = useNotes((s) => !!s.generating);
  // The line a dragged passage would go under ("" = none: it would go to the excerpts).
  const [dropOn, setDropOn] = useState<string | null>(null);
  if (!doc) return null;
  const list = rows(doc);
  const empty = doc.nodes[doc.rootId].children.length === 0;
  const addLine = () => {
    const id = useNotes.getState().addChild(doc.rootId, { kind: "topic" }, true);
    if (id) useNotes.getState().select([id]);
  };
  return (
    <div
      className="quiet-scroll h-full overflow-y-auto px-5 pb-24 pt-5"
      data-keyscope="outline"
      onDragOver={(e) => {
        if (!passageDrag.sel) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (!usePassageOver.getState().over) usePassageOver.setState({ over: true });
        const id = (e.target as HTMLElement).closest("[data-row-id]")?.getAttribute("data-row-id") ?? "";
        if (id !== dropOn) setDropOn(id);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as HTMLElement | null)) return;
        usePassageOver.setState({ over: false });
        setDropOn(null);
      }}
      onDrop={(e) => {
        const sel = passageDrag.sel;
        if (!sel) return;
        e.preventDefault();
        passageDrag.sel = null;
        usePassageOver.setState({ over: false });
        setDropOn(null);
        keepPassage(sel, dropOn || null);
        window.getSelection()?.removeAllRanges();
      }}
    >
      {list.map((r) => (
        <OutlineRow
          key={r.n.id}
          row={r}
          editing={editing?.id === r.n.id}
          selected={selected.includes(r.n.id)}
          only={selected.length === 1}
          dropping={dropOn === r.n.id}
        />
      ))}
      {empty && !generating ? (
        <div className="mt-2 flex justify-center">
          <NotesEmpty />
        </div>
      ) : (
        !empty && (
          <button type="button" onClick={addLine} className="mt-3 rounded-full px-2.5 py-1 text-ui text-latte hover:bg-parchment/60 hover:text-ink pointer-coarse:py-2.5">
            + Add a line
          </button>
        )
      )}
    </div>
  );
}

function OutlineRow({ row, editing, selected, only, dropping }: { row: Row; editing: boolean; selected: boolean; only: boolean; dropping: boolean }) {
  const { n, depth, branch } = row;
  const c = branchColor(depth, branch);
  const display = useMapDisplay();
  const line1 = primaryText(n, display);
  const line2 = secondaryText(n, display);
  const jumpTo = useReader((s) => s.jumpTo);
  const [noteOpen, setNoteOpen] = useState(false);
  const isRoot = depth === 0;
  return (
    <NodeContextMenu n={n} surface="outline">
    <div className={clsx("group/row relative", isRoot ? "mb-3" : "py-[3px]")} style={{ paddingLeft: Math.max(0, depth - 1) * 24 }} data-row-id={n.id}>
      <div
        className={clsx(
          "relative flex items-start gap-2 rounded-lg px-1.5 py-1 transition-shadow",
          // A draft is marked once, by a dashed rule beside it, as on the map.
          n.draft && !isRoot && "rounded-l-none border-l-[1.5px] border-dashed border-latte-line",
          selected && !editing && "bg-champagne-tint/70",
          dropping && "bg-paprika-ghost ring-2 ring-paprika/45",
        )}
        onClick={() => useNotes.getState().select([n.id], true)}
      >
        {/* "+" just under the line, where the next line will appear (under the title: the first line). */}
        {selected && only && !editing && (
          <div className="absolute -bottom-3 left-0 z-20 pointer-coarse:-bottom-5">
            <GrowHandle label={isRoot ? "Add a line" : "Add after"} keys="Enter" side="left" onClick={() => nodeActions.addAfter(n)} />
          </div>
        )}
        {!isRoot && (
          <button
            type="button"
            aria-label={n.collapsed ? "Unfold" : "Fold"}
            onClick={(e) => {
              e.stopPropagation();
              useNotes.getState().toggleCollapse(n.id);
            }}
            className={clsx("mt-[6px] flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full transition-transform", !n.children.length && "pointer-events-none")}
          >
            {n.children.length ? (
              <ChevronRight className={clsx("h-3.5 w-3.5 text-latte transition-transform", !n.collapsed && "rotate-90")} />
            ) : (
              <span className="h-[6px] w-[6px] rounded-full" style={{ background: rgba(c, depth === 1 ? 0.95 : 0.6) }} />
            )}
          </button>
        )}
        <div className="min-w-0 flex-1">
          {editing ? (
            <RowEditor n={n} depth={depth} />
          ) : (
            <div
              className={clsx(
                "cursor-text",
                isRoot ? "font-display text-title font-semibold text-ink" : depth === 1 ? "font-display text-heading font-medium" : "text-body text-ink",
                n.draft && "opacity-80",
              )}
              style={depth === 1 ? { color: c.deep } : undefined}
              onDoubleClick={() => useNotes.getState().startEdit(n.id, "append")}
              onClick={(e) => {
                e.stopPropagation();
                if (useNotes.getState().selected.includes(n.id)) useNotes.getState().startEdit(n.id, "append");
                else useNotes.getState().select([n.id], true);
              }}
            >
              {n.role && depth === 1 && (
                <span className="mr-2 inline-block translate-y-[-2px] align-middle font-sans text-caption font-medium not-italic" style={{ color: c.deep, opacity: 0.8 }}>
                  {n.role.t}
                </span>
              )}
              {line1 || <span className="text-latte">Untitled</span>}
              {n.sources[0] && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    jumpTo(n.sources[0].page, n.sources[0].sids, { remember: true });
                  }}
                  onPointerEnter={(e) => e.pointerType === "mouse" && useReader.getState().pointAt(n.sources[0].page, n.sources[0].sids)}
                  onPointerLeave={() => useReader.getState().pointAt(null)}
                  title={n.author === "ai" ? `Written by AI from page ${n.sources[0].page}` : `Show on page ${n.sources[0].page}`}
                  className="chip ml-1.5 translate-y-[-2px] align-middle font-sans not-italic hover:text-paprika"
                >
                  {n.author === "ai" && !n.draft && <Sparkles className="mr-[3px] h-2.5 w-2.5 text-latte/80" strokeWidth={2} aria-hidden />}
                  p.{n.sources[0].page}
                </button>
              )}
            </div>
          )}
          {line2 && !editing && (
            <div lang={isRoot ? undefined : "en"} className={clsx("mt-0.5 text-latte", isRoot ? "text-ui" : "text-label")}>
              {line2}
            </div>
          )}
          {(n.note || noteOpen) && <NoteEditor key={n.note ?? ""} n={n} autoFocus={noteOpen && !n.note} onDone={() => setNoteOpen(false)} />}
          {/*
            A document's actions go on a line of their own under the selected line, so they never cover a word. The same
            actions as the map's bar, in the same order; "Add a note" joins them. Nothing appears on hover alone.
          */}
          {selected && only && !editing && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-1" onClick={(e) => e.stopPropagation()}>
              <NodeToolbar n={n} surface="outline" variant="inline" />
              {!n.note && !noteOpen && !isRoot && (
                <button
                  type="button"
                  onClick={() => setNoteOpen(true)}
                  className="inline-flex h-8 items-center rounded-full px-2.5 text-ui text-latte-deep transition-colors hover:bg-parchment/70 hover:text-ink pointer-coarse:h-11"
                >
                  Add a note
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
    </NodeContextMenu>
  );
}

function RowEditor({ n, depth }: { n: MapNode; depth: number }) {
  const isRoot = depth === 0;
  const editing = useNotes((s) => s.editing);
  const display = useMapDisplay();
  const [value, setValue] = useState(editing?.mode === "replace" ? (editing.initial ?? "") : primaryText(n, display));
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  useEffect(() => {
    ref.current?.focus();
    const len = ref.current?.value.length ?? 0;
    ref.current?.setSelectionRange(len, len);
  }, []);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    useNotes.getState().stopEdit(value);
  };
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      aria-label="Line text"
      placeholder={isRoot ? "Title" : "Write a line"}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        const st = useNotes.getState();
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          commit();
          setTimeout(() => (isRoot ? st.addChild(n.id, { kind: "topic" }) : st.addSibling(n.id)), 0);
        } else if (e.key === "Tab") {
          e.preventDefault();
          commit();
          setTimeout(() => {
            const d = useNotes.getState().doc!;
            const node = d.nodes[n.id];
            if (!node?.parentId) return;
            if (e.shiftKey) st.outdent(n.id);
            else {
              // Indent: become the last child of the line above.
              const sibs = d.nodes[node.parentId].children;
              const prev = sibs[sibs.indexOf(n.id) - 1];
              if (prev) st.move(n.id, prev, d.nodes[prev].children.length);
            }
            st.startEdit(n.id, "append");
          }, 0);
        } else if (e.key === "Backspace" && !value && !isRoot) {
          e.preventDefault();
          done.current = true;
          st.stopEdit(undefined);
          st.remove([n.id]);
        } else if (e.key === "Escape") {
          e.preventDefault();
          commit();
        }
      }}
      className={clsx(
        "block w-full resize-none overflow-hidden bg-transparent outline-none placeholder:text-latte/70",
        isRoot ? "font-display text-title font-semibold" : depth === 1 ? "font-display text-heading font-medium" : "text-body text-ink",
      )}
    />
  );
}

function NoteEditor({ n, autoFocus, onDone }: { n: MapNode; autoFocus: boolean; onDone: () => void }) {
  const [value, setValue] = useState(n.note ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      placeholder="Write a note…"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        useNotes.getState().setNote(n.id, value.trim());
        onDone();
      }}
      className="mt-1 block w-full resize-none overflow-hidden rounded-lg bg-canvas/50 px-2.5 py-1.5 text-body-sm text-ink-soft outline-none placeholder:text-latte/70 focus:bg-canvas"
    />
  );
}
