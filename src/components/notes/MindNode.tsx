"use client";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import clsx from "clsx";
import { CircleHelp, MessageSquareText, Quote, Sparkles, StickyNote } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type MapNode, primaryText, secondaryText, useMapDisplay, useNotes } from "@/lib/store/notes";
import { useReader } from "@/lib/store/reader";
import { beadBackground, beadShadow, branchColor, rgba } from "./layout";
import { NodeContextMenu } from "./NodeActions";

export type Drop = "child" | "before" | "after";
export type MindFlowNode = Node<{ depth: number; branch: number; drop: Drop | null; draftTop: boolean }, "mind">;

/** When the last drag ended: the click that ends a drag must not count as a click on the node. */
export const mapGesture = { lastDragEnd: 0 };

function Sources({ n }: { n: MapNode }) {
  const jumpTo = useReader((s) => s.jumpTo);
  if (!n.sources.length) return null;
  const first = n.sources[0];
  const more = n.sources.length - 1;
  return (
    <button
      type="button"
      className="chip nodrag ml-1.5 translate-y-[-2px] bg-paper/80 align-middle font-sans not-italic transition-colors first:ml-0 hover:bg-champagne-tint hover:text-paprika"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerEnter={(e) => e.pointerType === "mouse" && useReader.getState().pointAt(first.page, first.sids)}
      onPointerLeave={() => useReader.getState().pointAt(null)}
      onClick={(e) => {
        e.stopPropagation();
        jumpTo(first.page, first.sids, { remember: true });
      }}
      title={`${n.author === "ai" ? "Written by AI from " : "Show on "}page ${first.page}${more ? ` and ${more} more` : ""}`}
    >
      {/* A quiet mark that AI wrote this; it goes once the reader rewrites the node. */}
      {n.author === "ai" && !n.draft && <Sparkles className="mr-[3px] h-2.5 w-2.5 text-latte/80" strokeWidth={2} aria-hidden />}
      p.{first.page}
      {more > 0 && <span className="ml-0.5 text-latte">+{more}</span>}
    </button>
  );
}

function KindMark({ n, color }: { n: MapNode; color: string }) {
  const cls = "mr-1 inline-block h-[15px] w-[15px] translate-y-[-2px] align-middle";
  if (n.kind === "question") return <CircleHelp className={cls} style={{ color }} strokeWidth={2.1} />;
  if (n.kind === "excerpt") return <Quote className={cls} style={{ color: "#C9A86A" }} strokeWidth={2.1} />;
  if (n.kind === "answer") return <MessageSquareText className={cls} style={{ color }} strokeWidth={2.1} />;
  return null;
}

function Editor({ n, initial, mode, className, style }: { n: MapNode; initial?: string; mode: "replace" | "append"; className: string; style?: React.CSSProperties }) {
  const display = useMapDisplay();
  const [value, setValue] = useState(mode === "replace" ? (initial ?? "") : primaryText(n, display));
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  // A new node is hidden until React Flow has measured it, and hidden fields can't take focus: keep trying briefly.
  useEffect(() => {
    let tries = 0;
    let timer = 0;
    const go = () => {
      const el = ref.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      if (document.activeElement !== el && tries++ < 30) timer = window.setTimeout(go, 16);
      else el.setSelectionRange(el.value.length, el.value.length);
    };
    go();
    return () => clearTimeout(timer);
  }, []);
  const finish = (text: string | undefined) => {
    if (done.current) return;
    done.current = true;
    useNotes.getState().stopEdit(text);
    // Give the keyboard back to the map.
    setTimeout(() => document.querySelector<HTMLElement>("[data-keyscope='map']")?.focus({ preventScroll: true }), 0);
  };
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      aria-label="Node text"
      placeholder="New idea"
      className={clsx("nodrag nowheel block w-full resize-none overflow-hidden bg-transparent outline-none placeholder:text-latte/70", className)}
      style={{ minWidth: 72, ...style }}
      onChange={(e) => setValue(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      // Clicking inside the text moves the caret; it must not reach the node and end the edit.
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === "Escape") {
          e.preventDefault();
          finish(mode === "replace" && !primaryText(n, display) ? undefined : primaryText(n, display) || undefined);
        } else if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          finish(value);
        } else if (e.key === "Tab") {
          e.preventDefault();
          finish(value);
          if (value.trim()) setTimeout(() => (e.shiftKey ? useNotes.getState().outdent(n.id) : useNotes.getState().addChild(n.id)), 0);
        }
      }}
    />
  );
}

function RecallMask({ n, text }: { n: MapNode; text: string }) {
  const state = useNotes((s) => s.recall.revealed[n.id]);
  const reveal = useNotes((s) => s.reveal);
  const jumpTo = useReader((s) => s.jumpTo);
  if (!state) {
    const w = Math.min(220, Math.max(56, text.length * 6.5));
    return (
      <button
        type="button"
        className="nodrag block py-0.5"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          reveal(n.id, "open");
        }}
        title="Try to recall it, then reveal"
      >
        <span className="block h-[12px] rounded-full bg-parchment/90" style={{ width: w }} />
        {text.length > 34 && <span className="mt-1.5 block h-[12px] rounded-full bg-parchment/70" style={{ width: w * 0.6 }} />}
      </button>
    );
  }
  if (state === "open") {
    return (
      <div className="nodrag" onPointerDown={(e) => e.stopPropagation()}>
        <div className="text-body text-ink">{text}</div>
        <div className="mt-1.5 flex gap-1">
          <button
            type="button"
            className="rounded-full bg-sage/30 px-2.5 py-0.5 text-label font-medium text-sage-text hover:bg-sage/45 pointer-coarse:py-2"
            onClick={(e) => {
              e.stopPropagation();
              reveal(n.id, "recalled");
            }}
          >
            Remembered
          </button>
          <button
            type="button"
            className="rounded-full bg-paprika-ghost px-2.5 py-0.5 text-label font-medium text-paprika hover:bg-paprika/15 pointer-coarse:py-2"
            onClick={(e) => {
              e.stopPropagation();
              reveal(n.id, "forgot");
              const s = n.sources[0];
              if (s) jumpTo(s.page, s.sids, { remember: true });
            }}
          >
            Not yet
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="text-body text-ink-soft">
      <span className={clsx("mr-1.5 inline-block h-1.5 w-1.5 translate-y-[-2px] rounded-full", state === "recalled" ? "bg-sage-deep" : "bg-paprika")} />
      {text}
    </div>
  );
}

function MindNodeImpl({ id, data }: NodeProps<MindFlowNode>) {
  const n = useNotes((s) => s.doc?.nodes[id]);
  const display = useMapDisplay();
  const selected = useNotes((s) => s.selected.includes(id));
  const editing = useNotes((s) => (s.editing?.id === id ? s.editing : null));
  const recallOn = useNotes((s) => s.recall.on);
  const busyHere = useNotes((s) => s.generating?.nodeId === id);
  if (!n) return null;
  const { depth, branch, drop } = data;
  const c = branchColor(depth, branch);
  const line1 = primaryText(n, display);
  const line2 = secondaryText(n, display);
  const hidden = n.collapsed ? n.children.length : 0;
  const masked = recallOn && depth >= 2;

  // Click selects; clicking the selected node again edits it (as renaming works in Finder). Tap works the same way.
  const select = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (performance.now() - mapGesture.lastDragEnd < 350) return;
    const st = useNotes.getState();
    if (st.editing?.id === id) return;
    if (e.shiftKey || e.metaKey) st.select(st.selected.includes(id) ? st.selected.filter((x) => x !== id) : [...st.selected, id], true);
    else if (st.selected.length === 1 && st.selected[0] === id && !masked) {
      st.startEdit(id, "append");
      return;
    } else st.select([id], true);
    document.querySelector<HTMLElement>("[data-keyscope='map']")?.focus({ preventScroll: true });
  };
  const edit = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!masked && useNotes.getState().editing?.id !== id) useNotes.getState().startEdit(id, "append");
  };

  const noteMark = n.note && n.kind !== "answer" && n.kind !== "excerpt" && (
    <TooltipPrimitive.Root delayDuration={200}>
      <TooltipPrimitive.Trigger asChild>
        <StickyNote className="ml-1 inline-block h-3 w-3 translate-y-[-1px] text-latte" />
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side="bottom" sideOffset={6} className="z-[80] max-w-[22rem] whitespace-pre-wrap rounded-xl border border-latte-line/40 bg-paper px-3 py-2 text-body-sm text-ink-soft shadow-card-hover">
          {n.note.length > 600 ? `${n.note.slice(0, 600)}…` : n.note}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );

  const collapsedBadge = hidden > 0 && (
    <button
      type="button"
      className="nodrag tabular absolute -right-3 top-1/2 flex h-[22px] min-w-[22px] -translate-y-1/2 translate-x-full items-center justify-center rounded-full bg-paper px-1 text-caption font-medium shadow-card transition-transform hover:scale-110 pointer-coarse:h-7 pointer-coarse:min-w-7"
      style={{ color: c.deep, boxShadow: `0 0 0 1.5px ${rgba(c, 0.55)}` }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        useNotes.getState().toggleCollapse(id, false);
        // Show what just opened, without losing the branch it hangs from.
        useNotes.getState().revealNodes([id, ...n.children]);
      }}
      title="Unfold"
      aria-label={`Unfold ${hidden} hidden`}
    >
      {hidden}
    </button>
  );

  const dropRing =
    drop === "child" ? (
      <div className="pointer-events-none absolute -inset-1.5 rounded-[16px] ring-2 ring-paprika/60" />
    ) : drop ? (
      <div className={clsx("pointer-events-none absolute -left-1 -right-1 h-[2.5px] rounded-full bg-paprika", drop === "before" ? "-top-[7px]" : "-bottom-[7px]")} />
    ) : null;

  // Root and main branches are beads; deeper ideas are light, underlined text, as in XMind's logic chart.
  if (depth <= 1) {
    const root = depth === 0;
    return (
      <NodeContextMenu n={n} surface="map">
      <div className={clsx("group/node relative", selected && !editing && !masked && "cursor-text")} onClick={select} onDoubleClick={edit}>
        <Handle type="target" position={Position.Left} className="!pointer-events-none !opacity-0" isConnectable={false} />
        <Handle type="source" position={Position.Right} className="!pointer-events-none !opacity-0" isConnectable={false} />
        {dropRing}
        <div
          className={clsx("relative rounded-[18px] transition-[box-shadow,opacity] duration-200", root ? "max-w-[22rem] px-5 py-3.5" : "max-w-[17rem] rounded-[14px] px-4 py-2.5", n.draft && "opacity-[0.86]")}
          style={{
            background: beadBackground(c, root ? "root" : "topic"),
            boxShadow: beadShadow(c, root ? "root" : "topic", selected),
            outline: n.draft ? `1.25px dashed ${rgba(c, 0.7)}` : undefined,
            outlineOffset: n.draft ? -1 : undefined,
          }}
        >
          {/* The part of the argument this branch stands for, as a quiet label above its statement. */}
          {n.role && !root && (
            <div className="mb-0.5 font-sans text-caption font-medium not-italic" style={{ color: c.deep, opacity: 0.78 }}>
              {n.role.t}
            </div>
          )}
          {editing ? (
            <Editor
              n={n}
              mode={editing.mode}
              initial={editing.initial}
              className={root ? "font-display text-title font-semibold" : "font-display text-heading font-medium italic"}
              style={{ color: c.deep, fontSynthesis: "none" }}
            />
          ) : (
            <div className={root ? "font-display text-title font-semibold" : "font-display text-heading font-medium italic"} style={{ color: c.deep, fontSynthesis: "none" }}>
              {line1 || <span className="font-sans not-italic text-latte">Untitled</span>}
              {!root && <Sources n={n} />}
              {noteMark}
            </div>
          )}
          {line2 && !editing && (
            <div lang={root ? undefined : "en"} title={line2} className={clsx("mt-0.5 line-clamp-2 font-sans", root ? "text-ui text-ink-soft" : "text-label text-latte")}>
              {line2}
            </div>
          )}
          {busyHere && <div className="tr-shimmer absolute inset-0 rounded-[inherit]" />}
        </div>
        {collapsedBadge}
      </div>
      </NodeContextMenu>
    );
  }

  return (
    <NodeContextMenu n={n} surface="map">
    <div className={clsx("group/node relative", selected && !editing && !masked && "cursor-text")} onClick={select} onDoubleClick={edit}>
      {/* Edges meet the underline, the way a logic chart draws them. */}
      <Handle type="target" position={Position.Left} className="!pointer-events-none !opacity-0" style={{ top: "100%" }} isConnectable={false} />
      <Handle type="source" position={Position.Right} className="!pointer-events-none !opacity-0" style={{ top: "100%" }} isConnectable={false} />
      {dropRing}
      <div
        className={clsx("relative max-w-[18em] rounded-[6px] px-1 pb-[5px] pt-[3px] text-body transition-[box-shadow,opacity] duration-200", n.draft && "opacity-[0.84]")}
        style={{
          boxShadow: selected ? "0 0 0 2px rgba(209, 75, 40, 0.38)" : undefined,
          background: selected ? "rgba(250, 246, 239, 0.9)" : undefined,
        }}
      >
        {masked ? (
          <RecallMask n={n} text={line1} />
        ) : editing ? (
          <Editor n={n} mode={editing.mode} initial={editing.initial} className="text-body text-ink" />
        ) : (
          n.kind === "excerpt" ? (
            // An excerpt keeps its full text; the map shows the start of it, the outline all of it.
            <div className="text-body text-ink-soft">
              <div className="line-clamp-3" title={line1}>
                <KindMark n={n} color={c.deep} />
                {line1}
              </div>
              <Sources n={n} />
            </div>
          ) : (
            <div className="text-body text-ink">
              <KindMark n={n} color={c.deep} />
              {line1 || <span className="text-latte">Untitled</span>}
              <Sources n={n} />
              {noteMark}
            </div>
          )
        )}
        {line2 && !editing && !masked && (
          <div lang="en" title={line2} className="mt-[1px] line-clamp-2 text-label text-latte">
            {line2}
          </div>
        )}
        {n.image && !masked && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={n.image} alt="" className="mt-1 max-h-[104px] max-w-[240px] rounded-md bg-white object-contain ring-1 ring-latte-line/30" />
        )}
        <div className="absolute inset-x-0 bottom-0 h-[1.5px] rounded-full" style={{ background: n.draft ? `repeating-linear-gradient(90deg, ${rgba(c, 0.7)} 0 5px, transparent 5px 9px)` : rgba(c, 0.55) }} />
        {busyHere && <div className="tr-shimmer absolute inset-0 rounded-[6px]" />}
      </div>
      {collapsedBadge}
    </div>
    </NodeContextMenu>
  );
}

export const MindNode = memo(MindNodeImpl);
