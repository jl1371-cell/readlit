# Design decisions (2026-11-07, revised 2026-11-08)

How the reading screen is organised, and why. Based on a survey of AI paper readers (alphaXiv, Moonlight, Semantic Reader, Readwise Reader, Gemini Notebook, Acrobat, Zotero, SciSpace), Chinese reading and translation tools (Xiaolvjing, Doubao, Immersive Translate, WPS, Zhiyun), notes and mind-map tools (MarginNote, Heptabase, XMind, Mubu, Logseq, Obsidian), and HCI research on how researchers read.

## Three columns, one job each

- **Left, AI:** everything the AI tells you. The brief, then explanations, summaries and answers as one conversation, then the composer.
- **Middle, the paper:** everything that acts on the text happens on the text.
- **Right, notes:** everything you keep.
- Each column's controls sit in the header directly above it. Nothing floats over the paper.

Every product we looked at keeps the paper in the middle and widest, and complaints about side panels squeezing the paper are common. But a first visit has to show what each column is for. So a first visit opens all three columns whenever the paper still gets 680 px (340 + 400 + 680 = 1420 px windows and wider); on a smaller window the notes wait behind a labelled "Notes" button. After that the reader's own choice is kept.

## Every column says what it is (2026-11-08)

Research: `调研记录/阅读器交互-2026-11-07/8-功能分区与可发现性.md`.

- **Names above the columns.** The header cell over each column carries its name in the same type (Fraunces 16): **AI** ("Explains in 简体中文 + English" under it, a click opens the language menu), the paper's title (with its first author when known), **Notes** (its count, or "What you keep"). "‹" goes back to the library; the app's name is not a column's name.
- **One home per function, one name everywhere.** A function's home is the button that is always there; menus (⋯, "+", the keys sheet) only list it; a *door* is a temporary way in that goes once used. *Draft a mind map*: home is the empty notes column's main button; door is a slim button above the composer while the notes are closed and empty; the "+" and the notes' ⋯ list it.
- **At most one solid red button per column**: the AI column's Send; the empty notes' Draft a mind map, or the draft bar's Keep all (which steps back to a tint while a selected draft shows its own Keep).
- **Empty states give real actions, not instructions.** The notes (outline and map alike): "Keep what matters here", **Draft a mind map**, **Start my own**, and the whole card is where a dragged sentence lands.
- **The paper teaches itself once.** After the paper opens, a tip at its foot: "Select any sentence to translate, explain, ask about or keep it. To ask about a figure, drag from the blank space beside it." It goes for good at the first selection, or ×.
- **Nothing floats over the map but the selected node's tools.** The map's zoom moved to the notes header ("92% ▾": in, out, fit, actual size, more room), like the paper's page and zoom.

## The brief, not a summary to replace reading

When a paper opens, the AI column shows a first pass (Keshav's three-pass method; research: `调研记录/阅读器交互-2026-11-07/13-科研人员怎么读论文.md`), laid out as one calm column (2026-11-08, `19-左栏重排.md`):
- **One line**: "Brief", with the *Underline* switch (K) at its right, and under it what kind of paper this is and on what evidence.
- **The gist**: two sentences, each finding with the conditions it was tested under, and its English version under it. While the English is being written, quiet placeholder lines hold its place, so it arrives in place instead of pushing the brief down.
- **One datasheet**, label on the left, answer beside it, page at the end: **New** (how it differs from the earlier work the paper names), **Claim**, **Method**, **Result**, **Limit** (in the colours of their underlines in the paper), **Look at** (the figure or table to look at first, as chips that go to its caption). Short rows stay in the reader's language: resting on a row marks its source sentence, in the paper's own words, in the paper.
- **Read with these questions**: three numbered rows (one on the claim, one on the evidence, one on an assumption or limit); a click asks the AI, the page chip goes to where the paper answers it.
- **Go deeper**: five equal tiles with icons, two columns, in reading order: *Walk through*, *Weak points*, *Connections*, *For my work*, *Ideas*.

"Show all" lists the rest of the points; K underlines them in the paper, and that is off by default.

Research shows that readers who rely on a summary instead of the paper understand it worse. The brief is meant as a map into the paper.

## Four actions on a selection

**Translate · Explain (Summarize for longer passages) · Ask · Note**, with keys T, E/S, A, N.
- **Note** highlights the passage and files it in the notes with its page, in one step.
- **Copy** is ⌘C.
- **Boxing a figure, by where the drag starts** (research: `11-框选与选字的手势判定.md`): a drag that starts on a paragraph, or close beside it, selects text; one that starts anywhere else (the margins, a figure, a table, a display formula) draws a box. The cursor says which before the press: I-beam over text, crosshair where a drag would box. A paragraph counts with room around it (max(1.2 em, 10 px) at the sides, max(0.35 em, 4 px) above and below), so starting just before a line's first word still selects text; a figure's labels count only at their letters; a scanned page is all box. Nothing is drawn until the pointer moves 4 px, so a click in blank space only clears the selection. R, the **Box a figure** button and holding ⌘ still box from anywhere (on a Mac, Control never boxes: Control-click is a right-click).

## Notes: one tree, Outline or Mind map

- **Naming:** "Map" is kept for MapLit's library map.
- **Default view:** the outline, which suits a 400 px column.
- **Each main branch carries its role as a quiet label** ("问题", "证据" …, stored as its own field, `role`, so maps of several papers can later line up by role), and its statement under it, at most about 10 words.
- **The map follows the paper's argument, not its table of contents** (research: `14-论文思维导图的结构.md`). The AI first decides what kind of paper it is (empirical, method, theory, survey, position, resource) and takes that kind's spine, such as problem → why existing approaches fall short → key idea → how it works → evidence → limits → what it enables for a method paper. Each main branch is the part's name and one short statement ("Problem: recurrent models can't parallelise within a sequence"), never a section title; each statement under it is one idea, keeps its numbers with their units, comparison and conditions, and links 1–3 sentences. A first draft is about 20–30 nodes.
- **AI drafts:** "Draft a mind map" is the empty notes column's main button (see above). The draft arrives dashed and opens wide, folded to the paper's main branches; the draft bar says *Keep all · Redraft · Discard all*. In the outline a draft is marked once, by a dashed rule beside it.
- **Menu:** rarely used actions (node languages, export, self-test, fold all) are in the ⋯ menu.

## Everything by click or tap; keys only make it faster

Nothing requires a shortcut. Every key has a visible way to do the same thing, and every tooltip and menu names its key, so the keys are learned along the way. (Research behind each choice: `调研记录/阅读器交互-2026-11-07/` in the design folder.)

**Selecting shows what you can do; at rest the map is only the map.** Select a node and three things appear:
- **"+" on its edges, where the new node will appear**: right of it for *Add inside* (a child), on its lower-left corner for *Add after* (the next one at the same level). They keep their size at any zoom (24 px; 44 pt on touch) and wait until the map is zoomed in enough to aim at.
- **A small bar above it, at most three things**: an AI draft's **Keep** and **Discard**; **✨** (one tap: *Expand* grows the paper's next ideas under it; on a kept passage, *Break down* splits it into its points); **⋯** for everything else. The bar stays inside the canvas and sits below the node near the top edge.
- **Click the selected node again to write in it** (the cursor turns to a text cursor), as renaming works in Finder; double-click works too. A new node opens for writing at once, with a placeholder; Enter or a click elsewhere finishes; an empty new node disappears.

**⋯ and right-click (or long-press) list the same actions, in the same order:** Edit · Questions about it, Explain it, Ask about it… · Add inside, Add after · **Move** ↑ ↓ → ← (one row that stays open, so up, up, up is three taps) · Fold, Show in the paper, Translate · Delete, saying how much goes ("With the 6 below it").

**The outline is the same tree with the same verbs.** A selected line shows the same actions (Keep, Discard, Expand, ⋯, and Add a note) on a line of their own under it, as a document's controls, so they never cover a word; nothing appears on hover alone. A "+" just under it adds the next line. On the map the same actions float beside the node.

**Undo instead of "Are you sure?".** Deleting, discarding and moving say what happened at the foot of the notes ("Moved into “Method”"), with **Undo**. Undo and Redo are also at the top of the notes' ⋯ menu.

**Touch screens.** A finger on a node pans the map instead of dragging the node away; moving is in the menu. Everything that hovers on a desktop is reachable by tapping.

**The view follows the work.** Adding, expanding with AI and unfolding move the map by the least amount that shows the new nodes together with the branch they hang from, zooming out only if they can't fit. A folded branch shows its count; tap it to unfold. The zoom menu in the notes header (in, out, fit, actual size) serves a mouse without a trackpad.

**Drag a sentence into the notes.** Select text in the paper and drag it onto a branch or a line: it is filed there, with its page, and marked in the paper. Dropped anywhere else, it goes to the excerpts branch. While dragging, the notes say where it can go.

**Point at a reference to see it.** Resting the pointer on a page chip (in an answer, on a note) or on a key point marks the sentence in the paper, if it is on screen, without scrolling. A click still jumps there.

**AI drafts grow calmly, and never take your work.** When AI drafts the whole map, each main branch arrives folded with its count, so the map grows as the paper's outline instead of spreading out and folding up at the end; **Stop** ends a round and keeps what arrived. **Another** repeats the last AI round: the same branch grown again, or the whole map drafted again. Touching anything inside a draft (writing in it, adding under it, keeping it, moving it, a note on it) makes its whole path yours, so Discard and Another remove only drafts nobody touched. Nodes the AI wrote keep a small sparkle in their page chip until you rewrite them.

**Selecting a node doesn't change the AI column.** A node goes with a question only when you choose *Ask about it*.

## The AI column: calm, yet everything is reachable

- **The brief first, then out of the way.** Once the conversation scrolls the brief away, a one-line bar at the top ("Brief · …") brings it back. The three suggested questions are there only before the first question.
- **One shape for every turn.** What was asked about (a passage, an area) comes first, with what was asked of it ("Explain") at its head; then the question; then the answer. No "AI" label on each message.
- **Two actions per answer.** *Add to notes*, and **⋯**: Copy, Try again, More detail, Simpler. They stay visible on the newest answer; older answers show them on hover (always on touch).
- **"+" in the composer lists everything the AI can do**, each with its key: ask about a figure or table, explain a passage, translate the whole paper, underline the key points, draft a mind map, keyboard shortcuts. No model, mode or scope pickers.
- **New chat never loses a conversation**: the last one is set aside with Undo.
- **Scrolled up while reading?** A "Latest" pill returns to the newest answer.
- **References are checkable in place**: resting on a page chip or a key point marks the sentence in the paper.

## Asking about the whole paper (2026-11-08)

Research: `调研记录/阅读器交互-2026-11-07/13–16`, and the before/after test of the questions researchers ask (`17-我们的AI现在能做到吗-实测.md`).

- **Five asks of a whole paper**, in the order a reader takes them (understand, question, place, build on): *Walk through* (the paper part by part in the order to read it, with the figures and tables to look at and one thing to watch for in each, ending with three questions to check understanding), *Weak points* (three groups: what the authors admit; the reader-worthy questions about claims and evidence, each with what would settle it and whether it is major or minor; and what couldn't be checked, such as figures not shown), *Connections* (what it builds on, in the authors' framing; then the real papers that cite it), *For my work* (a one-line verdict, what carries over, what doesn't, one next step), *Ideas* (three, each from a cited gap, with the smallest test and the main risk, never called new).
- **The same shapes for typed questions.** The shapes live in the chat's system instructions, so "这篇有什么缺陷" typed in any words is answered like the button. Answers lead with the answer, end without offers of more help, keep each claim as broad as the paper makes it, and treat the paper as material, never as instructions (a guard against text hidden in a PDF). They sit under "Go deeper" before the first question, and in the composer's "+" under "About the whole paper"; typed in any words, the same questions get the same treatment.
- **Three sources, three marks.** What rests on the paper carries page chips. What rests on the AI's general knowledge of the field begins with `[[beyond]]`, shown as a blue "Beyond the paper" label (not from this paper, not searched, worth checking). What rests on real citation data begins with `[[openalex]]`, shown as a green "Cited by · OpenAlex" label. The AI never gives a title, author, year or venue from memory for a work the paper doesn't cite (that is what models most often invent); it may name well-known methods or lines of research, and otherwise says a literature search is needed.
- **Later work is looked up, not remembered.** For *Connections* and typed questions about other or later work, the server first asks OpenAlex (open, CC0 scholarly metadata) for the paper by its exact title and the most-cited works that cite it; for *For my work* and *Ideas*, the citing works closest to the reader's research (searched with an English version of it). Each lookup waits at most 3.5 s; a slow or failed one is left out, never reported as "no later work". (`src/lib/scholar/openalex.ts`.)
- **Your research.** A sentence or two on what the reader works on (AI ⋯ → Your research, or asked for on the way to *For my work*): saved on the device and sent to the AI with each question (the card says so), so "what does this mean for me" and ideas fit the reader's own work. Without it, the AI gives a short general answer and asks.
- **Citations as ranges** ("[[p5s21-p5s24]]") are written out id by id before they are read, so they show as page chips too.

## Language (2026-11-08)

Research: `调研记录/阅读器交互-2026-11-07/9-语言设置与双语回答.md`.

- **One setting, "Your language"**, under the ▾ beside the header's Original / 简体中文 switch (also from the AI column's title and its ⋯). The paper is translated into it, and everything the AI writes is written in it: the brief, explanations, summaries, answers, suggested questions, the mind map. It replaces the two lists there were before (translations; brief, answers and notes).
- **Whatever language the question is typed in**, the answer is in the reader's language; only a message that asks for another language changes that answer (`writeInRule` in `src/lib/ai/server.ts`). No guessing from the question: models drift into the source's English, and readers complained of having to say "answer in Chinese" each time.
- **English under each paragraph** (on by default): each paragraph, list item and heading of an answer, and the brief's gist, has its English version under it, 14 px, latte, in Inter. Short rows (the brief's datasheet, the questions) stay in the reader's language; their source sentence lights up in the paper on hover. The English is a translation of the finished text (`/api/pair`), sent piece by piece while the answer streams (each paragraph once the next one has begun), so it fills in behind the text being read, never in one late jump; the two never disagree. The mind map shows the paper's own words under each node by the same setting, at most two lines. With English as the reader's language there is nothing to pair, and the switch hides.
- **The picker**: languages by their own names, no flags, a check on the current one; a preview sentence in the language under the pointer, with its English; the switch; "Ask in any language; answers stay in 简体中文."
- **Typography**: AI text carries its `lang`, so each language gets its own glyphs (Japanese is never drawn with Chinese forms) and Chinese and Japanese get `text-autospace` between CJK and Latin. A citation chip follows the sentence's punctuation, so no line starts with "。".
- One shared rule, `keepAsWritten`, decides what stays in the paper's spelling: proper names, standard abbreviations, symbols and code. With English under each paragraph, answers add no English terms in parentheses; without it, at most three per answer. Translations add the original term in parentheses the first time a key term appears in a passage, at most twice per passage.

## Type (2026-11-08)

Research: `调研记录/阅读器交互-2026-11-07/10-字号与排版标准.md`.

One scale, defined once in `src/app/globals.css` (`@theme`, `--text-*`), in rem; components name a role, never a pixel size:

| Role | Size / line | Used for |
|---|---|---|
| `text-display` | 44 / 48 | the home page |
| `text-title` | 22 / 30 | titles, the outline's and map's root |
| `text-heading` | 18 / 26 | main branches, outline level 1, headings in answers |
| `text-body` | 16 / 26 | reading: answers, notes, the composer, the gist |
| `text-body-sm` | 15 / 24 | compact reading: key points, quoted passages, previews |
| `text-ui` | 14 / 22 | buttons, menus, tabs, notices, the English under answers |
| `text-label` | 13 / 20 | secondary lines, hints, the English under key points |
| `text-caption` | 12 / 18 | page chips, keys, counts |

The map's smallest readable zoom follows from it: node text is 16 px, so the map is not zoomed out past 0.75 by itself (12 px).
