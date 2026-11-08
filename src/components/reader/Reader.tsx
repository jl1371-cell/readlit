"use client";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import clsx from "clsx";
import { Check, ChevronDown, ChevronLeft, PanelLeft, PanelRight, ScanLine, SquarePen, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { AiMenu, AiPanel, AiTitle } from "@/components/ai/AiPanel";
import { MapZoom, NotesMenu, NotesPanel, NotesTitle, NotesViewSwitch } from "@/components/notes/NotesPanel";
import { IconButton, Kbd, Tip } from "@/components/ui/primitives";
import { LANGUAGES, languageByCode } from "@/lib/languages";
import { useChat } from "@/lib/store/chat";
import { useLibrary } from "@/lib/store/library";
import { useNotes } from "@/lib/store/notes";
import { useReader } from "@/lib/store/reader";
import { pairsWanted, useSettings } from "@/lib/store/settings";
import { useUi } from "@/lib/store/ui";
import { PaperTip } from "./PaperTip";
import { PdfViewer, viewerControls } from "./PdfViewer";
import { actionForKey, clearSelection, runSelectionAction } from "./SelectionBar";

function typingIn(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  return t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !!t.closest?.("[data-keyscope]");
}

const BOX_KEY = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "Meta" : "Control";

/** Narrowest the paper gets before the notes step aside, and before the AI column does (the brief matters more). */
const PAPER_MIN = 560;
const PAPER_MIN_WITH_AI = 440;

/**
 * Three columns under one header. The AI column on the left holds everything the AI tells you; the paper in the
 * middle holds everything that acts on the text, on the text itself; the notes column on the right holds what you
 * keep. Each column's controls sit in the header directly above it, and nothing else floats over the paper.
 */
export default function Reader({ paperId }: { paperId: string }) {
  const meta = useLibrary((s) => s.papers.find((p) => p.id === paperId));
  const aiOpen = useUi((s) => s.aiOpen);
  const notesOpen = useUi((s) => s.notesOpen);
  const aiWidth = useUi((s) => s.aiWidth);
  const notesWidth = useUi((s) => s.notesWidth);
  const mapExpanded = useUi((s) => s.mapExpanded && s.notesOpen && s.notesView === "map");

  // On a narrow window the paper gets its room first: the notes step aside, then the AI column. Each waits behind
  // its header button, nothing reopens by itself, and none of this is saved as a preference.
  useEffect(() => {
    const fit = () => {
      const ui = useUi.getState();
      const patch: { notesOpen?: boolean; aiOpen?: boolean } = {};
      let room = window.innerWidth - (ui.aiOpen ? ui.aiWidth : 0) - (ui.notesOpen && !ui.mapExpanded ? ui.notesWidth : 0);
      if (ui.notesOpen && !ui.mapExpanded && room < PAPER_MIN) {
        patch.notesOpen = false;
        room += ui.notesWidth;
      }
      if (ui.aiOpen && room < PAPER_MIN_WITH_AI) patch.aiOpen = false;
      if (patch.notesOpen === false || patch.aiOpen === false) useUi.setState(patch);
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  const compact = useCompact();

  useEffect(() => {
    void useChat.getState().load(paperId);
    void useNotes.getState().load(paperId, meta?.title ?? "");
    // Load once per paper; the title is only the map's starting root.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId]);

  // Drop another PDF anywhere on the reader to open it.
  const [dropping, setDropping] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFile = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFile(e)) return;
      depth += 1;
      setDropping(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFile(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDropping(false);
    };
    const over = (e: DragEvent) => {
      if (hasFile(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFile(e)) return;
      e.preventDefault();
      depth = 0;
      setDropping(false);
      const file = Array.from(e.dataTransfer?.files ?? []).find((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
      if (file) void useLibrary.getState().addFile(file);
      else useReader.getState().setNotice("Only PDF files for now.");
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [setDropping]);

  // Reader-wide keys. Single letters act only when the reader isn't typing and the map doesn't have focus.
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      const r = useReader.getState();
      if (e.key === "Alt" && !e.repeat && !typingIn(e.target)) {
        r.setPeek(true);
        return;
      }
      // Holding ⌘ (Ctrl elsewhere) boxes from anywhere. On a Mac, Control-click is a right-click, so it never boxes.
      if (e.key === BOX_KEY && !typingIn(e.target)) {
        r.setBoxArmed(true);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        if (e.key === "=" || e.key === "+") {
          e.preventDefault();
          viewerControls.zoomBy(1.15);
        } else if (e.key === "-") {
          e.preventDefault();
          viewerControls.zoomBy(1 / 1.15);
        } else if (e.key === "0") {
          e.preventDefault();
          viewerControls.fitWidth();
        }
        return;
      }
      if (e.altKey || e.metaKey || e.ctrlKey || typingIn(e.target) || e.isComposing) return;
      if (e.key === "Escape") {
        if (r.tool === "box") r.setTool("select");
        if (r.selection) clearSelection();
        if (useUi.getState().shortcutsOpen) useUi.getState().set({ shortcutsOpen: false });
        return;
      }
      if (r.selection) {
        const action = actionForKey(r.selection, e.key);
        if (action) {
          e.preventDefault();
          void runSelectionAction(action);
          return;
        }
      }
      if (e.key === "T" && e.shiftKey) {
        e.preventDefault();
        setTranslateAll(!r.translateAll);
      } else if (e.key === "r" || e.key === "b") {
        e.preventDefault();
        r.setTool(r.tool === "box" ? "select" : "box");
      } else if (e.key === "k") {
        useSettings.getState().update({ marks: !useSettings.getState().marks });
      } else if (e.key === "?") {
        useUi.getState().set({ shortcutsOpen: !useUi.getState().shortcutsOpen });
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === "Alt") useReader.getState().setPeek(false);
      if (e.key === BOX_KEY) useReader.getState().setBoxArmed(false);
    };
    const onBlur = () => {
      useReader.getState().setPeek(false);
      useReader.getState().setBoxArmed(false);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      {/* One header, three cells: each names the column under it and holds that column's controls. */}
      <header className="relative z-20 flex h-[52px] shrink-0 border-b border-latte-line/40 bg-paper/75 backdrop-blur-[12px]">
        {aiOpen && (
          <div className="flex shrink-0 items-center gap-1 border-r border-latte-line/30 pl-2 pr-2" style={{ width: aiWidth }}>
            <HomeButton />
            <AiToggle />
            <AiTitle />
            <ClearChat />
            <AiMenu />
          </div>
        )}
        <div className={clsx("flex min-w-0 items-center gap-2 px-3", mapExpanded ? "w-[460px] shrink-0" : "flex-1")}>
          {!aiOpen && (
            <>
              <HomeButton />
              <AiOpener compact={compact} />
              <span className="mx-1 h-5 w-px shrink-0 bg-latte-line/50" aria-hidden />
            </>
          )}
          <PaperTitle title={meta?.title ?? ""} authors={meta?.authors ?? ""} />
          <BoxButton compact={mapExpanded || compact} />
          <PageZoom compact={mapExpanded || compact} />
          <LanguageSwitch />
          {!notesOpen && <NotesOpener compact={compact} />}
        </div>
        {notesOpen && (
          <div className={clsx("flex items-center gap-1.5 border-l border-latte-line/30 pl-3.5 pr-2", mapExpanded ? "min-w-0 flex-1" : "shrink-0")} style={mapExpanded ? undefined : { width: notesWidth }}>
            <NotesTitle />
            <NotesViewSwitch />
            <div className="min-w-0 flex-1" />
            <MapZoom />
            <NotesMenu />
            <NotesToggle />
          </div>
        )}
      </header>
      <div className="relative flex min-h-0 flex-1">
        {aiOpen && (
          <>
            <aside className="min-h-0 shrink-0 border-r border-latte-line/30 bg-paper" style={{ width: aiWidth }}>
              <AiPanel />
            </aside>
            <ResizeHandle side="left" />
          </>
        )}
        <main className={clsx("relative min-w-0", mapExpanded ? "w-[460px] shrink-0" : "flex-1")}>
          <PdfViewer paperId={paperId} />
          <PaperTip />
        </main>
        {notesOpen && (
          <>
            {!mapExpanded && <ResizeHandle side="right" />}
            <aside className={clsx("min-h-0 border-l border-latte-line/30 bg-paper", mapExpanded ? "min-w-0 flex-1" : "shrink-0")} style={mapExpanded ? undefined : { width: notesWidth }}>
              <NotesPanel />
            </aside>
          </>
        )}
      </div>
      <Notice />
      <ShortcutSheet />
      {dropping && (
        <div className="pointer-events-none fixed inset-0 z-[96] flex items-center justify-center bg-paper/70 backdrop-blur-[2px]">
          <div className="card-in rounded-3xl border-2 border-dashed border-paprika/50 bg-paper px-10 py-8 text-center shadow-card-hover">
            <p className="font-display text-title text-ink">Drop to open this paper</p>
            <p className="mt-1 text-ui text-latte">It joins your library; this one stays where you left it.</p>
          </div>
        </div>
      )}
    </div>
  );
}

let peekHinted = false;

/** Whole-paper translation on or off; the first time it goes on, say how to see the original. */
function setTranslateAll(on: boolean) {
  const r = useReader.getState();
  r.setTranslateAll(on);
  if (on && !peekHinted) {
    peekHinted = true;
    r.setNotice("Translating the paper as you read. Hold ⌥ to see the original.");
  }
}

function HomeButton() {
  return (
    <Tip label="All papers">
      <IconButton aria-label="All papers" onClick={() => useLibrary.getState().close()}>
        <ChevronLeft className="h-[18px] w-[18px]" />
      </IconButton>
    </Tip>
  );
}

function AiToggle() {
  return (
    <Tip label="Hide the AI column">
      <IconButton aria-label="Hide the AI column" aria-pressed onClick={() => useUi.getState().set({ aiOpen: false })}>
        <PanelLeft className="h-4 w-4" />
      </IconButton>
    </Tip>
  );
}

/** With the AI column closed, its button says what it is, like the notes button on the other side. */
function AiOpener({ compact }: { compact?: boolean }) {
  return (
    <Tip label="The brief and answers">
      <button
        type="button"
        aria-label="Show the AI column"
        onClick={() => useUi.getState().set({ aiOpen: true })}
        className={clsx(
          "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full text-ui font-medium text-latte-deep transition-colors hover:bg-parchment/70 hover:text-ink",
          compact ? "w-8 justify-center" : "pl-2.5 pr-3",
        )}
      >
        <PanelLeft className="h-4 w-4" />
        {!compact && "AI"}
      </button>
    </Tip>
  );
}

function NotesToggle() {
  return (
    <Tip label="Hide notes">
      <IconButton aria-label="Hide notes" aria-pressed onClick={() => useUi.getState().set({ notesOpen: false })}>
        <PanelRight className="h-4 w-4" />
      </IconButton>
    </Tip>
  );
}

/** Small windows: header buttons keep their icons and lose their labels. */
function useCompact(): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(max-width: 900px)");
    const on = () => setCompact(q.matches);
    on();
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return compact;
}

/** With the notes column closed, its button says what it is: the place everything kept goes. */
function NotesOpener({ compact }: { compact?: boolean }) {
  return (
    <Tip label="Your notes and mind map">
      <button
        type="button"
        aria-label="Show notes"
        onClick={() => useUi.getState().set({ notesOpen: true })}
        className={clsx(
          "ml-1 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full text-ui font-medium text-latte-deep transition-colors hover:bg-parchment/70 hover:text-ink",
          compact ? "w-8 justify-center" : "pl-3 pr-2.5",
        )}
      >
        {!compact && "Notes"}
        <PanelRight className="h-4 w-4" />
      </button>
    </Tip>
  );
}

/** Start over: the last conversation is set aside with Undo, never deleted outright. */
function ClearChat() {
  const any = useChat((s) => s.messages.length > 0);
  if (!any) return null;
  return (
    <Tip label="New chat">
      <IconButton aria-label="New chat" onClick={() => useChat.getState().newChat()}>
        <SquarePen className="h-4 w-4" />
      </IconButton>
    </Tip>
  );
}

/** The middle cell's name is the paper's own, in the same type as the other two columns' names. */
function PaperTitle({ title, authors }: { title: string; authors: string }) {
  const names = authors.split(/\s*(?:,|;| and )\s*/).filter(Boolean);
  const byline = names.length > 2 ? `${names[0]} et al.` : names.join(" and ");
  return (
    <div className="min-w-0 flex-1" title={title}>
      <h1 className={clsx("truncate font-display text-ink", byline ? "text-body/5" : "text-body")}>{title}</h1>
      {byline && <div className="truncate text-caption text-latte">{byline}</div>}
    </div>
  );
}

function BoxButton({ compact }: { compact?: boolean }) {
  const tool = useReader((s) => s.tool);
  const on = tool === "box";
  return (
    <Tip label={on ? "Drag over a figure, table or formula" : "Box a figure, table or formula. Dragging from the blank space beside it works too."} keys="R">
      <button
        type="button"
        aria-pressed={on}
        aria-label="Box a figure"
        onClick={() => useReader.getState().setTool(on ? "select" : "box")}
        className={clsx(
          "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full text-ui font-medium transition-colors",
          compact ? "w-8 justify-center" : "pl-2.5 pr-3",
          on ? "bg-paprika text-white" : "text-latte-deep hover:bg-parchment/70 hover:text-ink",
        )}
      >
        <ScanLine className="h-4 w-4" />
        {!compact && "Box a figure"}
      </button>
    </Tip>
  );
}

function MenuRow({ children, keys, onSelect, checked }: { children: ReactNode; keys?: string; onSelect: () => void; checked?: boolean }) {
  return (
    <Dropdown.Item onSelect={onSelect} className="flex h-9 cursor-default items-center gap-2 rounded-lg px-2.5 text-ui text-ink outline-none data-[highlighted]:bg-canvas">
      <span className="flex h-4 w-4 items-center justify-center">{checked && <Check className="h-4 w-4 text-paprika" />}</span>
      <span className="flex-1">{children}</span>
      {keys && <span className="text-caption text-latte">{keys}</span>}
    </Dropdown.Item>
  );
}

/** Where you are and how big: page and zoom in one small control; the menu also jumps to a page. */
function PageZoom({ compact }: { compact?: boolean }) {
  const scale = useReader((s) => s.scale);
  const current = useReader((s) => s.currentPage);
  const pages = useReader((s) => s.sizes.length);
  const [goto, setGoto] = useState("");
  return (
    <Dropdown.Root onOpenChange={(open) => open && setGoto("")}>
      <Tip label="Page and zoom">
        <Dropdown.Trigger asChild>
          <button
            type="button"
            className="tabular inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full pl-2.5 pr-2 text-ui font-medium text-latte-deep hover:bg-parchment/70 hover:text-ink data-[state=open]:bg-parchment/70"
          >
            {pages > 0 && !compact && (
              <>
                <span>
                  {current} / {pages}
                </span>
                <span className="h-3.5 w-px bg-latte-line/60" aria-hidden />
              </>
            )}
            <span>{Math.round(scale * 100)}%</span>
            <ChevronDown className="h-3.5 w-3.5 text-latte" />
          </button>
        </Dropdown.Trigger>
      </Tip>
      <Dropdown.Portal>
        <Dropdown.Content align="end" sideOffset={6} className="card-in z-[70] w-[15rem] rounded-2xl border border-latte-line/40 bg-paper p-1.5 shadow-card-hover">
          {pages > 0 && (
            <form
              className="flex items-center gap-2 px-2.5 py-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                const n = Math.round(Number(goto));
                if (n >= 1 && n <= pages) viewerControls.scrollToPage(n);
              }}
            >
              <span className="text-ui text-ink">Go to page</span>
              <input
                value={goto}
                onChange={(e) => setGoto(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => e.stopPropagation()}
                inputMode="numeric"
                placeholder={String(current)}
                aria-label="Page number"
                className="tabular h-8 w-12 rounded-lg bg-canvas px-2 text-center text-ui text-ink outline-none ring-1 ring-latte-line/50 focus:ring-latte"
              />
              <span className="tabular text-caption text-latte">of {pages}</span>
            </form>
          )}
          <Dropdown.Separator className="my-1 h-px bg-latte-line/30" />
          <MenuRow keys="⌘ +" onSelect={() => viewerControls.zoomBy(1.15)}>
            Zoom in
          </MenuRow>
          <MenuRow keys="⌘ −" onSelect={() => viewerControls.zoomBy(1 / 1.15)}>
            Zoom out
          </MenuRow>
          <MenuRow keys="⌘ 0" onSelect={() => viewerControls.fitWidth()}>
            Fit to width
          </MenuRow>
          <MenuRow onSelect={() => viewerControls.zoomBy(1 / useReader.getState().scale)}>Actual size</MenuRow>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

/** One sentence in each language, to show what the choice will look like before it is made (no AI call). */
const PREVIEW: Record<string, string> = {
  "zh-Hans": "自注意力让每个词都能直接看到句子里的其他词。",
  "zh-Hant": "自注意力讓每個詞都能直接看到句子裡的其他詞。",
  ja: "自己注意機構により、各単語が文中の他の単語を直接参照できる。",
  ko: "셀프 어텐션은 각 단어가 문장의 다른 단어를 직접 참조하게 한다.",
  en: "Self-attention lets each word look directly at every other word in the sentence.",
  es: "La autoatención permite que cada palabra atienda directamente a las demás de la frase.",
  fr: "L'auto-attention permet à chaque mot de tenir compte directement des autres mots de la phrase.",
  de: "Self-Attention lässt jedes Wort direkt auf die anderen Wörter im Satz achten.",
  pt: "A autoatenção permite que cada palavra considere diretamente as demais da frase.",
  ru: "Механизм самовнимания позволяет каждому слову напрямую учитывать остальные слова предложения.",
};

/**
 * The reader's language, at the top of the reader: Original ⇄ translation for the whole paper, and under ▾ the one
 * language setting. The paper is translated into it and everything the AI writes is written in it, with English under
 * each paragraph if the reader wants it.
 */
function LanguageSwitch() {
  const translateAll = useReader((s) => s.translateAll);
  const code = useSettings((s) => s.lang);
  const open = useUi((s) => s.langOpen);
  const lang = languageByCode(code);
  return (
    <div className="flex shrink-0 items-center rounded-full bg-canvas/80 p-[3px] ring-1 ring-latte-line/40">
      <Tip label="The paper as written">
        <button
          type="button"
          onClick={() => setTranslateAll(false)}
          className={clsx("h-7 rounded-full px-3 text-ui font-medium transition-colors", !translateAll ? "bg-paper text-ink shadow-card" : "text-latte-deep hover:text-ink")}
        >
          Original
        </button>
      </Tip>
      <Tip label={`Translate the paper into ${lang.english}, in place. Hold ⌥ to see the original.`} keys="⇧T">
        <button
          type="button"
          lang={lang.code}
          onClick={() => setTranslateAll(true)}
          className={clsx("h-7 rounded-full pl-3 pr-2.5 text-ui font-medium transition-colors", translateAll ? "bg-paper text-ink shadow-card" : "text-latte-deep hover:text-ink")}
        >
          {lang.name}
        </button>
      </Tip>
      <Popover.Root open={open} onOpenChange={(o) => useUi.getState().set({ langOpen: o })}>
        <Tip label="Your language">
          <Popover.Trigger asChild>
            <button type="button" aria-label="Your language" className="flex h-7 w-7 items-center justify-center rounded-full text-latte transition-colors hover:text-ink data-[state=open]:bg-paper data-[state=open]:text-ink">
              <ChevronDown className="h-4 w-4" />
            </button>
          </Popover.Trigger>
        </Tip>
        <Popover.Portal>
          <Popover.Content align="end" sideOffset={10} collisionPadding={12} className="card-in z-[70] w-[21rem] rounded-3xl border border-latte-line/40 bg-paper p-4 shadow-card-hover">
            <LanguagePanel />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

function LanguagePanel() {
  const code = useSettings((s) => s.lang);
  const bilingual = useSettings((s) => s.bilingual);
  const update = useSettings((s) => s.update);
  const [hover, setHover] = useState<string | null>(null);
  const shown = hover ?? code;
  const english = shown.startsWith("en");
  const choose = (next: string) => {
    if (next === code) return;
    update({ lang: next });
    void useReader.getState().reloadTranslations();
    void useReader.getState().loadBrief({ force: true });
  };
  const setBilingual = (on: boolean) => {
    update({ bilingual: on });
    if (on && pairsWanted()) void useReader.getState().pairBrief();
  };
  const name = languageByCode(code).name;
  return (
    <div>
      <h2 className="font-display text-heading text-ink">Your language</h2>
      <p className="mt-0.5 text-label text-latte">The paper is translated into it, and everything the AI writes is in it.</p>
      <div className="mt-3 grid grid-cols-2 gap-1" role="radiogroup" aria-label="Your language" onPointerLeave={() => setHover(null)}>
        {LANGUAGES.map((l) => {
          const on = l.code === code;
          return (
            <button
              key={l.code}
              type="button"
              role="radio"
              aria-checked={on}
              lang={l.code}
              title={l.english}
              onClick={() => choose(l.code)}
              onPointerEnter={() => setHover(l.code)}
              onFocus={() => setHover(l.code)}
              onBlur={() => setHover(null)}
              className={clsx(
                "flex h-9 items-center justify-between rounded-xl px-3 text-left text-ui transition-colors pointer-coarse:h-11",
                on ? "bg-parchment/80 font-medium text-ink" : "text-ink-soft hover:bg-canvas",
              )}
            >
              {l.name}
              {on && <Check className="h-4 w-4 text-paprika" aria-hidden />}
            </button>
          );
        })}
      </div>
      <div className="mt-3 rounded-2xl bg-canvas/80 px-3.5 py-3 ring-1 ring-latte-line/30" aria-live="polite">
        <p lang={shown} className="ai-text text-body-sm text-ink-soft">
          {PREVIEW[shown] ?? PREVIEW.en}
        </p>
        {!english && bilingual && (
          <p lang="en" className="pair text-label">
            {PREVIEW.en}
          </p>
        )}
      </div>
      {!code.startsWith("en") && (
        <button type="button" role="switch" aria-checked={bilingual} onClick={() => setBilingual(!bilingual)} className="mt-3 flex w-full items-start gap-3 rounded-xl px-1 py-1 text-left">
          <span className="min-w-0 flex-1">
            <span className="block text-ui font-medium text-ink">English under each paragraph</span>
            <span className="block text-label text-latte">Answers, the brief and the mind map, each with the same text in English below it.</span>
          </span>
          <span className={clsx("relative mt-0.5 inline-flex h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200", bilingual ? "bg-paprika" : "bg-latte-line/60")}>
            <span className={clsx("absolute top-[3px] h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200", bilingual ? "translate-x-[19px]" : "translate-x-[3px]")} />
          </span>
        </button>
      )}
      <p className="mt-3 border-t border-latte-line/30 pt-3 text-caption text-latte">
        Ask in any language; answers stay in <span lang={code}>{name}</span>.
      </p>
    </div>
  );
}

function ResizeHandle({ side }: { side: "left" | "right" }) {
  const start = useRef<{ x: number; w: number } | null>(null);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      className="group relative z-10 -mx-[3px] w-[6px] shrink-0 cursor-col-resize"
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const ui = useUi.getState();
        start.current = { x: e.clientX, w: side === "left" ? ui.aiWidth : ui.notesWidth };
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const dx = e.clientX - start.current.x;
        if (side === "left") useUi.getState().set({ aiWidth: Math.max(300, Math.min(560, start.current.w + dx)) });
        else useUi.getState().set({ notesWidth: Math.max(340, Math.min(760, start.current.w - dx)) });
      }}
      onPointerUp={() => (start.current = null)}
    >
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-paprika/40" />
    </div>
  );
}

function Notice() {
  const notice = useReader((s) => s.notice);
  const setNotice = useReader((s) => s.setNotice);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice, setNotice]);
  if (!notice) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[90] flex justify-center px-4">
      <div role="status" className="card-in pointer-events-auto flex max-w-[34rem] items-center gap-3 rounded-2xl border border-latte-line/40 bg-paper px-4 py-2.5 text-ui text-ink shadow-card-hover">
        <span>{notice}</span>
        <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="rounded-full p-1 text-latte hover:bg-parchment/70 hover:text-ink">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

const SHORTCUTS: { group: string; rows: [string, string][] }[] = [
  {
    group: "With text selected",
    rows: [
      ["T", "Translate in place"],
      ["E", "Explain"],
      ["S", "Summarize"],
      ["A", "Ask about it"],
      ["N", "Note: mark it and keep it"],
    ],
  },
  {
    group: "Reading",
    rows: [
      ["R or ⌘ drag", "Box a figure or formula (or drag from blank space)"],
      ["⇧T", "Translate the paper"],
      ["⌥ hold", "See the original"],
      ["K", "Underline key points"],
      ["⌘ + / −", "Zoom"],
      ["?", "This sheet"],
    ],
  },
  {
    group: "Notes and mind map",
    rows: [
      ["Tab", "Add a child"],
      ["Enter", "Add a sibling"],
      ["Space", "Edit"],
      ["⌫", "Delete branch"],
      ["⌘ /", "Fold"],
      ["⌘ Z", "Undo"],
    ],
  },
];

function ShortcutSheet() {
  const open = useUi((s) => s.shortcutsOpen);
  const set = useUi((s) => s.set);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-ink/10 backdrop-blur-[2px]" onClick={() => set({ shortcutsOpen: false })}>
      <div className="card-in w-[min(680px,92vw)] rounded-3xl border border-latte-line/40 bg-paper p-6 shadow-card-hover" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-title font-medium">Keyboard shortcuts</h2>
          <IconButton aria-label="Close" onClick={() => set({ shortcutsOpen: false })}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          {SHORTCUTS.map((g) => (
            <div key={g.group}>
              <div className="mb-2 text-label font-medium text-latte">{g.group}</div>
              <ul className="space-y-1.5">
                {g.rows.map(([k, label]) => (
                  <li key={k} className="flex items-center justify-between gap-3 text-ui text-ink-soft">
                    <span>{label}</span>
                    <Kbd>{k}</Kbd>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
