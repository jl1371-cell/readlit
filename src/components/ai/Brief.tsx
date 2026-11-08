"use client";
import clsx from "clsx";
import { ArrowRight, BookOpenText, ListPlus, RotateCw, Sparkles } from "lucide-react";
import { type ReactNode, useState } from "react";
import { draftMindMap } from "@/components/notes/actions";
import { LENS_COLOR } from "@/components/reader/PageLayers";
import { Tip } from "@/components/ui/primitives";
import { useChat } from "@/lib/store/chat";
import { useNotes } from "@/lib/store/notes";
import { type Brief as BriefData, type BriefPoint, useReader } from "@/lib/store/reader";
import { type LensKind, usePairs, useSettings } from "@/lib/store/settings";
import { useUi } from "@/lib/store/ui";
import { Markdown, Pair } from "./Markdown";

const KINDS: { kind: LensKind; label: string }[] = [
  { kind: "claim", label: "Claim" },
  { kind: "method", label: "Method" },
  { kind: "result", label: "Result" },
  { kind: "limitation", label: "Limit" },
];

function sentenceOf(p: BriefPoint): string {
  return useReader.getState().pageText[p.page]?.sentences.find((s) => s.id === p.sid)?.text ?? p.text;
}

/** Hovering a reference marks its sentence in the paper; a click goes there. */
function goTo(page: number, sids: string[]) {
  return {
    onClick: () => useReader.getState().jumpTo(page, sids, { remember: true }),
    onPointerEnter: (e: React.PointerEvent) => e.pointerType === "mouse" && useReader.getState().pointAt(page, sids),
    onPointerLeave: () => useReader.getState().pointAt(null),
  };
}

/**
 * The first thing in the AI column, a first pass through the paper (Keshav): what kind of paper it is, its gist, and
 * one datasheet of what is new, what it claims, how, what it found and what it concedes, with the figure to look at
 * first. Every row goes to its sentence. Written when the paper opens, kept with the paper.
 *
 * English follows the gist, the brief's one paragraph; the short rows keep to the reader's language (their source
 * sentence, in the paper's own words, lights up in the paper on hover).
 */
export function Brief() {
  const brief = useReader((s) => s.brief);
  const textReady = useReader((s) => !!s.doc && s.textPages >= s.doc.numPages);
  const pairs = usePairs();
  const data = brief.data;

  if (!data) {
    if (brief.status === "error") {
      return (
        <section className="pt-5">
          <Header />
          <p className="mt-2 text-ui text-latte-deep">{brief.error}</p>
          <button
            type="button"
            onClick={() => void useReader.getState().loadBrief({ force: true })}
            className="mt-2.5 inline-flex h-8 items-center gap-1.5 rounded-full border border-latte-line/60 bg-paper px-3 text-ui font-medium text-ink hover:bg-parchment/50"
          >
            <RotateCw className="h-3.5 w-3.5" /> Try again
          </button>
        </section>
      );
    }
    return (
      <section className="pt-5" aria-busy="true">
        <Header status={textReady ? "Reading the paper…" : "Opening the paper…"} />
        <div className="mt-3 space-y-2.5">
          <div className="tr-shimmer h-[16px] w-full rounded" />
          <div className="tr-shimmer h-[16px] w-[92%] rounded" />
          <div className="tr-shimmer h-[16px] w-[64%] rounded" />
        </div>
        <div className="mt-5 space-y-3 rounded-2xl bg-canvas/60 px-3.5 py-3.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex gap-3">
              <div className="tr-shimmer h-[12px] w-10 shrink-0 rounded" />
              <div className="flex-1 space-y-1.5">
                <div className="tr-shimmer h-[13px] w-full rounded" />
                <div className="tr-shimmer h-[13px] w-[72%] rounded" />
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  const english = pairs ? data.en?.gist : undefined;
  const englishPending = pairs && !data.en && brief.pairing === "loading";
  return (
    <section className="ai-text pt-5" lang={data.lang} aria-busy={brief.status === "loading"}>
      <Header status={brief.status === "loading" ? "Writing the brief again…" : undefined} kind={data.kind} />
      <div className={clsx("mt-2 text-body text-ink transition-opacity", brief.status === "loading" && "opacity-50")}>
        <Markdown text={data.gist} />
        {english ? (
          <Pair text={english} className="text-ui" />
        ) : englishPending ? (
          // Room for the English while it is written, so it arrives in place instead of pushing the brief down.
          <span className="mt-1.5 block space-y-1.5" aria-hidden>
            {placeholderLines(englishLines(data.gist)).map((width, i) => (
              <span key={i} className="tr-shimmer block h-[13px] rounded" style={{ width }} />
            ))}
          </span>
        ) : null}
      </div>
      <Datasheet data={data} />
    </section>
  );
}

function placeholderLines(n: number): string[] {
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? "58%" : "100%"));
}

/** About how many lines the gist's English will take: English runs longer than Chinese or Japanese for the same idea. */
function englishLines(gist: string): number {
  const plain = gist.replace(/\[\[[^\]]*\]\]/g, "").replace(/\*\*/g, "");
  const cjk = (plain.match(/[　-鿿가-힯]/g) ?? []).length;
  const chars = cjk * 3.2 + (plain.length - cjk);
  return Math.max(2, Math.min(7, Math.round(chars / 44)));
}

/** "Brief", what kind of paper it is, and the underlines switch, on one quiet line. */
function Header({ status, kind }: { status?: string; kind?: string }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h2 lang="en" className="text-label font-medium text-latte">
          {status ?? "Brief"}
        </h2>
        {!status && <MarksSwitch />}
      </div>
      {kind && <p className="mt-0.5 text-label text-latte-deep">{kind}</p>}
    </div>
  );
}

/**
 * The brief's datasheet: one row per question a first pass answers, label on the left, the answer beside it, its page
 * at the end. Claim, method, result and limit take the colours of their underlines in the paper.
 */
function Datasheet({ data }: { data: BriefData }) {
  const [all, setAll] = useState(false);
  // The point last opened keeps its actions in view, so they can be reached without hovering (touch).
  const [active, setActive] = useState<string | null>(null);
  const groups = KINDS.map((k) => ({ ...k, points: data.points.filter((p) => p.kind === k.kind) })).filter((g) => g.points.length);
  const shown = groups.reduce((n, g) => n + (all ? g.points.length : 1), 0);
  const nv = data.novelty;
  const look = data.lookFirst ?? [];
  return (
    <div className="mt-4 rounded-2xl bg-canvas/60 px-1.5 py-2 ring-1 ring-latte-line/30">
      <dl className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-y-0.5">
        {nv && (
          <Row label="New">
            <div className="rounded-lg px-2 py-1.5">
              {nv.text}
              <button type="button" {...goTo(nv.page, [nv.sid])} className="chip ml-1.5 translate-y-[-2px] align-middle hover:text-paprika">
                p.{nv.page}
              </button>
            </div>
          </Row>
        )}
        {groups.map(({ kind, label, points }) => (
          <Row key={kind} label={label} color={LENS_COLOR[kind].text}>
            <ul>
              {(all ? points : points.slice(0, 1)).map((p) => (
                <PointRow key={p.sid} p={p} active={active === p.sid} onOpen={() => setActive(p.sid)} />
              ))}
            </ul>
          </Row>
        ))}
        {look.length > 0 && (
          <Row label="Look at">
            <ul className="space-y-1 px-2 py-1.5">
              {look.map((f) => (
                <li key={f.sid}>
                  <button
                    type="button"
                    lang="en"
                    {...goTo(f.page, [f.sid])}
                    className="mr-1.5 inline-flex h-6 translate-y-[-1px] items-center gap-1 rounded-full bg-champagne-tint px-2.5 align-middle text-label font-medium text-ink ring-1 ring-champagne/70 transition-colors hover:bg-champagne/60 pointer-coarse:h-8"
                  >
                    {f.label}
                    <span className="tabular font-normal text-latte">p.{f.page}</span>
                  </button>
                  {f.why}
                </li>
              ))}
            </ul>
          </Row>
        )}
      </dl>
      {data.points.length > shown || all ? (
        <button
          type="button"
          lang="en"
          onClick={() => setAll(!all)}
          className="ml-[3.5rem] mt-0.5 rounded-lg px-2 py-1 text-label font-medium text-latte-deep transition-colors hover:text-ink pointer-coarse:py-2"
        >
          {all ? "Show fewer" : `Show all ${data.points.length} key points`}
        </button>
      ) : null}
    </div>
  );
}

function Row({ label, color, children }: { label: string; color?: string; children: ReactNode }) {
  return (
    <>
      <dt lang="en" className="pl-2 pt-[9px] text-label font-medium" style={{ color: color ?? "var(--color-latte)" }}>
        {label}
      </dt>
      <dd className="min-w-0 text-body-sm text-ink-soft">{children}</dd>
    </>
  );
}

function PointRow({ p, active, onOpen }: { p: BriefPoint; active: boolean; onOpen: () => void }) {
  const jumpTo = useReader((s) => s.jumpTo);
  return (
    <li
      data-active={active}
      className="group/pt relative rounded-lg transition-colors hover:bg-paper/80 focus-within:bg-paper/80 data-[active=true]:bg-paper/80"
      onPointerEnter={(e) => e.pointerType === "mouse" && useReader.getState().pointAt(p.page, [p.sid])}
      onPointerLeave={() => useReader.getState().pointAt(null)}
    >
      <button
        type="button"
        onClick={() => {
          jumpTo(p.page, [p.sid], { remember: true });
          onOpen();
        }}
        className="block w-full px-2 py-1.5 text-left"
      >
        {p.text}
        <span className="chip ml-1.5 translate-y-[-2px] align-middle">p.{p.page}</span>
      </button>
      <div className="pointer-events-none absolute right-0 top-0 flex gap-0.5 rounded-r-lg bg-gradient-to-l from-paper from-60% to-transparent py-1 pl-6 pr-1 opacity-0 transition-opacity group-hover/pt:pointer-events-auto group-hover/pt:opacity-100 group-focus-within/pt:pointer-events-auto group-focus-within/pt:opacity-100 group-data-[active=true]/pt:pointer-events-auto group-data-[active=true]/pt:opacity-100">
        <Tip label="Explain this point" side="top">
          <button
            type="button"
            aria-label="Explain this point"
            onClick={() => void useChat.getState().send({ action: "explain", quotes: [{ text: sentenceOf(p), page: p.page, sids: [p.sid] }] })}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-paper text-latte-deep shadow-card hover:text-ink pointer-coarse:h-10 pointer-coarse:w-10"
          >
            <BookOpenText className="h-3.5 w-3.5" />
          </button>
        </Tip>
        <Tip label="Add to notes" side="top">
          <button
            type="button"
            aria-label="Add to notes"
            onClick={() => {
              if (!useUi.getState().notesOpen) useUi.getState().set({ notesOpen: true });
              useNotes.getState().addExcerpt({ text: sentenceOf(p), page: p.page, sids: [p.sid] });
            }}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-paper text-latte-deep shadow-card hover:text-ink pointer-coarse:h-10 pointer-coarse:w-10"
          >
            <ListPlus className="h-3.5 w-3.5" />
          </button>
        </Tip>
      </div>
    </li>
  );
}

/** Whether the key points are underlined in the paper: a small switch on the brief's own line. */
function MarksSwitch() {
  const marks = useSettings((s) => s.marks);
  return (
    <Tip label={marks ? "Stop underlining the key points in the paper" : "Underline the key points in the paper"} keys="K" side="top">
      <button
        type="button"
        role="switch"
        lang="en"
        aria-checked={marks}
        onClick={() => useSettings.getState().update({ marks: !marks })}
        className="-my-1 inline-flex items-center gap-2 rounded-full py-1 pl-2 text-label text-latte-deep transition-colors hover:text-ink pointer-coarse:py-2.5"
      >
        Underline
        <span className={clsx("relative inline-flex h-[18px] w-[32px] shrink-0 rounded-full transition-colors duration-200", marks ? "bg-paprika" : "bg-latte-line/60")}>
          <span className={clsx("absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform duration-200", marks ? "translate-x-[16px]" : "translate-x-[2px]")} />
        </span>
      </button>
    </Tip>
  );
}

/**
 * The way to the AI's mind map while the notes are closed and still empty: a real button just above the composer,
 * where the reader already looks for what the AI can do. The map's home is the notes column; this door goes once
 * there is a map, or the notes are open (their empty state has the same button).
 */
export function DraftMapDoor() {
  const notesOpen = useUi((s) => s.notesOpen);
  const empty = useNotes((s) => !s.doc || s.doc.nodes[s.doc.rootId].children.length === 0);
  const generating = useNotes((s) => !!s.generating);
  const ready = useReader((s) => s.brief.status === "ready");
  if (notesOpen || !empty || generating || !ready) return null;
  return (
    <div className="shrink-0 px-3 pb-2">
      <button
        type="button"
        onClick={draftMindMap}
        className="card-in flex w-full items-center gap-2.5 rounded-2xl bg-paprika-ghost px-3.5 py-2.5 text-left ring-1 ring-paprika/20 transition-colors hover:bg-paprika/[0.12] pointer-coarse:py-3.5"
      >
        <Sparkles className="h-4 w-4 shrink-0 text-paprika" />
        <span className="min-w-0 flex-1 truncate text-ui font-medium text-paprika">
          Draft a mind map<span className="font-normal text-latte-deep"> · in your notes</span>
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 text-paprika/70" />
      </button>
    </div>
  );
}

const NO_QUESTIONS: string[] = [];

/**
 * Three questions to read the paper with (one on its claim, one on its evidence, one on an assumption or limit). A
 * click asks the AI; the page goes to where the paper answers it, to find it there first.
 */
export function NextQuestions() {
  const questions = useReader((s) => s.brief.data?.questions ?? NO_QUESTIONS);
  const sources = useReader((s) => s.brief.data?.questionSids);
  const lang = useReader((s) => s.brief.data?.lang);
  const busy = useChat((s) => s.busy);
  if (!questions.length) return null;
  return (
    <div className="mt-6">
      <h3 lang="en" className="mb-1.5 text-label font-medium text-latte">
        Read with these questions
      </h3>
      <ul className="ai-text -mx-2" lang={lang}>
        {questions.map((q, i) => {
          const sid = sources?.[i];
          const page = sid ? Number(sid.slice(1, sid.indexOf("s"))) : 0;
          return (
            <li key={q} className="group/q flex items-start rounded-xl transition-colors hover:bg-canvas/70">
              <Tip label="Ask the AI" side="top">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void useChat.getState().send({ action: "ask", text: q })}
                  className="flex min-w-0 flex-1 items-start gap-2.5 px-2 py-2 text-left text-ui text-ink-soft transition-colors hover:text-ink disabled:opacity-50"
                >
                  <span className="tabular mt-[2px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-parchment text-caption font-medium leading-none text-latte-deep" aria-hidden>
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">{q}</span>
                </button>
              </Tip>
              {page > 0 && (
                <Tip label="Find the answer in the paper" side="top">
                  <button type="button" lang="en" {...goTo(page, [sid!])} className="chip mr-2 mt-[9px] shrink-0 hover:text-paprika pointer-coarse:mt-1.5 pointer-coarse:h-8">
                    p.{page}
                  </button>
                </Tip>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
