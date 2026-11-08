"use client";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import clsx from "clsx";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  ChevronUp,
  ImageIcon,
  Lightbulb,
  ListTree,
  type LucideIcon,
  MoreHorizontal,
  Plus,
  RotateCcw,
  SearchCheck,
  Square,
  Target,
  Waypoints,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { draftMindMap } from "@/components/notes/actions";
import { Tip } from "@/components/ui/primitives";
import { languageByCode } from "@/lib/languages";
import { type ChatAction, type ChatMessage, PAPER_ASKS, type Quote, type RegionRef, actionLabel, saveResearch, useChat } from "@/lib/store/chat";
import { useNotes } from "@/lib/store/notes";
import { useReader } from "@/lib/store/reader";
import { usePairs, useSettings } from "@/lib/store/settings";
import { useUi } from "@/lib/store/ui";
import { Brief, DraftMapDoor, NextQuestions } from "./Brief";
import { Markdown } from "./Markdown";

/**
 * The AI column: everything the AI tells the reader arrives here. The brief comes first, written when the paper
 * opens; explanations, summaries and answers follow it as one conversation; the composer stays at the bottom.
 *
 * Calm by default: the suggested questions are there only before the first question, each answer carries two
 * actions, and the composer's "+" lists everything else the AI can do.
 */
export function AiPanel() {
  const messages = useChat((s) => s.messages);
  const busy = useChat((s) => s.busy);
  const listRef = useRef<HTMLDivElement>(null);
  const briefRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [away, setAway] = useState(false);
  const [briefOut, setBriefOut] = useState(false);

  // Follow a streaming answer unless the reader has scrolled up to read.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current && messages.length) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // When the brief has scrolled away, a one-line bar at the top brings it back.
  useEffect(() => {
    const el = briefRef.current;
    const root = listRef.current;
    if (!el || !root) return;
    const io = new IntersectionObserver(([e]) => setBriefOut(!e.isIntersecting), { root, threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const latest = [...messages].reverse().find((m) => m.role === "assistant")?.id;
  return (
    <div className="flex h-full flex-col">
      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
          stick.current = gap < 40;
          setAway(gap > 160);
        }}
        className="quiet-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-5"
      >
        <BriefBar show={briefOut && messages.length > 0} onOpen={() => listRef.current?.scrollTo({ top: 0, behavior: "smooth" })} />
        <div ref={briefRef}>
          <Brief />
        </div>
        {messages.length === 0 && (
          <>
            <NextQuestions />
            <PaperAsks />
          </>
        )}
        <ChatStash />
        {messages.length > 0 && (
          <div className="mt-6 border-t border-latte-line/30 pt-1">
            {messages.map((m, i) => (
              <Message key={m.id} m={m} prev={messages[i - 1]} busy={busy} latest={m.id === latest} />
            ))}
          </div>
        )}
      </div>
      {/* Scrolled up to read: one click back to the newest. */}
      <div className="relative h-0">
        {away && messages.length > 0 && (
          <button
            type="button"
            onClick={() => {
              const el = listRef.current;
              el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
            }}
            className="glass card-in absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1 rounded-full px-3.5 py-1.5 text-ui font-medium text-ink shadow-card-hover pointer-coarse:py-2.5"
          >
            <ArrowDown className="h-3.5 w-3.5" /> Latest
          </button>
        )}
      </div>
      <DraftMapDoor />
      <Composer />
      <ResearchCard />
    </div>
  );
}

/** Ask one of the questions a researcher puts to a whole paper. "For my work" first asks what that is, once. */
export function askPaper(action: ChatAction) {
  if (action === "relevance" && !useSettings.getState().research.trim()) {
    useUi.getState().set({ researchOpen: "ask" });
    return;
  }
  void useChat.getState().send({ action });
}

/**
 * The asks of a whole paper, before the first question: understand it, place it, question it, build on it. After
 * that they live in the composer's "+".
 */
const ASK_ICON: Partial<Record<ChatAction, LucideIcon>> = {
  walkthrough: BookOpen,
  critique: SearchCheck,
  connections: Waypoints,
  relevance: Target,
  ideas: Lightbulb,
};

function PaperAsks() {
  const ready = useReader((s) => s.brief.status === "ready");
  const busy = useChat((s) => s.busy);
  if (!ready) return null;
  return (
    <div className="mt-6" lang="en">
      <h3 className="mb-2 text-label font-medium text-latte">Go deeper</h3>
      {/* Equal tiles in two columns, in reading order: understand, question, place, build on. */}
      <div className="grid grid-cols-2 gap-1.5">
        {PAPER_ASKS.map((a) => {
          const Icon = ASK_ICON[a.action] ?? BookOpen;
          return (
            <Tip key={a.action} label={a.hint} side="top">
              <button
                type="button"
                disabled={busy}
                onClick={() => askPaper(a.action)}
                className="flex h-10 min-w-0 items-center gap-2 rounded-xl bg-paper px-3 text-left text-ui text-ink-soft ring-1 ring-latte-line/45 transition-colors hover:bg-canvas hover:text-ink hover:ring-latte-line disabled:opacity-50 pointer-coarse:h-12"
              >
                <Icon className="h-4 w-4 shrink-0 text-latte" strokeWidth={1.8} />
                <span className="truncate">{a.label}</span>
              </button>
            </Tip>
          );
        })}
      </div>
    </div>
  );
}

/**
 * What the reader works on, in a sentence or two, kept on this device. The AI uses it when asked what a paper means
 * for that work, or for ideas. Opened from the AI menu, or on the way to "For my work".
 */
function ResearchCard() {
  const mode = useUi((s) => s.researchOpen);
  if (!mode) return null;
  return <ResearchForm key={mode} mode={mode} />;
}

function ResearchForm({ mode }: { mode: "edit" | "ask" }) {
  const [value, setValue] = useState(() => useSettings.getState().research);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.focus();
    if (el) el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const close = () => useUi.getState().set({ researchOpen: null });
  const save = () => {
    const done = saveResearch(value);
    close();
    // The English version is wanted for the search of nearby papers, so the question waits for it (briefly).
    if (mode === "ask") void done.then(() => useChat.getState().send({ action: "relevance" }));
  };
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-ink/10 px-4 backdrop-blur-[2px]" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="research-title"
        className="card-in w-[min(30rem,100%)] rounded-3xl border border-latte-line/40 bg-paper p-6 shadow-card-hover"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
          e.stopPropagation();
        }}
        data-keyscope="research"
      >
        <h2 id="research-title" className="font-display text-title text-ink">
          Your research
        </h2>
        <p className="mt-1 text-ui text-latte">
          A sentence or two: your topic, the methods or data you use, the question you&apos;re on now. The AI uses it to say what a paper means for your work, and for ideas. Saved on this device, and sent to the AI with your questions.
        </p>
        <textarea
          ref={ref}
          rows={3}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              save();
            }
          }}
          placeholder="For example: organ segmentation in abdominal CT, with small labelled datasets."
          className="mt-4 block w-full resize-none rounded-2xl bg-canvas/70 px-4 py-3 text-body text-ink outline-none ring-1 ring-latte-line/50 placeholder:text-latte/70 focus:ring-latte"
        />
        <div className="mt-4 flex items-center justify-end gap-2">
          {mode === "ask" ? (
            <button
              type="button"
              onClick={() => {
                close();
                void useChat.getState().send({ action: "relevance" });
              }}
              className="inline-flex h-9 items-center rounded-full px-4 text-ui font-medium text-latte-deep hover:bg-parchment/70 hover:text-ink"
            >
              Ask without it
            </button>
          ) : (
            <button type="button" onClick={close} className="inline-flex h-9 items-center rounded-full px-4 text-ui font-medium text-latte-deep hover:bg-parchment/70 hover:text-ink">
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={mode === "ask" && !value.trim()}
            className="inline-flex h-9 items-center rounded-full bg-paprika px-4 text-ui font-medium text-white hover:bg-paprika-soft disabled:opacity-45"
          >
            {mode === "ask" ? "Save and ask" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The brief, folded to one line at the top of the column once the conversation has scrolled it away. */
function BriefBar({ show, onOpen }: { show: boolean; onOpen: () => void }) {
  const gist = useReader((s) => s.brief.data?.gist ?? "");
  const line = gist.replace(/\[\[[^\]]+\]\]/g, "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  if (!line) return null;
  return (
    <div className="sticky top-0 z-10 -mx-5 h-0">
      <button
        type="button"
        onClick={onOpen}
        tabIndex={show ? 0 : -1}
        aria-hidden={!show}
        className={clsx(
          "absolute inset-x-0 top-0 flex items-center gap-2 border-b border-latte-line/30 bg-paper/92 px-5 py-2 text-left backdrop-blur-md transition-opacity duration-200",
          show ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <span className="shrink-0 text-label font-medium text-latte">Brief</span>
        <span className="min-w-0 flex-1 truncate text-ui text-ink-soft">{line}</span>
        <ChevronUp className="h-3.5 w-3.5 shrink-0 text-latte" />
      </button>
    </div>
  );
}

/** After "New chat": the last conversation is one click from back. */
function ChatStash() {
  const stash = useChat((s) => s.stash);
  useEffect(() => {
    if (!stash) return;
    const t = setTimeout(() => useChat.getState().dropStash(), 10000);
    return () => clearTimeout(t);
  }, [stash]);
  if (!stash) return null;
  return (
    <div role="status" className="card-in mt-5 flex items-center justify-between gap-2 rounded-2xl bg-canvas/70 py-1.5 pl-3.5 pr-1.5 text-ui text-ink-soft ring-1 ring-latte-line/40">
      <span>Started a new chat</span>
      <button type="button" onClick={() => useChat.getState().restoreChat()} className="rounded-full px-3 py-1 font-medium text-paprika hover:bg-paprika-ghost pointer-coarse:py-2">
        Undo
      </button>
    </div>
  );
}

/** A passage asked about, with what was asked of it ("Explain") at its head. */
function QuoteCard({ q, label }: { q: Quote; label?: string }) {
  const jumpTo = useReader((s) => s.jumpTo);
  return (
    <button
      type="button"
      onClick={() => jumpTo(q.page, q.sids, { remember: true })}
      onPointerEnter={(e) => e.pointerType === "mouse" && useReader.getState().pointAt(q.page, q.sids)}
      onPointerLeave={() => useReader.getState().pointAt(null)}
      className="group block w-full rounded-xl bg-champagne-tint/80 px-3 py-2 text-left ring-1 ring-champagne/60 transition-colors hover:bg-champagne-tint"
      title="Show in the paper"
    >
      {label && <span className="mb-0.5 block text-label font-medium text-latte-deep">{label}</span>}
      <span lang="en" className="line-clamp-4 block text-body-sm text-ink-soft">{q.text}</span>
      <span className="tabular mt-1 block text-caption text-latte group-hover:text-paprika">p.{q.page}</span>
    </button>
  );
}

function RegionCard({ r, label }: { r: RegionRef; label?: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-canvas px-2.5 py-2 ring-1 ring-latte-line/40">
      {r.thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={r.thumb} alt="" className="h-12 max-w-[96px] rounded-md bg-white object-contain ring-1 ring-latte-line/30" />
      ) : (
        <ImageIcon className="h-4 w-4 text-latte" />
      )}
      <span className="min-w-0 flex-1 text-label text-latte">
        {label && <span className="block font-medium text-latte-deep">{label}</span>}
        <span className="tabular">p.{r.page}</span>
        {r.caption ? ` · ${r.caption.slice(0, 90)}${r.caption.length > 90 ? "…" : ""}` : " · Selected area"}
      </span>
    </div>
  );
}

function Message({ m, prev, busy, latest }: { m: ChatMessage; prev?: ChatMessage; busy: boolean; latest: boolean }) {
  const send = useChat((s) => s.send);
  const messages = useChat((s) => s.messages);
  const pairs = usePairs();
  const research = useSettings((s) => s.research.trim());
  // An answer from before English was wanted gets its English version when it is shown.
  useEffect(() => {
    if (pairs && m.role === "assistant" && m.status === "done" && m.text && !m.en && !m.enState) void useChat.getState().pair(m.id);
  }, [pairs, m.role, m.status, m.text, m.en, m.enState, m.id]);
  const gap = prev ? (m.role === "user" ? "mt-6" : "mt-3") : "mt-4";

  if (m.role === "user") {
    // One shape for every turn: what was asked about, then the question; an action without words ("Explain")
    // is named at the head of the passage instead of in a bubble of its own.
    const label = actionLabel(m.action);
    const typed = m.text.trim();
    const hasContext = !!m.quotes?.length || !!m.region;
    return (
      <div className={clsx(gap, "space-y-1.5")}>
        {m.quotes?.map((q, i) => <QuoteCard key={i} q={q} label={i === 0 && !typed ? label : undefined} />)}
        {m.region && <RegionCard r={m.region} label={!typed ? label : undefined} />}
        {m.nodes && m.nodes.length > 0 && <div className="text-label text-latte">About {m.nodes.length === 1 ? `“${m.nodes[0].path.at(-1)}”` : `${m.nodes.length} map nodes`}</div>}
        {(typed || (label && !hasContext)) && (
          <div className="flex justify-end">
            <div className="max-w-[92%] rounded-2xl rounded-br-md bg-parchment/70 px-3.5 py-2 text-body text-ink">{typed || label}</div>
          </div>
        )}
      </div>
    );
  }

  const streaming = m.status === "streaming";
  const english = pairs && m.en ? m.en : undefined;
  const lastUser = [...messages].reverse().find((x) => x.role === "user" && x.createdAt <= m.createdAt);
  const retry = () => {
    if (lastUser) void send({ action: lastUser.action ?? "ask", text: lastUser.text, quotes: lastUser.quotes, region: lastUser.region, nodes: lastUser.nodes });
  };
  return (
    <div className={clsx(gap, "group/msg")}>
      {m.text ? (
        <div lang={m.lang} className={clsx("ai-text text-body text-ink-soft", streaming && "streaming")}>
          <Markdown text={m.text} pairs={english} />
        </div>
      ) : streaming ? (
        <div className="flex items-center gap-1 py-1.5" aria-label="Thinking">
          <span className="thinking-dot" />
          <span className="thinking-dot [animation-delay:150ms]" />
          <span className="thinking-dot [animation-delay:300ms]" />
        </div>
      ) : null}
      {pairs && m.status === "done" && m.text && m.enState === "loading" && (
        <div lang="en" className="mt-2 flex items-center gap-1.5 text-caption text-latte" aria-live="polite">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-latte-line" />
          Writing the English version…
        </div>
      )}
      {pairs && m.status === "done" && m.text && m.enState === "error" && (
        <button type="button" lang="en" onClick={() => void useChat.getState().pair(m.id)} className="mt-2 text-caption text-latte underline decoration-latte-line underline-offset-4 hover:text-ink">
          The English version didn&apos;t come through. Try again
        </button>
      )}
      {m.status === "error" && (
        <div className="mt-1.5 flex items-center gap-2 text-ui text-latte">
          <span>{m.error ?? "The answer didn't finish."}</span>
          {lastUser && m.error !== "Stopped." && (
            <button type="button" disabled={busy} onClick={retry} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-ink hover:bg-parchment/70">
              <RotateCcw className="h-3 w-3" /> Try again
            </button>
          )}
        </div>
      )}
      {m.status === "done" && m.text && (
        // Two actions: keep it, or more. On the newest answer they stay in view; older ones show them on hover.
        <div
          className={clsx(
            "mt-1.5 flex items-center gap-0.5 transition-opacity",
            latest ? "opacity-100" : "opacity-0 focus-within:opacity-100 group-hover/msg:opacity-100 pointer-coarse:opacity-100",
          )}
        >
          <button
            type="button"
            onClick={() => {
              if (!useUi.getState().notesOpen) useUi.getState().set({ notesOpen: true });
              useNotes.getState().addAnswer(m.text);
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-ui font-medium text-latte-deep hover:bg-parchment/70 hover:text-ink pointer-coarse:h-11"
          >
            <ListTree className="h-3.5 w-3.5" />
            Add to notes
          </button>
          <AnswerMore text={m.text} canRetry={!!lastUser} busy={busy} retry={retry} />
          {lastUser?.action === "relevance" && !research && (
            <button
              type="button"
              lang="en"
              onClick={() => useUi.getState().set({ researchOpen: "edit" })}
              className="ml-1 inline-flex h-8 items-center rounded-full px-2.5 text-ui font-medium text-paprika hover:bg-paprika-ghost pointer-coarse:h-11"
            >
              Tell the AI what you work on
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Open the language menu in the header, once whatever menu asked for it has closed. */
export function openLanguages() {
  setTimeout(() => useUi.getState().set({ langOpen: true }), 0);
}

/** The column's name in the header, with the language the AI writes in; a click opens the language menu. */
export function AiTitle() {
  const lang = useSettings((s) => s.lang);
  const pairs = usePairs();
  const name = languageByCode(lang).name;
  return (
    <div className="min-w-0 flex-1 px-1">
      <div className="truncate font-display text-body/5 text-ink">AI</div>
      <Tip label="Your language: for translations and everything the AI writes">
        <button type="button" onClick={openLanguages} className="block max-w-full truncate text-left text-caption text-latte transition-colors hover:text-ink">
          Explains in <span lang={lang}>{name}</span>
          {pairs ? " + English" : ""}
        </button>
      </Tip>
    </div>
  );
}

/** The AI column's own menu: the brief, the underlines, the language, and the list of keys. */
export function AiMenu() {
  const marks = useSettings((s) => s.marks);
  const lang = useSettings((s) => s.lang);
  const pairs = usePairs();
  const briefDone = useReader((s) => s.brief.status === "ready" || s.brief.status === "error");
  const research = useSettings((s) => s.research.trim());
  return (
    <Dropdown.Root modal={false}>
      <Tip label="More">
        <Dropdown.Trigger asChild>
          <button type="button" aria-label="More for the AI" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-latte-deep hover:bg-parchment/70 hover:text-ink data-[state=open]:bg-parchment/70">
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </Dropdown.Trigger>
      </Tip>
      <Dropdown.Portal>
        <Dropdown.Content align="end" sideOffset={6} collisionPadding={12} className={clsx(MENU, "w-[16.5rem]")} onCloseAutoFocus={(e) => e.preventDefault()}>
          <MenuItem disabled={!briefDone} hint="A fresh gist, key points and questions" onSelect={() => void useReader.getState().loadBrief({ force: true })}>
            Write the brief again
          </MenuItem>
          <MenuItem keys="K" checked={marks} onSelect={() => useSettings.getState().update({ marks: !marks })}>
            Underline the key points
          </MenuItem>
          <Dropdown.Separator className="my-1 h-px bg-latte-line/30" />
          <MenuItem hint={`${languageByCode(lang).name}${pairs ? " + English" : ""}`} onSelect={openLanguages}>
            Your language
          </MenuItem>
          <MenuItem hint={research ? research.slice(0, 60) + (research.length > 60 ? "…" : "") : "What you work on, for answers about your work"} onSelect={() => setTimeout(() => useUi.getState().set({ researchOpen: "edit" }), 0)}>
            Your research
          </MenuItem>
          <MenuItem keys="?" onSelect={() => useUi.getState().set({ shortcutsOpen: true })}>
            Keyboard shortcuts
          </MenuItem>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

const MENU = "card-in z-[90] min-w-[15rem] rounded-2xl border border-latte-line/40 bg-paper p-1.5 shadow-card-hover";

function MenuItem({ children, hint, keys, onSelect, disabled, checked }: { children: ReactNode; hint?: string; keys?: string; onSelect: () => void; disabled?: boolean; checked?: boolean }) {
  return (
    <Dropdown.Item
      disabled={disabled}
      onSelect={onSelect}
      className="flex cursor-default items-start gap-2 rounded-xl px-2.5 py-[7px] outline-none data-[disabled]:opacity-45 data-[highlighted]:bg-canvas pointer-coarse:py-3"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-ui font-medium text-ink">{children}</span>
        {hint && <span className="text-label text-latte">{hint}</span>}
      </span>
      {/* A toggle shows its state on the right, so every label lines up. */}
      {checked && <Check className="mt-[3px] h-4 w-4 shrink-0 text-paprika" aria-label="On" />}
      {keys && <span className="mt-[2px] shrink-0 text-caption text-latte">{keys}</span>}
    </Dropdown.Item>
  );
}

/** The rest of what can be done with an answer. */
function AnswerMore({ text, canRetry, busy, retry }: { text: string; canRetry: boolean; busy: boolean; retry: () => void }) {
  const [copied, setCopied] = useState(false);
  const ask = (q: string) => void useChat.getState().send({ action: "ask", text: q });
  return (
    <Dropdown.Root modal={false}>
      <Tip label={copied ? "Copied" : "More"} side="top">
        <Dropdown.Trigger asChild>
          <button type="button" aria-label="More for this answer" className="inline-flex h-8 w-8 items-center justify-center rounded-full text-latte-deep hover:bg-parchment/70 hover:text-ink data-[state=open]:bg-parchment/70 pointer-coarse:h-11 pointer-coarse:w-11">
            {copied ? <Check className="h-3.5 w-3.5" /> : <MoreHorizontal className="h-4 w-4" />}
          </button>
        </Dropdown.Trigger>
      </Tip>
      <Dropdown.Portal>
        <Dropdown.Content side="top" align="start" sideOffset={6} collisionPadding={12} className={MENU} onCloseAutoFocus={(e) => e.preventDefault()}>
          <MenuItem
            onSelect={() => {
              void navigator.clipboard?.writeText(text.replace(/\[\[[^\]]+\]\]/g, ""));
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            }}
          >
            Copy
          </MenuItem>
          <MenuItem disabled={!canRetry || busy} onSelect={retry} hint="Write this answer again">
            Try again
          </MenuItem>
          <Dropdown.Separator className="my-1 h-px bg-latte-line/30" />
          <MenuItem disabled={busy} onSelect={() => ask("Go into more detail on that, with the paper's evidence.")} hint="Go further, with the paper's evidence">
            More detail
          </MenuItem>
          <MenuItem disabled={busy} onSelect={() => ask("Explain that again more simply, in plain words.")} hint="The same, in plain words">
            Simpler
          </MenuItem>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

/** Everything the AI can do, in one place: what the paper's tools and keys do, listed where the reader asks. */
function ActionsMenu() {
  const translateAll = useReader((s) => s.translateAll);
  const ready = useReader((s) => s.textPages > 0);
  const marks = useSettings((s) => s.marks);
  const target = useSettings((s) => s.lang);
  const generating = useNotes((s) => !!s.generating);
  const name = languageByCode(target).name;
  return (
    <Dropdown.Root modal={false}>
      <Tip label="What the AI can do" side="top">
        <Dropdown.Trigger asChild>
          <button type="button" aria-label="What the AI can do" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-latte-deep transition-colors hover:bg-parchment/70 hover:text-ink data-[state=open]:bg-parchment/70 pointer-coarse:h-11 pointer-coarse:w-11">
            <Plus className="h-4 w-4" strokeWidth={2.1} />
          </button>
        </Dropdown.Trigger>
      </Tip>
      <Dropdown.Portal>
        <Dropdown.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className={clsx(MENU, "quiet-scroll max-h-[var(--radix-dropdown-menu-content-available-height)] w-[19rem] overflow-y-auto")}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <MenuItem keys="R" hint="Drag from the blank space beside it in the paper" onSelect={() => useReader.getState().setTool("box")}>
            Box a figure, table or formula
          </MenuItem>
          <MenuItem keys="E" hint="Select it in the paper, then choose Explain" onSelect={() => useReader.getState().setNotice("Select a passage in the paper, then choose Explain.")}>
            Explain a passage
          </MenuItem>
          <MenuItem keys="⇧ T" disabled={!ready} hint={translateAll ? "Back to the paper as written" : `Into ${name}, in place`} onSelect={() => useReader.getState().setTranslateAll(!translateAll)}>
            {translateAll ? "Show the original" : "Translate the whole paper"}
          </MenuItem>
          <MenuItem keys="K" checked={marks} onSelect={() => useSettings.getState().update({ marks: !marks })}>
            Underline the key points
          </MenuItem>
          <MenuItem disabled={generating || !ready} hint="AI drafts it from the paper, in your notes" onSelect={draftMindMap}>
            Draft a mind map
          </MenuItem>
          <Dropdown.Separator className="my-1 h-px bg-latte-line/30" />
          <Dropdown.Label className="px-2.5 pb-1 pt-1.5 text-caption font-medium text-latte">About the whole paper</Dropdown.Label>
          {PAPER_ASKS.map((a) => (
            <MenuItem key={a.action} disabled={!ready} hint={a.hint} onSelect={() => askPaper(a.action)}>
              {a.label}
            </MenuItem>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

function Composer() {
  const [text, setText] = useState("");
  const quotes = useChat((s) => s.quotes);
  const region = useChat((s) => s.region);
  const busy = useChat((s) => s.busy);
  const focusKey = useChat((s) => s.focusKey);
  const send = useChat((s) => s.send);
  const stop = useChat((s) => s.stop);
  const removeQuote = useChat((s) => s.removeQuote);
  const setRegion = useChat((s) => s.setRegion);
  // Notes travel with a question only when the reader chose "Ask about it" on them; selecting a node to edit it
  // doesn't change this column.
  const nodes = useChat((s) => s.nodes);
  const setNodes = useChat((s) => s.setNodes);
  const ready = useReader((s) => s.textPages > 0);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Take a suggested question ("Ask about it" on a node) once, then let the reader edit it.
  useEffect(
    () =>
      useChat.subscribe((s) => {
        if (s.draft === null) return;
        setText(s.draft);
        useChat.getState().setDraft(null);
      }),
    [],
  );
  useEffect(() => {
    if (!focusKey) return;
    const el = ref.current;
    el?.focus();
    if (el) el.setSelectionRange(el.value.length, el.value.length);
  }, [focusKey]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const canSend = ready && (text.trim().length > 0 || quotes.length > 0 || !!region);
  const submit = () => {
    if (!canSend) return;
    void send({ action: region ? "region-ask" : "ask", text: text.trim(), quotes, region: region ?? undefined, nodes });
    setText("");
  };

  return (
    <div className="shrink-0 px-3 pb-3">
      <div className="rounded-2xl border border-latte-line/50 bg-paper shadow-card transition-shadow focus-within:border-latte-line/80 focus-within:shadow-card-hover">
        {(quotes.length > 0 || region || nodes.length > 0) && (
          <div className="flex flex-wrap gap-1.5 px-2.5 pt-2.5">
            {quotes.map((q, i) => (
              <span key={i} className="inline-flex max-w-full items-center gap-1 rounded-lg bg-champagne-tint py-1 pl-2 pr-1 text-label text-ink-soft ring-1 ring-champagne/60">
                <span className="tabular shrink-0 text-latte">p.{q.page}</span>
                <span className="min-w-0 truncate">{q.text}</span>
                <button type="button" aria-label="Remove" onClick={() => removeQuote(i)} className="shrink-0 rounded p-0.5 text-latte hover:text-ink">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {region && (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-canvas py-1 pl-1 pr-1 text-label text-ink-soft ring-1 ring-latte-line/40">
                {region.thumb && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={region.thumb} alt="" className="h-6 max-w-[48px] rounded bg-white object-contain" />
                )}
                <span className="tabular text-latte">p.{region.page}</span>
                <span>Selected area</span>
                <button type="button" aria-label="Remove" onClick={() => setRegion(null)} className="rounded p-0.5 text-latte hover:text-ink">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {nodes.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-sage/25 py-1 pl-2 pr-1 text-label text-sage-text ring-1 ring-sage/50">
                <ListTree className="h-3 w-3" />
                <span className="max-w-[200px] truncate">{nodes.length === 1 ? `“${nodes[0].path.at(-1)}”` : `${nodes.length} nodes selected`}</span>
                <button type="button" aria-label="Don't include" onClick={() => setNodes([])} className="rounded p-0.5 opacity-70 hover:opacity-100">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
          </div>
        )}
        <div className="flex items-end gap-1.5 p-2">
          <ActionsMenu />
          <textarea
            ref={ref}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={quotes.length || region ? "Ask about the selection…" : "Ask about this paper…"}
            className="quiet-scroll max-h-[12.5rem] min-h-[26px] flex-1 resize-none bg-transparent py-[3px] text-body text-ink outline-none placeholder:text-latte/80"
          />
          {busy ? (
            <Tip label="Stop">
              <button type="button" onClick={stop} aria-label="Stop" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-paper hover:bg-ink-soft">
                <Square className="h-3 w-3 fill-current" />
              </button>
            </Tip>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              aria-label="Send"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-paprika text-white transition-colors hover:bg-paprika-soft disabled:bg-parchment disabled:text-latte"
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2.2} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
