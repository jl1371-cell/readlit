"use client";
import {
  type Edge,
  type Node,
  type EdgeProps,
  type NodeChange,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useInternalNode,
  useReactFlow,
  useStore as useFlowStore,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type MapDoc, useNotes } from "@/lib/store/notes";
import { useUi } from "@/lib/store/ui";
import { type Placed, branchColor, layoutMap, rgba, visibleChildren } from "./layout";
import { type Drop, MindNode, type MindFlowNode, mapGesture } from "./MindNode";
import { GrowHandle, NodeToolbar } from "./NodeActions";
import { keepPassage, passageDrag, usePassageOver } from "./actions";

/**
 * The selected node's toolbar, over the map: centred above the node and kept inside the map's edges, below the node
 * when there is no room above, hidden while the node is off screen, being edited or dragged. It keeps its size at
 * any zoom.
 */
function SelectionToolbar() {
  const id = useNotes((s) => (s.selected.length === 1 ? s.selected[0] : null));
  const n = useNotes((s) => (id ? s.doc?.nodes[id] : undefined));
  const editing = useNotes((s) => !!s.editing);
  const recall = useNotes((s) => s.recall.on);
  const busyHere = useNotes((s) => !!id && s.generating?.nodeId === id);
  const internal = useInternalNode(id ?? "");
  const transform = useFlowStore((s) => s.transform);
  // The map's own size (React Flow fills the column).
  const W = useFlowStore((s) => s.width);
  const H = useFlowStore((s) => s.height);
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const shown = !!(id && n && internal && !editing && !recall && !busyHere && !internal.dragging);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
  }, [shown, id, n?.draft, n?.kind]);
  if (!shown || !n || !internal) return null;
  const [tx, ty, z] = transform;
  const nx = internal.internals.positionAbsolute.x * z + tx;
  const ny = internal.internals.positionAbsolute.y * z + ty;
  const nw = (internal.measured.width ?? 0) * z;
  const nh = (internal.measured.height ?? 0) * z;
  if (nx + nw < 0 || nx > W || ny + nh < 0 || ny > H) return null;
  // "+" where the new node will appear: right of it for a node inside, below it for the next one. Too small to aim
  // at when zoomed far out, so they wait until the map is readable; the "more" menu has the same actions.
  const handle = COARSE ? 44 : 24;
  const handles = z >= 0.6;
  const right = handles && !(n.collapsed && n.children.length);
  const under = handles && n.kind !== "root";
  const gap = 10;
  const above = ny - size.h - gap >= 8;
  const top = above ? ny - size.h - gap : Math.min(ny + nh + (under ? handle / 2 + 4 : 0) + gap, H - size.h - 8);
  const left = Math.min(Math.max(8, nx + nw / 2 - size.w / 2), W - size.w - 8);
  const st = useNotes.getState;
  return (
    <>
      <div ref={ref} className="absolute z-20" style={{ left, top, visibility: size.w ? "visible" : "hidden" }} data-export-hide="true">
        <NodeToolbar n={n} surface="map" tipSide={above ? "top" : "bottom"} />
      </div>
      {right && (
        <div className="card-in absolute z-20" style={{ left: nx + nw + 6, top: ny + nh / 2 - handle / 2 }} data-export-hide="true">
          <GrowHandle label="Add inside" keys="Tab" side="right" onClick={() => st().addChild(n.id, n.kind === "root" ? { kind: "topic" } : undefined)} />
        </div>
      )}
      {under && (
        // On the node's lower-left corner, where the next one will begin, so it covers no neighbour's words.
        <div className="card-in absolute z-20" style={{ left: nx - handle / 2, top: ny + nh - handle / 2 + 2 }} data-export-hide="true">
          <GrowHandle label="Add after" keys="Enter" side="bottom" onClick={() => st().addSibling(n.id)} />
        </div>
      )}
    </>
  );
}

/** Touch screens: a finger on a node pans the map instead of moving the node (moving is in the node's menu). */
const COARSE = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

type MindEdge = Edge<{ depth: number; branch: number; draft: boolean; active: boolean }, "branch">;

function BranchEdge({ sourceX, sourceY, targetX, targetY, data }: EdgeProps<MindEdge>) {
  const c = branchColor(data?.depth ?? 1, data?.branch ?? 0);
  const dx = Math.max(12, targetX - sourceX);
  const k = dx * 0.55;
  const d = `M ${sourceX} ${sourceY} C ${sourceX + k} ${sourceY}, ${targetX - k} ${targetY}, ${targetX} ${targetY}`;
  const width = (data?.depth ?? 1) <= 1 ? 2 : 1.5;
  return (
    <path
      d={d}
      fill="none"
      stroke={rgba(c, data?.active ? 0.95 : 0.58)}
      strokeWidth={data?.active ? width + 0.6 : width}
      strokeLinecap="round"
      strokeDasharray={data?.draft ? "4 4" : undefined}
      className={data?.draft ? undefined : "mind-edge"}
      pathLength={data?.draft ? undefined : 1}
    />
  );
}

/** Lets the panel read the laid-out nodes (export) and move the view (the zoom menu in the header). */
export const mapApi: { getNodes: () => Node[]; frame: () => void; zoom: (by: 1 | -1) => void; zoomTo: (z: number) => void } = {
  getNodes: () => [],
  frame: () => {},
  zoom: () => {},
  zoomTo: () => {},
};

const nodeTypes = { mind: MindNode };
const edgeTypes = { branch: BranchEdge };
const FALLBACK = { w: 160, h: 30 };

/** Nodes in display order: depth first, the order a reader's eye moves through the map. */
function visibleOrder(doc: MapDoc): string[] {
  const out: string[] = [];
  const walk = (id: string) => {
    out.push(id);
    for (const c of visibleChildren(doc, id)) walk(c);
  };
  walk(doc.rootId);
  return out;
}

/** Room kept clear at the edges: above for the node toolbar, below for the draft bar and the undo note. */
const EDGE = { top: 60, bottom: 76, side: 28 };
/** Node text is 16px; below this zoom it would read smaller than 12px, the smallest text the app uses. */
const MIN_READABLE_ZOOM = 0.75;

/**
 * Move the view as little as possible so that the given nodes are all in view. The first node is the anchor: if
 * the group can't fit even at the smallest readable zoom, the view keeps the anchor and as much of the rest as fits.
 */
export function revealInView(flow: ReturnType<typeof useReactFlow>, placed: globalThis.Map<string, Placed>, ids: string[], el: HTMLElement | null) {
  const rects = ids.map((id) => placed.get(id)).filter((p): p is Placed => !!p);
  if (!el || !rects.length) return;
  const W = el.clientWidth;
  const H = el.clientHeight;
  if (W < 50 || H < 50) return;
  const anchor = rects[0];
  const bx0 = Math.min(...rects.map((r) => r.x));
  const by0 = Math.min(...rects.map((r) => r.y));
  const bx1 = Math.max(...rects.map((r) => r.x + r.w));
  const by1 = Math.max(...rects.map((r) => r.y + r.h));
  const vp = flow.getViewport();
  const roomW = W - EDGE.side * 2;
  const roomH = H - EDGE.top - EDGE.bottom;
  let zoom = vp.zoom;
  const fit = Math.min(roomW / Math.max(1, bx1 - bx0), roomH / Math.max(1, by1 - by0));
  if (fit < zoom) zoom = Math.max(MIN_READABLE_ZOOM, fit);
  // Changing zoom keeps the centre of the view where it is; then shift by the least amount.
  let x = vp.x;
  let y = vp.y;
  if (zoom !== vp.zoom) {
    const cx = (W / 2 - vp.x) / vp.zoom;
    const cy = (H / 2 - vp.y) / vp.zoom;
    x = W / 2 - cx * zoom;
    y = H / 2 - cy * zoom;
  }
  const shift = (lo: number, hi: number, min: number, max: number) => {
    if (hi - lo > max - min) return min - lo; // too big to fit: keep its start in view
    if (lo < min) return min - lo;
    if (hi > max) return max - hi;
    return 0;
  };
  const dx = shift(bx0 * zoom + x, bx1 * zoom + x, EDGE.side, W - EDGE.side);
  // A group too tall to fit is centred on the anchor instead.
  const dy = (by1 - by0) * zoom > roomH ? H / 2 - (anchor.y + anchor.h / 2) * zoom - y : shift(by0 * zoom + y, by1 * zoom + y, EDGE.top, H - EDGE.bottom);
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && zoom === vp.zoom) return;
  flow.setViewport({ x: x + dx, y: y + dy, zoom }, { duration: 320 });
}

/** Frame the map: whole if it fits at a readable size, otherwise the root at the left and readable text. */
export function frameMap(flow: ReturnType<typeof useReactFlow>, placed: globalThis.Map<string, Placed>, rootId: string, el: HTMLElement | null, duration = 0) {
  if (!el || !placed.size) return;
  const W = el.clientWidth;
  const H = el.clientHeight;
  if (W < 50 || H < 50) return;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of placed.values()) {
    x0 = Math.min(x0, q.x);
    y0 = Math.min(y0, q.y);
    x1 = Math.max(x1, q.x + q.w);
    y1 = Math.max(y1, q.y + q.h);
  }
  const pad = 24;
  const fit = Math.min(1, (W - pad * 2) / Math.max(1, x1 - x0), (H - pad * 2) / Math.max(1, y1 - y0));
  // The whole map when it reads at that size; otherwise the root at the left at a reading size.
  if (fit >= MIN_READABLE_ZOOM) {
    const zoom = fit;
    flow.setViewport({ x: (W - (x1 - x0) * zoom) / 2 - x0 * zoom, y: (H - (y1 - y0) * zoom) / 2 - y0 * zoom, zoom }, { duration });
    return;
  }
  const zoom = 0.8;
  const root = placed.get(rootId)!;
  flow.setViewport({ x: pad - root.x * zoom, y: H / 2 - (root.y + root.h / 2) * zoom, zoom }, { duration });
}

function Map() {
  const doc = useNotes((s) => s.doc);
  const selected = useNotes((s) => s.selected);
  const focusRequest = useNotes((s) => s.focusRequest);
  const flow = useReactFlow();
  const [nodes, setNodes] = useState<MindFlowNode[]>([]);
  const [sizes, setSizes] = useState(() => new globalThis.Map<string, { w: number; h: number }>());
  const [sizeTick, setSizeTick] = useState(0);
  const placedRef = useRef(new globalThis.Map<string, Placed>());
  // Which nodes have been measured, as of the last layout (placedRef is laid out with these sizes).
  const measuredRef = useRef(new globalThis.Map<string, { w: number; h: number }>());
  const dragRef = useRef<{ id: string; start: { x: number; y: number }; subtree: string[]; origin: globalThis.Map<string, { x: number; y: number }> } | null>(null);
  const [drop, setDrop] = useState<{ target: string; zone: Drop } | null>(null);
  const dropRef = useRef<{ target: string; zone: Drop } | null>(null);
  const fitted = useRef(false);
  const anim = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useFlowStore((s) => s.width);

  const order = useMemo(() => (doc ? visibleOrder(doc) : []), [doc]);

  useEffect(() => {
    mapApi.getNodes = () => flow.getNodes();
  }, [flow]);

  // Lay the tree out with measured sizes, then glide every node to its new place.
  const placed = useMemo(() => {
    if (!doc) return new globalThis.Map<string, Placed>();
    return layoutMap(doc, (id) => sizes.get(id) ?? FALLBACK);
    // sizeTick also re-runs the layout so a dropped node glides back to its place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, sizes, sizeTick]);

  const draftTop = useCallback((id: string) => {
    const d = useNotes.getState().doc;
    const n = d?.nodes[id];
    return !!n?.draft && !(n.parentId && d?.nodes[n.parentId]?.draft);
  }, []);

  useEffect(() => {
    if (!doc) return;
    placedRef.current = placed;
    measuredRef.current = sizes;
    const prev = new globalThis.Map(nodes.map((n) => [n.id, n.position]));
    const target: MindFlowNode[] = order.map((id) => {
      const p = placed.get(id)!;
      const parent = doc.nodes[id]?.parentId;
      // A new node starts from its parent's position, so it grows out of it.
      const from = prev.get(id) ?? (parent ? prev.get(parent) : undefined) ?? { x: p.x, y: p.y };
      return {
        id,
        type: "mind",
        position: from,
        data: { depth: p.depth, branch: p.branch, drop: drop?.target === id ? drop.zone : null, draftTop: draftTop(id) },
        draggable: id !== doc.rootId && !COARSE,
      };
    });
    // Each frame merges into the nodes React Flow holds, keeping what it measured and whether a node is being
    // dragged: a node it believes unmeasured is hidden until measured again, and hiding a node takes the caret
    // away from a branch being written.
    const apply = (at: (t: MindFlowNode, p: Placed) => { x: number; y: number }) =>
      setNodes((cur) => {
        const held = new globalThis.Map(cur.map((n) => [n.id, n]));
        return target.map((t) => {
          const c = held.get(t.id);
          const p = placed.get(t.id)!;
          const dragged = !!c && !!dragRef.current?.subtree.includes(t.id);
          return { ...t, measured: c?.measured, dragging: c?.dragging, position: dragged ? c.position : at(t, p) };
        });
      });
    cancelAnimationFrame(anim.current);
    const start = performance.now();
    const duration = 240;
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const e = 1 - Math.pow(1 - t, 3);
      apply((n, p) => ({ x: n.position.x + (p.x - n.position.x) * e, y: n.position.y + (p.y - n.position.y) * e }));
      if (t < 1) anim.current = requestAnimationFrame(frame);
    };
    anim.current = requestAnimationFrame(frame);
    // Hidden panes don't run animation frames: land on the final layout anyway.
    const safety = setTimeout(() => {
      cancelAnimationFrame(anim.current);
      apply((_, p) => ({ x: p.x, y: p.y }));
    }, duration + 120);
    return () => {
      cancelAnimationFrame(anim.current);
      clearTimeout(safety);
    };
    // Only layout changes drive the glide; `nodes` is read for the starting points.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed, order, drop]);

  const edges: MindEdge[] = useMemo(() => {
    if (!doc) return [];
    const sel = new Set(selected);
    return order
      .filter((id) => doc.nodes[id]?.parentId)
      .map((id) => {
        const n = doc.nodes[id];
        const p = placed.get(id);
        return {
          id: `e-${id}`,
          source: n.parentId!,
          target: id,
          type: "branch",
          data: { depth: p?.depth ?? 1, branch: p?.branch ?? 0, draft: !!n.draft, active: sel.has(id) || sel.has(n.parentId!) },
        };
      });
  }, [doc, order, placed, selected]);

  const onNodesChange = useCallback((changes: NodeChange<MindFlowNode>[]) => {
    const measured: { id: string; w: number; h: number }[] = [];
    for (const c of changes) {
      if (c.type === "dimensions" && c.dimensions) measured.push({ id: c.id, w: Math.round(c.dimensions.width), h: Math.round(c.dimensions.height) });
    }
    setNodes((ns) => applyNodeChanges(changes, ns));
    if (measured.length) {
      setSizes((prev) => {
        let changed = false;
        const next = new globalThis.Map(prev);
        for (const m of measured) {
          const old = prev.get(m.id);
          if (!old || Math.abs(old.w - m.w) > 0.5 || Math.abs(old.h - m.h) > 0.5) {
            next.set(m.id, { w: m.w, h: m.h });
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }
  }, []);

  // Frame the whole map once it has been measured; afterwards the reader's view is theirs.
  useEffect(() => {
    if (fitted.current || !nodes.length || sizes.size < Math.min(order.length, 1)) return;
    const t = setTimeout(() => {
      frameMap(flow, placedRef.current, useNotes.getState().doc!.rootId, containerRef.current);
      fitted.current = true;
    }, 60);
    return () => clearTimeout(t);
  }, [nodes.length, order.length, flow, sizes]);

  // Bring nodes into view when they were just added, grown or asked for: the least movement that shows them all
  // (the new node and its parent, a branch and what AI added to it), zooming out a little only if they can't fit.
  useEffect(() => {
    if (!focusRequest) return;
    // Move once, when the nodes have their real sizes (a new node is measured a frame or two after it appears).
    let tries = 0;
    let timer = 0;
    const tick = () => {
      const doc = useNotes.getState().doc;
      const ready = focusRequest.ids.every((id) => !doc?.nodes[id] || measuredRef.current.has(id));
      if (!ready && tries++ < 20) {
        timer = window.setTimeout(tick, 50);
        return;
      }
      revealInView(flow, placedRef.current, focusRequest.ids, containerRef.current);
    };
    timer = window.setTimeout(tick, 80);
    return () => clearTimeout(timer);
  }, [focusRequest, flow]);

  // Reframe when the panel changes size a lot (expanded, collapsed, resized).
  const lastWidth = useRef(0);
  useEffect(() => {
    if (!nodes.length || !width) return;
    if (Math.abs(width - lastWidth.current) > 120) {
      lastWidth.current = width;
      const t = setTimeout(() => frameMap(flow, placedRef.current, useNotes.getState().doc!.rootId, containerRef.current, fitted.current ? 280 : 0), 80);
      return () => clearTimeout(t);
    }
  }, [width, flow, nodes.length]);

  useEffect(() => {
    mapApi.frame = () => frameMap(flow, placedRef.current, useNotes.getState().doc!.rootId, containerRef.current, 280);
    mapApi.zoom = (by) => void (by > 0 ? flow.zoomIn({ duration: 200 }) : flow.zoomOut({ duration: 200 }));
    mapApi.zoomTo = (z) => void flow.zoomTo(z, { duration: 200 });
  }, [flow]);

  // AI grew the map: frame it again once the new nodes have been measured and laid out.
  const frameKey = useNotes((s) => s.frameKey);
  useEffect(() => {
    if (!frameKey) return;
    const t = setTimeout(() => frameMap(flow, placedRef.current, useNotes.getState().doc!.rootId, containerRef.current, 360), 420);
    return () => clearTimeout(t);
  }, [frameKey, flow]);

  // ── Drag a node (with its branch) onto another to move it there. ──
  const onNodeDragStart = (_: MouseEvent | TouchEvent, node: MindFlowNode) => {
    const d = useNotes.getState().doc;
    if (!d) return;
    const subtree: string[] = [];
    const walk = (id: string) => {
      subtree.push(id);
      for (const c of visibleChildren(d, id)) walk(c);
    };
    walk(node.id);
    const origin = new globalThis.Map<string, { x: number; y: number }>();
    for (const id of subtree) {
      const p = placedRef.current.get(id);
      if (p) origin.set(id, { x: p.x, y: p.y });
    }
    dragRef.current = { id: node.id, start: { ...node.position }, subtree, origin };
    useNotes.getState().select([node.id], true);
  };

  const onNodeDrag = (e: MouseEvent | TouchEvent, node: MindFlowNode) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = node.position.x - drag.start.x;
      const dy = node.position.y - drag.start.y;
      setNodes((ns) =>
        ns.map((n) => {
          if (n.id === node.id || !drag.subtree.includes(n.id)) return n;
          const o = drag.origin.get(n.id);
          return o ? { ...n, position: { x: o.x + dx, y: o.y + dy } } : n;
        }),
      );
      const point = "touches" in e ? e.touches[0] : e;
      if (!point) return;
      const pt = flow.screenToFlowPosition({ x: point.clientX, y: point.clientY });
      let hit: { target: string; zone: Drop } | null = null;
      for (const [id, p] of placedRef.current) {
        if (drag.subtree.includes(id)) continue;
        if (pt.x < p.x - 8 || pt.x > p.x + p.w + 8 || pt.y < p.y - 6 || pt.y > p.y + p.h + 6) continue;
        const rel = (pt.y - p.y) / Math.max(p.h, 1);
        const isRoot = id === useNotes.getState().doc?.rootId;
        hit = { target: id, zone: isRoot ? "child" : rel < 0.28 ? "before" : rel > 0.72 ? "after" : "child" };
        break;
      }
      if (dropRef.current?.target !== hit?.target || dropRef.current?.zone !== hit?.zone) {
        dropRef.current = hit;
        setDrop(hit);
      }
  };

  const onNodeDragStop = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    mapGesture.lastDragEnd = performance.now();
    const target = dropRef.current;
    dropRef.current = null;
    setDrop(null);
    const st = useNotes.getState();
    const d = st.doc;
    if (!drag || !d) return;
    if (target) {
      const t = d.nodes[target.target];
      if (target.zone === "child") st.move(drag.id, t.id, t.children.length);
      else if (t.parentId) {
        const siblings = d.nodes[t.parentId].children;
        st.move(drag.id, t.parentId, siblings.indexOf(t.id) + (target.zone === "after" ? 1 : 0));
      }
      const into = target.zone === "child" ? t : t.parentId ? d.nodes[t.parentId] : null;
      const name = into ? (into.kind === "root" ? into.s || into.t : into.t || into.s || "") : "";
      st.notify(name ? `Moved into “${name.length > 26 ? `${name.slice(0, 25)}…` : name}”` : "Moved");
    } else {
      // Not dropped on anything: glide back.
      setSizeTick((x) => x + 1);
    }
  };

  // ── A passage dragged from the paper: dropped on a node it goes under it; on the open canvas, into the excerpts. ──
  const onPassageOver = (e: React.DragEvent) => {
    if (!passageDrag.sel) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!usePassageOver.getState().over) usePassageOver.setState({ over: true });
    const pt = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    let hit: { target: string; zone: Drop } | null = null;
    for (const [id, p] of placedRef.current) {
      if (pt.x >= p.x - 8 && pt.x <= p.x + p.w + 8 && pt.y >= p.y - 6 && pt.y <= p.y + p.h + 6) {
        hit = { target: id, zone: "child" };
        break;
      }
    }
    if (dropRef.current?.target !== hit?.target) {
      dropRef.current = hit;
      setDrop(hit);
    }
  };
  const onPassageLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as HTMLElement | null)) return;
    usePassageOver.setState({ over: false });
    if (dropRef.current) {
      dropRef.current = null;
      setDrop(null);
    }
  };
  const onPassageDrop = (e: React.DragEvent) => {
    const sel = passageDrag.sel;
    if (!sel) return;
    e.preventDefault();
    const target = dropRef.current?.target ?? null;
    dropRef.current = null;
    setDrop(null);
    passageDrag.sel = null;
    usePassageOver.setState({ over: false });
    keepPassage(sel, target);
    window.getSelection()?.removeAllRanges();
  };

  // ── XMind keys ──
  const onKeyDown = (e: React.KeyboardEvent) => {
    const st = useNotes.getState();
    const d = st.doc;
    if (!d || st.editing || e.nativeEvent.isComposing || e.keyCode === 229) return;
    const id = st.selected[0];
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) st.redo();
      else st.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      st.redo();
      return;
    }
    if (!id || !d.nodes[id]) {
      if (e.key === "Enter" || e.key === "Tab" || e.key.startsWith("Arrow")) {
        e.preventDefault();
        st.select([d.rootId]);
      }
      return;
    }
    const n = d.nodes[id];
    if (mod && e.key === "/") {
      e.preventDefault();
      st.toggleCollapse(id);
      return;
    }
    if (mod && e.key === "Enter") {
      e.preventDefault();
      st.addParent(id);
      return;
    }
    if (mod || e.altKey) return;
    switch (e.key) {
      case "Tab":
        e.preventDefault();
        if (e.shiftKey) st.outdent(id);
        else st.addChild(id);
        return;
      case "Enter":
        e.preventDefault();
        st.addSibling(id, e.shiftKey);
        return;
      case "Delete":
      case "Backspace": {
        e.preventDefault();
        const gone = st.selected.filter((x) => d.nodes[x] && d.nodes[x].kind !== "root");
        if (!gone.length) return;
        st.remove(gone);
        st.notify(gone.length === 1 ? "Branch deleted" : `${gone.length} branches deleted`);
        return;
      }
      case " ":
      case "F2":
        e.preventDefault();
        st.startEdit(id, "append");
        return;
      case "Escape":
        st.select([]);
        return;
      case "ArrowLeft":
        e.preventDefault();
        if (n.parentId) st.select([n.parentId]);
        return;
      case "ArrowRight": {
        e.preventDefault();
        if (n.collapsed) st.toggleCollapse(id, false);
        const first = visibleChildren(d, id)[0];
        if (first) st.select([first]);
        return;
      }
      case "ArrowUp":
      case "ArrowDown": {
        e.preventDefault();
        const here = placedRef.current.get(id);
        if (!here) return;
        // Nearest node above or below, preferring the same column.
        let best: string | null = null;
        let bestScore = Infinity;
        for (const [other, p] of placedRef.current) {
          if (other === id) continue;
          const dy = e.key === "ArrowUp" ? here.y - p.y : p.y - here.y;
          if (dy <= 1) continue;
          const score = dy + Math.abs(p.x - here.x) * 2.5;
          if (score < bestScore) {
            bestScore = score;
            best = other;
          }
        }
        if (best) {
          st.select([best]);
          st.focusNode(best);
        }
        return;
      }
    }
    // Typing starts editing and replaces the text, as in XMind; never on the title, which is the paper's name and
    // only changes when the reader chooses to edit it.
    if (e.key.length === 1 && !e.repeat && n.kind !== "root") {
      e.preventDefault();
      st.startEdit(id, "replace", e.key);
    }
  };

  if (!doc) return null;
  return (
    <div
      ref={containerRef}
      className="mind-map relative h-full w-full outline-none"
      tabIndex={0}
      data-keyscope="map"
      onKeyDown={onKeyDown}
      onDragOver={onPassageOver}
      onDragLeave={onPassageLeave}
      onDrop={onPassageDrop}
    >
      <ReactFlow<MindFlowNode, MindEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onPaneClick={() => useNotes.getState().select([])}
        onMove={(_, vp) => {
          // The header's zoom menu shows the zoom in whole percent; only a change of that is news.
          if (Math.round(vp.zoom * 100) !== Math.round(useUi.getState().mapZoom * 100)) useUi.setState({ mapZoom: vp.zoom });
        }}
        nodesConnectable={false}
        elementsSelectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick={false}
        minZoom={0.25}
        maxZoom={2}
        nodeDragThreshold={4}
        proOptions={{ hideAttribution: true }}
        disableKeyboardA11y
      />
      <SelectionToolbar />
    </div>
  );
}

export function MapView() {
  return (
    <ReactFlowProvider>
      <Map />
    </ReactFlowProvider>
  );
}
