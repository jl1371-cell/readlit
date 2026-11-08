"use client";
/**
 * What can be done to one node, in one place, for the pointer and for touch.
 *
 * Selecting a node (a branch of the map, a line of the outline) shows a small toolbar right above it: add, edit, AI,
 * delete, and "more". Right-clicking shows the same actions as a menu. Keys do the same things faster, and every
 * tooltip names its key, so the keys are learned along the way instead of being required.
 */
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import clsx from "clsx";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, MoreHorizontal, Plus, Sparkles, X } from "lucide-react";
import type { ReactNode } from "react";
import { Tip } from "@/components/ui/primitives";
import { useChat } from "@/lib/store/chat";
import { type MapNode, mapDisplay, pathOf, primaryText, useNotes } from "@/lib/store/notes";
import { useReader } from "@/lib/store/reader";
import { useUi } from "@/lib/store/ui";

export type Surface = "map" | "outline";

interface Action {
  key: string;
  label: string;
  hint?: string;
  keys?: string;
  danger?: boolean;
  disabled?: boolean;
  run: () => void;
}

const st = () => useNotes.getState();

/** Labels from the root to the node, as the reader sees them. */
function labelsOf(id: string): string[] {
  const d = st().doc;
  if (!d) return [];
  return pathOf(d, id).map((x) => (x.kind === "root" ? x.s || x.t : primaryText(x, mapDisplay())));
}

function short(s: string, n = 28): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trim()}…` : t;
}

/** Give the keys back to the map after a pointer action, so the accelerators keep working. */
function refocus(surface: Surface) {
  if (surface !== "map") return;
  setTimeout(() => document.querySelector<HTMLElement>("[data-keyscope='map']")?.focus({ preventScroll: true }), 0);
}

export const nodeActions = {
  /** A child: on the map to the right, in the outline indented under it. */
  addInside(n: MapNode) {
    st().addChild(n.id, n.kind === "root" ? { kind: "topic" } : undefined);
  },
  /** The next one at the same level: on the map below it, in the outline the next line. */
  addAfter(n: MapNode) {
    if (n.kind === "root") st().addChild(n.id, { kind: "topic" });
    else st().addSibling(n.id);
  },
  edit(n: MapNode) {
    st().startEdit(n.id, "append");
  },
  remove(n: MapNode) {
    const label = short(primaryText(n, mapDisplay()));
    st().remove([n.id]);
    st().notify(label ? `Deleted “${label}”` : "Deleted");
  },
  discard(n: MapNode) {
    st().discardDrafts(n.id);
    st().notify("Draft discarded");
  },
  keep(n: MapNode) {
    st().keepDrafts(n.id);
  },
  expand(n: MapNode, style: "statements" | "questions") {
    void st().expand(n.id, style);
  },
  /** An excerpt is a passage: its own points, each tied to its sentence, become a draft branch under it. */
  breakDown(n: MapNode) {
    void st().expand(n.id, "statements", "Split this passage into its 2 to 5 separate points, each short and tied to the sentence it comes from.");
  },
  /** An explanation is something to read, so it goes to the AI column; the node travels with it as context. */
  explain(n: MapNode) {
    const path = labelsOf(n.id);
    if (!useUi.getState().aiOpen) useUi.getState().set({ aiOpen: true });
    void useChat.getState().send({
      action: "ask",
      text: `Explain “${path.at(-1)}” as this paper uses it.`,
      nodes: [{ id: n.id, path, sids: n.sources.flatMap((s) => s.sids) }],
    });
  },
  /** Put the node above the composer, with a question to start from, and let the reader write theirs. */
  ask(n: MapNode) {
    const path = labelsOf(n.id);
    if (!useUi.getState().aiOpen) useUi.getState().set({ aiOpen: true });
    const chat = useChat.getState();
    chat.setNodes(n.kind === "root" ? [] : [{ id: n.id, path, sids: n.sources.flatMap((s) => s.sids) }]);
    chat.setDraft(n.kind === "root" ? "" : `What role does “${path.at(-1)}” play in ${path.length > 2 ? `“${path.at(-2)}”` : "this paper"}?`);
    chat.focusComposer();
  },
  showSource(n: MapNode) {
    const s = n.sources[0];
    if (s) useReader.getState().jumpTo(s.page, s.sids, { remember: true });
  },
};

/** The AI's one-tap action for a node: grow a branch; break a kept passage into its points. */
function primaryAi(n: MapNode, busy: boolean, ready: boolean): Action {
  const off = busy || !ready;
  return n.kind === "excerpt"
    ? { key: "break", label: "Break it down", hint: "Its separate points, as a draft", disabled: off, run: () => nodeActions.breakDown(n) }
    : { key: "expand", label: "Expand with AI", hint: "The paper's next ideas under it, as a draft", disabled: off, run: () => nodeActions.expand(n, "statements") };
}

/** The AI's other offers for one node. */
function otherAi(n: MapNode, busy: boolean, ready: boolean): Action[] {
  const root = n.kind === "root";
  return [
    { key: "questions", label: "Questions about it", hint: "What the paper answers here, as a draft", disabled: busy || !ready, run: () => nodeActions.expand(n, "questions") },
    ...(!root ? [{ key: "explain", label: "Explain it", hint: "In the AI column, with its sources", disabled: !ready, run: () => nodeActions.explain(n) }] : []),
    { key: "ask", label: "Ask about it…", hint: "Write your own question", disabled: !ready, run: () => nodeActions.ask(n) },
  ];
}

/** How many nodes go with this one if it is deleted. */
function below(id: string): number {
  const d = st().doc;
  if (!d) return 0;
  let k = 0;
  const walk = (x: string) => {
    for (const c of d.nodes[x]?.children ?? []) {
      k++;
      walk(c);
    }
  };
  walk(id);
  return k;
}

/** Growing the tree: the same verbs in both views. "Inside" is a child; "after" is the next one at the same level. */
function growActions(n: MapNode, surface: Surface): Action[] {
  const root = n.kind === "root";
  return [
    { key: "inside", label: "Add inside", keys: surface === "map" ? "Tab" : undefined, run: () => nodeActions.addInside(n) },
    ...(!root ? [{ key: "after", label: "Add after", keys: "Enter", run: () => nodeActions.addAfter(n) }] : []),
  ];
}

/** Moving without dragging (for touch, and for precision). */
function moveActions(n: MapNode): Action[] {
  const d = st().doc;
  if (!d || n.kind === "root") return [];
  const parent = n.parentId ? d.nodes[n.parentId] : null;
  const index = parent ? parent.children.indexOf(n.id) : -1;
  const last = parent ? parent.children.length - 1 : -1;
  return [
    { key: "up", label: "Move up", disabled: index < 1, run: () => st().reorder(n.id, -1) },
    { key: "down", label: "Move down", disabled: index < 0 || index >= last, run: () => st().reorder(n.id, 1) },
    { key: "in", label: "Move in", hint: "Inside the one above it", disabled: index < 1, run: () => st().indent(n.id) },
    { key: "out", label: "Move out", hint: "Up one level", disabled: !parent?.parentId, run: () => st().outdent(n.id) },
  ];
}

/** Seeing it differently. */
function viewActions(n: MapNode): Action[] {
  const out: Action[] = [];
  if (n.children.length) out.push({ key: "fold", label: n.collapsed ? "Unfold" : `Fold`, hint: n.collapsed ? undefined : `Hide the ${below(n.id)} below it`, keys: "⌘ /", run: () => st().toggleCollapse(n.id) });
  if (n.sources[0]) out.push({ key: "source", label: "Show in the paper", hint: `Page ${n.sources[0].page}`, run: () => nodeActions.showSource(n) });
  if (n.kind !== "root") out.push({ key: "translate", label: "Translate", hint: "Add the other language underneath", run: () => void st().translateNode(n.id) });
  return out;
}

/** Removing it, saying how much goes; Undo follows, so there is no "Are you sure?". */
function removeAction(n: MapNode): Action | null {
  if (n.kind === "root") return null;
  if (n.draft) return { key: "discard", label: "Discard this branch", hint: "Only what nobody has touched", danger: true, run: () => nodeActions.discard(n) };
  const k = below(n.id);
  return { key: "delete", label: k ? "Delete branch" : "Delete", hint: k ? `With the ${k} below it` : undefined, keys: "⌫", danger: true, run: () => nodeActions.remove(n) };
}

const BTN =
  "inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-full text-latte-deep transition-colors duration-150 hover:bg-parchment/70 hover:text-ink disabled:pointer-events-none disabled:opacity-40 pointer-coarse:h-11 pointer-coarse:min-w-11 data-[state=open]:bg-parchment/70 data-[state=open]:text-ink";
const MENU = "card-in z-[90] min-w-[15rem] rounded-2xl border border-latte-line/40 bg-paper p-1.5 shadow-card-hover";

function MenuItems({ actions, Item }: { actions: Action[]; Item: typeof Dropdown.Item | typeof ContextMenu.Item }) {
  return (
    <>
      {actions.map((a) => (
        <Item
          key={a.key}
          disabled={a.disabled}
          onSelect={a.run}
          className={clsx(
            "flex cursor-default items-start justify-between gap-5 rounded-xl px-2.5 py-[7px] outline-none data-[disabled]:opacity-45 data-[highlighted]:bg-canvas pointer-coarse:py-2.5",
            a.danger ? "text-paprika" : "text-ink",
          )}
        >
          <span className="flex min-w-0 flex-col">
            <span className="text-ui font-medium">{a.label}</span>
            {a.hint && <span className={clsx("text-label", a.danger ? "text-paprika/75" : "text-latte")}>{a.hint}</span>}
          </span>
          {a.keys && <span className="mt-[2px] shrink-0 text-caption text-latte">{a.keys}</span>}
        </Item>
      ))}
    </>
  );
}

/** The groups of the full menu, in order; empty groups are left out, with their separators. */
function groups(n: MapNode, surface: Surface, busy: boolean, ready: boolean, withPrimary: boolean): Action[][] {
  const edit: Action = { key: "edit", label: "Edit", hint: "Or click it again", keys: surface === "map" ? "Space" : undefined, run: () => nodeActions.edit(n) };
  const first: Action[] = [...(withPrimary && n.draft ? [{ key: "keep", label: "Keep this branch", run: () => nodeActions.keep(n) }] : []), edit];
  const ai = withPrimary ? [primaryAi(n, busy, ready), ...otherAi(n, busy, ready)] : otherAi(n, busy, ready);
  const remove = removeAction(n);
  return [first, ai, growActions(n, surface), viewActions(n), remove ? [remove] : []].filter((g) => g.length);
}

/**
 * "Move": up, down, in, out as one row of small buttons, so the menu stays short and the menu stays open while
 * the reader taps up, up, up. On the map "in" is to the right (inside the one above), "out" to the left.
 */
function MoveRow({ n }: { n: MapNode }) {
  const actions = moveActions(n);
  if (!actions.length) return null;
  const icon: Record<string, ReactNode> = {
    up: <ArrowUp className="h-3.5 w-3.5" />,
    down: <ArrowDown className="h-3.5 w-3.5" />,
    in: <ArrowRight className="h-3.5 w-3.5" />,
    out: <ArrowLeft className="h-3.5 w-3.5" />,
  };
  return (
    <div role="group" aria-label="Move" className="flex items-center justify-between gap-4 px-2.5 py-1">
      <span className="text-ui font-medium text-ink">Move</span>
      <span className="flex gap-0.5">
        {actions.map((a) => (
          <Tip key={a.key} label={a.hint ? `${a.label}: ${a.hint.toLowerCase()}` : a.label} side="top">
            <button
              type="button"
              aria-label={a.label}
              disabled={a.disabled}
              onClick={a.run}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-latte-deep hover:bg-canvas hover:text-ink disabled:pointer-events-none disabled:opacity-35 pointer-coarse:h-11 pointer-coarse:w-11"
            >
              {icon[a.key]}
            </button>
          </Tip>
        ))}
      </span>
    </div>
  );
}

function ToolButton({ label, keys, onClick, children, className, side, disabled }: { label: string; keys?: string; onClick: () => void; children: ReactNode; className?: string; side?: "top" | "bottom"; disabled?: boolean }) {
  return (
    <Tip label={label} keys={keys} side={side ?? "top"}>
      <button type="button" aria-label={label} onClick={onClick} disabled={disabled} className={clsx(BTN, className)}>
        {children}
      </button>
    </Tip>
  );
}

/**
 * The bar above a selected node: at most three things, so it stays calm. An AI draft offers Keep and Discard first;
 * then the AI's one-tap action, and everything else under "more". Adding is done with the "+" on the node's edges.
 */
export function NodeToolbar({ n, surface, tipSide, variant = "float" }: { n: MapNode; surface: Surface; tipSide?: "top" | "bottom"; variant?: "float" | "inline" }) {
  const busy = useNotes((s) => !!s.generating);
  const ready = useReader((s) => s.textPages > 0);
  const done = (fn: () => void) => () => {
    fn();
    refocus(surface);
  };
  const ai = primaryAi(n, busy, ready);
  return (
    <div
      role="toolbar"
      aria-label="Node actions"
      className={clsx(
        "nodrag nopan nowheel flex items-center gap-[2px]",
        // On the map it floats beside the node; in the outline it is a line of the document, under the selected line.
        variant === "float" ? "card-in rounded-full border border-latte-line/45 bg-paper/95 p-[3px] shadow-card-hover backdrop-blur-md" : "-ml-1.5",
      )}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {n.draft && (
        <>
          <ToolButton label="Keep this branch" onClick={done(() => nodeActions.keep(n))} side={tipSide} className="px-2.5 text-ui font-medium text-sage-text hover:bg-sage/25 hover:text-sage-text">
            <Check className="h-4 w-4" strokeWidth={2.2} />
            Keep
          </ToolButton>
          <ToolButton label="Discard this branch" onClick={done(() => nodeActions.discard(n))} side={tipSide} className="px-2.5 text-ui font-medium">
            <X className="h-4 w-4" strokeWidth={2.2} />
            Discard
          </ToolButton>
          <span className="mx-1 h-4 w-px bg-latte-line/45" aria-hidden />
        </>
      )}
      <ToolButton label={ai.label} onClick={done(ai.run)} disabled={ai.disabled} side={tipSide} className="px-2.5 text-ui font-medium text-ink">
        <Sparkles className="h-4 w-4 text-paprika" strokeWidth={1.9} />
        {n.kind === "excerpt" ? "Break down" : "Expand"}
      </ToolButton>
      <MoreMenu n={n} surface={surface} side={tipSide} busy={busy} ready={ready} />
    </div>
  );
}

/** A "+" on a node's edge, where the new node will appear. */
export function GrowHandle({ label, keys, onClick, side, className, style }: { label: string; keys?: string; onClick: () => void; side?: "top" | "bottom" | "left" | "right"; className?: string; style?: React.CSSProperties }) {
  return (
    <Tip label={label} keys={keys} side={side ?? "right"}>
      <button
        type="button"
        aria-label={label}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className={clsx(
          "nodrag flex h-6 w-6 items-center justify-center rounded-full border border-latte-line/60 bg-paper text-latte-deep shadow-card transition-colors duration-150 hover:border-paprika hover:bg-paprika hover:text-white pointer-coarse:h-11 pointer-coarse:w-11",
          className,
        )}
        style={style}
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
      </button>
    </Tip>
  );
}

function MoreMenu({ n, surface, side, busy, ready }: { n: MapNode; surface: Surface; side?: "top" | "bottom"; busy: boolean; ready: boolean }) {
  // Built when opened, so it reflects the tree as it is now.
  return (
    <Dropdown.Root modal={false}>
      <Tip label="More" side={side ?? "top"}>
        <Dropdown.Trigger asChild>
          <button type="button" aria-label="More" className={BTN}>
            <MoreHorizontal className="h-[16px] w-[16px]" />
          </button>
        </Dropdown.Trigger>
      </Tip>
      <Dropdown.Portal>
        <Dropdown.Content side="bottom" align="end" sideOffset={8} collisionPadding={12} className={clsx(MENU, "max-h-[min(560px,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto")} onCloseAutoFocus={(e) => e.preventDefault()}>
          {groups(n, surface, busy, ready, false).map((g, i) => (
            <div key={i}>
              {i > 0 && <Dropdown.Separator className="my-1 h-px bg-latte-line/30" />}
              <MenuItems actions={g} Item={Dropdown.Item} />
              {g[0]?.key === "inside" && <MoveRow n={n} />}
            </div>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

/** Right-click (or long-press) on a node: the bar's actions and everything under "more", in one menu. */
export function NodeContextMenu({ n, surface, children }: { n: MapNode; surface: Surface; children: ReactNode }) {
  const busy = useNotes((s) => !!s.generating);
  const ready = useReader((s) => s.textPages > 0);
  return (
    <ContextMenu.Root onOpenChange={(open) => open && st().select([n.id], true)}>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content collisionPadding={12} className={clsx(MENU, "max-h-[min(600px,var(--radix-context-menu-content-available-height))] overflow-y-auto")}>
          {groups(n, surface, busy, ready, true).map((g, i) => (
            <div key={i}>
              {i > 0 && <ContextMenu.Separator className="my-1 h-px bg-latte-line/30" />}
              <MenuItems actions={g} Item={ContextMenu.Item} />
              {g[0]?.key === "inside" && <MoveRow n={n} />}
            </div>
          ))}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
