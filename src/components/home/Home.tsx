"use client";
import clsx from "clsx";
import { ArrowRight, FileText, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import { type DragEvent, type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useLibrary } from "@/lib/store/library";

function timeAgo(t: number): string {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export default function Home() {
  const papers = useLibrary((s) => s.papers);
  const busy = useLibrary((s) => s.busy);
  const error = useLibrary((s) => s.error);
  const { addFile, addFromUrl, open, remove } = useLibrary.getState();
  const [dragging, setDragging] = useState(false);
  const [link, setLink] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const depth = useRef(0);

  const onFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).filter((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
      if (!list.length) {
        useLibrary.setState({ error: "Only PDF files for now." });
        return;
      }
      // Several files: add them all, open the first.
      let first: string | null = null;
      for (const f of list) {
        const id = await addFile(f);
        first ??= id;
      }
      if (first) open(first);
    },
    [addFile, open],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        input.current?.click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onDragEnter = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    depth.current += 1;
    setDragging(true);
  };
  const onDragLeave = () => {
    depth.current = Math.max(0, depth.current - 1);
    if (!depth.current) setDragging(false);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    if (e.dataTransfer.files.length) void onFiles(e.dataTransfer.files);
  };
  const onLink = async (e: FormEvent) => {
    e.preventDefault();
    if (!link.trim()) return;
    const id = await addFromUrl(link.trim());
    if (id) setLink("");
  };

  return (
    <div
      className="relative min-h-dvh overflow-x-hidden bg-canvas"
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 45% at 50% 0%, rgba(233,167,82,0.10), transparent 65%), radial-gradient(ellipse 50% 40% at 85% 85%, rgba(166,209,230,0.10), transparent 70%)",
        }}
      />
      <header className="relative mx-auto flex h-[72px] max-w-6xl items-center gap-2.5 px-8">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-paprika shadow-card" aria-hidden>
          <span className="font-display text-heading font-semibold leading-none text-paper">R</span>
        </span>
        <span className="font-display text-title font-semibold text-ink">ReadLit</span>
      </header>

      <main className="relative mx-auto max-w-6xl px-8 pb-24">
        <section className="mx-auto mt-12 max-w-2xl text-center">
          <h1 className="font-display text-display font-semibold text-ink">
            Read any paper, <em className="font-normal italic text-latte-deep">in place</em>.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-body leading-7 text-latte">
            Translate a passage right where it sits. Ask about any paragraph or figure. Keep your notes, and a mind map of the paper, beside it.
          </p>
        </section>

        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mx-auto mt-10 max-w-2xl"
        >
          <button
            type="button"
            onClick={() => input.current?.click()}
            className={clsx(
              "group flex w-full flex-col items-center rounded-2xl border-[1.5px] border-dashed px-8 py-12 text-center transition-colors duration-200",
              dragging ? "border-paprika bg-paprika-ghost" : "border-latte-line bg-paper/80 hover:border-latte hover:bg-paper",
            )}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-champagne-tint text-latte-deep">
              <FileText size={22} strokeWidth={1.5} />
            </span>
            <span className="mt-4 font-display text-title font-medium text-ink">
              {busy ? "Opening…" : dragging ? "Drop to open" : "Drop a PDF here"}
            </span>
            <span className="mt-1.5 text-ui text-latte">
              or <span className="text-ink underline decoration-latte-line underline-offset-4 group-hover:decoration-latte">choose a file</span> · ⌘O
            </span>
          </button>
          <input
            ref={input}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void onFiles(e.target.files);
              e.target.value = "";
            }}
          />

          <form onSubmit={onLink} className="mt-4 flex items-center gap-2 rounded-full border border-latte-line/50 bg-paper py-1 pl-5 pr-1 shadow-card focus-within:border-latte">
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="Or paste an arXiv or PDF link"
              className="h-9 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-latte/80"
              aria-label="Paper link"
            />
            <button
              type="submit"
              disabled={!link.trim() || !!busy}
              className="inline-flex h-9 items-center gap-1 rounded-full bg-ink px-4 text-ui font-medium text-paper transition-opacity disabled:opacity-30"
            >
              Open <ArrowRight size={14} />
            </button>
          </form>
          {error && <p className="mt-3 text-center text-ui text-paprika">{error}</p>}
          {!papers.length && !busy && (
            <p className="mt-4 text-center text-ui text-latte">
              No paper at hand?{" "}
              <button
                type="button"
                onClick={() => void addFromUrl("arxiv.org/abs/1706.03762")}
                className="text-ink underline decoration-latte-line underline-offset-4 hover:decoration-latte"
              >
                Try <em className="font-display">Attention Is All You Need</em>
              </button>
            </p>
          )}
        </motion.section>

        {papers.length > 0 && (
          <section className="mx-auto mt-16 max-w-4xl">
            <h2 className="mb-4 text-label font-medium text-latte">Recent</h2>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {papers.map((p) => (
                <li key={p.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => open(p.id)}
                    className="flex h-full w-full flex-col rounded-2xl border border-latte-line/40 bg-paper p-4 text-left shadow-card transition-shadow duration-200 hover:shadow-card-hover"
                  >
                    <span className="line-clamp-2 font-display text-body font-medium leading-snug text-ink">{p.title}</span>
                    {p.authors && <span className="mt-1 line-clamp-1 text-label text-latte">{p.authors}</span>}
                    <span className="mt-auto pt-3 text-label text-latte tabular">
                      {p.pages} pages · {timeAgo(p.openedAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${p.title}`}
                    onClick={() => void remove(p.id)}
                    className="absolute right-2 top-2 hidden h-7 w-7 items-center justify-center rounded-full text-latte hover:bg-parchment hover:text-ink focus-visible:flex group-hover:flex"
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
