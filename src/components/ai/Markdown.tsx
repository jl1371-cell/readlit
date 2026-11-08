"use client";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import clsx from "clsx";
import { Fragment, type ReactNode } from "react";
import { pageOfSentence, useReader } from "@/lib/store/reader";
import { tidy } from "./tidy";

/** A citation chip: "p.4", with the sentence on hover; a click jumps to it and flashes it. */
export function Cite({ sids }: { sids: string[] }) {
  const pageText = useReader((s) => s.pageText);
  const jumpTo = useReader((s) => s.jumpTo);
  const pointAt = useReader((s) => s.pointAt);
  const pages = [...new Set(sids.map(pageOfSentence))].filter((p) => Number.isFinite(p));
  if (!pages.length) return null;
  return (
    <>
      {pages.map((page) => {
        const ids = sids.filter((s) => pageOfSentence(s) === page);
        const text = ids.map((id) => pageText[page]?.sentences.find((x) => x.id === id)?.text).filter(Boolean).join(" ");
        return (
          <TooltipPrimitive.Root key={page} delayDuration={250}>
            <TooltipPrimitive.Trigger asChild>
              <button
                type="button"
                onClick={() => jumpTo(page, ids, { remember: true })}
                onPointerEnter={(e) => e.pointerType === "mouse" && pointAt(page, ids)}
                onPointerLeave={() => pointAt(null)}
                className="chip mx-[2px] translate-y-[-1px] align-middle transition-colors hover:bg-champagne-tint hover:text-paprika"
              >
                p.{page}
              </button>
            </TooltipPrimitive.Trigger>
            {text && (
              <TooltipPrimitive.Portal>
                <TooltipPrimitive.Content
                  side="top"
                  sideOffset={6}
                  lang="en"
                  className="z-[80] max-w-[22rem] rounded-xl border border-latte-line/40 bg-paper px-3 py-2 text-body-sm text-ink-soft shadow-card-hover"
                >
                  {text.length > 320 ? `${text.slice(0, 320)}…` : text}
                </TooltipPrimitive.Content>
              </TooltipPrimitive.Portal>
            )}
          </TooltipPrimitive.Root>
        );
      })}
    </>
  );
}

/**
 * Where a part of an answer comes from when it isn't the paper: the AI's general knowledge ([[beyond]]), or the real
 * list of citing papers looked up in OpenAlex ([[openalex]]). Marked so neither is mistaken for what the paper says;
 * neither has a page chip, because the paper isn't their source.
 */
const SOURCES = {
  beyond: {
    label: "Beyond the paper",
    tip: "From the AI's general knowledge of the field, not from this paper and not searched. Worth checking before you rely on it.",
    tone: "bg-crystal/20 text-crystal-text ring-crystal/50",
  },
  openalex: {
    label: "Cited by · OpenAlex",
    tip: "From OpenAlex's list of papers that cite this one, looked up just now. The AI saw their titles, first authors and years, not the papers.",
    tone: "bg-sage/25 text-sage-text ring-sage/50",
  },
} as const;

function Source({ kind }: { kind: keyof typeof SOURCES }) {
  const s = SOURCES[kind];
  return (
    <TooltipPrimitive.Root delayDuration={250}>
      <TooltipPrimitive.Trigger asChild>
        <span lang="en" tabIndex={0} className={clsx("mr-1.5 inline-flex h-5 translate-y-[-2px] items-center rounded-full px-2 align-middle font-sans text-caption font-medium leading-none ring-1", s.tone)}>
          {s.label}
        </span>
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side="top" sideOffset={6} className="z-[80] max-w-[20rem] rounded-xl border border-latte-line/40 bg-paper px-3 py-2 text-label text-ink-soft shadow-card-hover">
          {s.tip}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

const INLINE = /(\*\*[^*\n]+\*\*|\*[^*\s\n][^*\n]*\*|`[^`\n]+`|\[\[(?:beyond|openalex)\]\]|\[\[\s*p\d+s\d+(?:\s*[,;]\s*p\d+s\d+)*\s*\]\])/gi;
const CITES = /\s*\[\[[^\]]*\]\]/g;

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const tok = m[0];
    const k = `${key}-${i++}`;
    if (/^\[\[(beyond|openalex)\]\]$/i.test(tok)) out.push(<Source key={k} kind={tok.slice(2, -2).toLowerCase() as keyof typeof SOURCES} />);
    else if (tok.startsWith("[[")) out.push(<Cite key={k} sids={tok.slice(2, -2).split(/\s*[,;]\s*/).map((s) => s.trim())} />);
    else if (tok.startsWith("**")) out.push(<strong key={k} className="font-semibold text-ink">{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={k} className="rounded bg-canvas px-1 py-[1px] font-mono text-[0.875em] text-ink">{tok.slice(1, -1)}</code>);
    else out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    last = at + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// ── Parsing ─────────────────────────────────────────────────────────────────────────────────────────────────
// One parse serves both rendering and the English versions: every paragraph, heading, quote and list item gets an
// id from its position, so the English written for it finds its way back under it.

type Item = { id: string; text: string; children: Item[] };
type Block =
  | { kind: "code"; id: string; body: string }
  | { kind: "heading"; id: string; text: string }
  | { kind: "list"; id: string; ordered: boolean; items: Item[] }
  | { kind: "quote"; id: string; text: string }
  | { kind: "para"; id: string; text: string };

const LIST_LINE = /^\s*(?:[-*+]|\d+[.)])\s+/;

function parseList(lines: string[], id: string): { ordered: boolean; items: Item[] } {
  const ordered = /^\s*\d+[.)]\s/.test(lines[0]);
  const root: Item[] = [];
  const stack: { depth: number; item: Item }[] = [];
  for (const line of lines) {
    const m = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (!m) {
      if (stack.length) stack[stack.length - 1].item.text += ` ${line.trim()}`;
      continue;
    }
    const depth = m[1].replace(/\t/g, "  ").length;
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const siblings = stack.length ? stack[stack.length - 1].item.children : root;
    const parentId = stack.length ? stack[stack.length - 1].item.id : id;
    const item: Item = { id: `${parentId}.${siblings.length}`, text: m[2], children: [] };
    siblings.push(item);
    stack.push({ depth, item });
  }
  return { ordered, items: root };
}

function parse(text: string): Block[] {
  const lines = tidy(text).split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const id = `b${blocks.length}`;
    if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      i++;
      blocks.push({ kind: "code", id, body: body.join("\n") });
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ kind: "heading", id, text: h[2] });
      i++;
      continue;
    }
    if (LIST_LINE.test(line)) {
      const group: string[] = [];
      while (i < lines.length && (LIST_LINE.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && group.length))) group.push(lines[i++]);
      blocks.push({ kind: "list", id, ...parseList(group, id) });
      continue;
    }
    if (line.startsWith(">")) {
      const body: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) body.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push({ kind: "quote", id, text: body.join(" ") });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|\s*(?:[-*+]|\d+[.)])\s+)/.test(lines[i])) para.push(lines[i++].trim());
    blocks.push({ kind: "para", id, text: para.join(" ") });
  }
  return blocks;
}

/** A piece of an answer that gets its own English version. */
export interface Unit {
  id: string;
  text: string;
}

/** The pieces of an answer, in reading order, with the ids the renderer gives them. Code is left as it is. */
export function markdownUnits(text: string): Unit[] {
  const out: Unit[] = [];
  const walk = (items: Item[]) => {
    for (const it of items) {
      if (it.text.replace(CITES, "").trim()) out.push({ id: it.id, text: it.text });
      walk(it.children);
    }
  };
  for (const b of parse(text)) {
    if (b.kind === "list") walk(b.items);
    else if (b.kind !== "code" && b.text.replace(CITES, "").trim()) out.push({ id: b.id, text: b.text });
  }
  return out;
}

// ── Rendering ───────────────────────────────────────────────────────────────────────────────────────────────

/** The English version under a piece of text: plain, one step quieter, no citations (they sit on the original). */
export function Pair({ text, className }: { text?: string; className?: string }) {
  if (!text) return null;
  return (
    <span lang="en" className={clsx("pair", className)}>
      {inline(text.replace(CITES, "").trim(), "en")}
    </span>
  );
}

function List({ items, ordered, pairs, pairClass }: { items: Item[]; ordered: boolean; pairs?: Record<string, string>; pairClass: string }) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag className={ordered ? "ml-5 list-decimal space-y-1.5 marker:text-latte" : "ml-4 list-disc space-y-1.5 marker:text-latte-line"}>
      {items.map((it) => (
        <li key={it.id} className="pl-0.5">
          {inline(it.text, it.id)}
          <Pair text={pairs?.[it.id]} className={pairClass} />
          {it.children.length > 0 && (
            <div className="mt-1.5">
              <List items={it.children} ordered={false} pairs={pairs} pairClass={pairClass} />
            </div>
          )}
        </li>
      ))}
    </Tag>
  );
}

/**
 * A small Markdown renderer for answers: paragraphs, headings, lists, quotes, code, emphasis and citations. With
 * `pairs`, each piece carries its English version underneath.
 */
export function Markdown({ text, pairs, pairClass = "text-ui" }: { text: string; pairs?: Record<string, string>; pairClass?: string }) {
  const blocks = parse(text).map((b): ReactNode => {
    switch (b.kind) {
      case "code":
        return (
          <pre key={b.id} className="quiet-scroll overflow-x-auto rounded-xl bg-canvas px-3 py-2 font-mono text-[0.8125em] leading-[1.55] text-ink">
            {b.body}
          </pre>
        );
      case "heading":
        return (
          <p key={b.id} className="pt-1 font-display text-heading font-medium text-ink">
            {inline(b.text, b.id)}
            <Pair text={pairs?.[b.id]} className={clsx(pairClass, "font-normal")} />
          </p>
        );
      case "list":
        return <List key={b.id} items={b.items} ordered={b.ordered} pairs={pairs} pairClass={pairClass} />;
      case "quote":
        return (
          <blockquote key={b.id} className="border-l-2 border-champagne pl-3 text-ink-soft">
            {inline(b.text, b.id)}
            <Pair text={pairs?.[b.id]} className={pairClass} />
          </blockquote>
        );
      default:
        return (
          <p key={b.id}>
            <Fragment>{inline(b.text, b.id)}</Fragment>
            <Pair text={pairs?.[b.id]} className={pairClass} />
          </p>
        );
    }
  });
  return <div className="space-y-3">{blocks}</div>;
}
