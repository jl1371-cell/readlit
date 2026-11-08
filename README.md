# ReadLit

Read any research paper in place. Drop in a PDF and a short brief tells you what the paper claims, how, and with what evidence, each point one click from its sentence. Select a sentence and it is translated where it sits. Ask about a paragraph or a figure without copying anything into a chat. Keep notes beside the paper, and see them as a mind map.

> Built for the 4th Triangle AI Hackathon (Duke, Nov 6–8, 2026), from scratch in this repository. It shares MapLit's design system, so it can later move into MapLit unchanged.

## One screen, three columns

| Left: **AI** | Middle: **the paper** | Right: **notes** |
|---|---|---|
| Everything the AI tells you. The brief first, then every explanation, summary and answer, as one conversation. One composer. | Everything that acts on the text happens on the text: in-place translation, the selection bar, boxing a figure, key-point underlines, highlights. | Everything you keep. One tree of notes, seen as an **Outline** or as a **Mind map**. Excerpts, your own lines and AI drafts live together. |

Each column's name sits in the header directly above it (**AI**, the paper's title, **Notes**), with that column's controls beside it, and nothing floats over the paper. A first visit shows all three columns whenever the paper still gets 680 px; on a smaller window the notes wait behind their header button, and from then on your own choice is kept.

## What it does

**The brief (left, when a paper opens)**
- The gist in one or two sentences, with citations, each finding kept to the conditions it was tested under.
- A first-pass datasheet: what kind of paper it is and on what evidence; what is new against the earlier work it names; its claim, method, result and limit; and the figure or table to look at first. Every row goes to its sentence.
- One line each for the key claim, method, result and an admitted limitation, restated in your language and linked to its sentence; "Show all" lists the rest. With K, the same points are underlined in the paper in the same colours.
- Three questions to read with, each with a page chip to where the paper answers it.

**Reading (middle)**
- PDF only for now: drop a file, choose one, or paste an arXiv / OpenReview / PDF link.
- Select text and a small bar appears under it with four actions: Translate, Explain (Summarize for longer passages), Ask, and Note. Single keys: T, E or S, A, N.
- Note marks the passage in the paper and keeps it in the notes with its page, in one step.
- One or two words get a small card with the meaning in this paper's context instead of a full translation.
- Box any area by dragging from the blank space beside it: a figure, a table, a formula. A drag that starts on text selects the text instead, and the cursor shows which before you press (a crosshair where a drag would box). R, the **Box a figure** button or holding ⌘ box from anywhere. Translate the text inside a box in place (text drawn inside images is read with vision), or ask about it.

**Your language**
- One setting, under the ▾ beside the header's Original / 简体中文 switch: the paper is translated into it, and everything the AI writes (the brief, explanations, answers, the mind map) is written in it, whatever language you type your question in.
- With *English under each paragraph* (on by default), every paragraph, list item and key point the AI writes carries its English version underneath, one step quieter. The English is a translation of the finished text, so the two never disagree. The AI column's title says it: "Explains in 简体中文 + English".

**In-place translation**
- The translation replaces the original text at the same position, sentence by sentence. Translate one sentence and the rest of the paragraph stays as written; switch the header to your language and every paragraph fills in as it is ready.
- The first time a key technical term appears in a passage, the original term follows in parentheses, so you learn the term used in the literature.
- The original is covered with an opaque patch sampled from the page's own colour, never a see-through overlay.
- Text follows the paper's face (serif papers get a serif CJK face), starts just under the paper's size, tightens the leading before shrinking, and never goes below 80% of the starting size. Anything that still does not fit grows into the free space below, then folds behind "More".
- Hold ⌥ to see the original; hover a translated paragraph to switch just that one back.
- Headers, footers, page numbers, author blocks, equations and reference lists are left alone.

**Answers (left)**
- Explain and Summarize results arrive as cards that show what was asked about.
- Several passages can be queued above the composer for one question.
- Answers cite the sentences they rely on as small page chips. Resting the pointer on one marks the sentence in the paper; a click jumps there and flashes it, and a "Back" pill returns to where you were.
- Each answer has two actions: *Add to notes* (a list in the answer becomes a branch) and ⋯ (Copy, Try again, More detail, Simpler).
- The "+" in the composer lists everything the AI can do, each with its key. *New chat* keeps the last conversation one click away (Undo).
- Five asks of the whole paper, under "Go deeper" and in the "+": *Walk through*, *Weak points* (what the authors admit, what a reviewer would ask, what couldn't be checked), *Connections* (what it builds on; the real papers that cite it, from OpenAlex), *For my work*, *Ideas* (each with a first test and its main risk; novelty not checked). Typed questions of the same kinds get the same shape.
- Every statement shows its source: a page chip for the paper, "Beyond the paper" for the AI's general knowledge, "Cited by · OpenAlex" for real citation data. The AI never invents a reference from memory.
- *Your research* (AI ⋯): a sentence or two on what you work on, kept on your device, so answers about what a paper means for you fit your own work.

**Notes and mind map (right)**
- One tree, two views, all by click or tap. Select a node: "+" on its edges adds *inside* (a child) or *after* (the next one); ✨ grows it with AI (or breaks a kept passage into its points); ⋯ holds the rest (Move ↑ ↓ → ←, Fold, Show in the paper, Translate, Delete). Click a selected node again to write in it. Deleting, discarding and moving show Undo.
- Keys do the same, faster: Tab adds inside, Enter adds after, typing replaces the text, Space edits, ⌫ deletes, ⌘/ folds, ⌘Z undoes. Drag a node onto another to move its branch (with a mouse; on touch a finger pans).
- Drag a sentence from the paper onto a branch or a line to keep it there, with its page.
- **Draft a mind map** is the empty notes column's main button (while the notes are closed, the same button waits above the composer). AI first recognises the kind of paper and draws its line of argument (for a method paper: problem → why existing approaches fall short → key idea → how it works → evidence → limits → what it enables), each main branch a short statement rather than a section title, then fills each one in parallel, every node with its source. The map opens wide, folded to its main branches; unfold a branch to read on.
- Nodes are bilingual: your language first, the paper's own words underneath (following *English under each paragraph*).
- Everything AI writes arrives as a dashed draft: keep it, discard it, or redraft it (*Keep all · Redraft · Discard all*); Stop ends a round and keeps what arrived. Touching anything inside a draft makes its path yours, so discarding removes only what nobody touched. One AI round is one undo step.
- Right-click (or long-press) a node for every action in one menu.
- The map's zoom (in, out, fit, actual size, more room) is in the header beside Outline / Mind map, like the paper's.
- Export as Markdown, or the map as a PNG.

**Type**
- One type scale for the whole app (`src/app/globals.css`): reading text 16 px, interface text 14 px, nothing under 12 px, in rem so the browser's own font size is respected. Components name a role (`text-body`, `text-ui` …), never a pixel size.

Everything is stored locally in the browser (IndexedDB). Nothing is uploaded except the text a request sends to the model, and OpenAI is asked not to store requests.

## Run it

Requires Node 20+ and an OpenAI API key.

```bash
npm install
echo "OPENAI_API_KEY=sk-..." > .env.local
npm run dev
```

Then open http://localhost:3000. If `OPENAI_API_KEY` is already exported in your shell, the `.env.local` file isn't needed.

- The model is GPT-6 Luna (`gpt-6-luna`) by default; set `OPENAI_MODEL` to use another.
- Claude is also supported: set `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` (Claude Opus 5.5).
- For working on the interface without a key, `READLIT_MOCK_AI=1 npm run dev` returns canned answers shaped like the real ones (development only; ignored in production builds).

## Put it online (Vercel)

1. Import this repository in Vercel (Add New → Project → Import). The framework is detected as Next.js; nothing else to set.
2. Add the environment variables, then deploy:
   - `OPENAI_API_KEY`: best a key of its own, in an OpenAI project with a monthly budget, so a public link can never spend more than that.
   - `READLIT_ACCESS_CODE`: the code people type to use the site. Every page shows a code screen first and every API route answers 401 until the code is entered (the browser then keeps a token for 30 days; changing the code signs everyone out). If it is missing, a Vercel deployment stays shut (every page says so, every API route answers 503) rather than open; only a copy running on your own computer is open without a code.
3. AI routes are also limited per visitor (about 90 a minute; `src/proxy.ts`). That is a burst guard; the budget on the key is the real ceiling.
4. A paper opened by link is streamed through `/api/fetch-pdf` (a Vercel function can return at most 4.5 MB unless it streams), up to 60 MB. A boxed figure is sent as a PNG kept under about 2.8 MB, inside the 4.5 MB a request may carry.

Papers, notes and answers stay in each visitor's browser; the server keeps nothing.

## How it is built

- **Next.js 16 (App Router) + React 19 + TypeScript**, Tailwind CSS 4 with MapLit's design tokens (Fraunces + Inter, MapLit's palette), so components can move into MapLit unchanged.
- **pdf.js 6** renders pages to canvas and provides the selectable text layer.
- **Page text model** (`src/lib/pdf/text-model.ts`): pdf.js text runs → lines → blocks (paragraphs, headings, captions, equations, references, front matter, page furniture) → sentences with stable ids such as `p3s12`. Translations, citations, highlights, key points and note sources all point at these ids. Geometry is kept in page points at scale 1, so overlays are laid out once and scaled with the page.
- **Fitting** (`src/lib/pdf/fit.ts`) measures translated text in the DOM with the same CSS that draws it.
- **AI** (`src/lib/ai/`, `src/app/api/*`): routes describe a request in neutral terms; a provider adapter makes the call. OpenAI through the Responses API (strict JSON Schema generated from each route's zod schema, then validated; streaming for answers; `store: false`), or Claude through the Anthropic SDK. The paper is the first block of every request about it, so both providers' prompt caching reuses it. One shared rule decides what stays in the paper's own spelling (names, symbols, code) and what is written in your language.
- **Access** (`src/proxy.ts`, `src/lib/access.ts`): an optional access code in front of every page and API route, and a per-visitor limit on the AI routes.
- **Later work** (`src/lib/scholar/openalex.ts`): real citing papers from OpenAlex, looked up for questions about other work.
- **State**: zustand stores per concern (library, reader, chat, notes, settings, layout); idb-keyval for persistence.
- **Mind map**: React Flow for the canvas, with our own tidy logic-chart layout, keyboard model, drag-to-move and animation.

## Keyboard

| With text selected | | Reading | | Notes and mind map | |
|---|---|---|---|---|---|
| T | Translate in place | R or ⌘ drag | Box a figure or formula | Tab | Add a child |
| E | Explain | ⇧T | Translate the paper | Enter | Add a sibling |
| S | Summarize | ⌥ (hold) | See the original | Space | Edit |
| A | Ask about it | K | Underline key points | ⌫ | Delete branch |
| N | Note: mark and keep | ⌘ + / − | Zoom | ⌘ / | Fold |
| | | ? | All shortcuts | ⌘ Z | Undo |
