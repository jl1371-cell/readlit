# Demo script (draft)

Expo-style judging means the same short demo, many times. This is a 90-second core that always works, plus extras for judges who want more. Use a paper you know well. "Attention Is All You Need" (arXiv 1706.03762) is a safe choice; its abstract and figures exercise everything. On the home screen, "Try *Attention Is All You Need*" opens it in one click.

## Before judging

- Open the paper once beforehand: the brief, translations and the mind map are kept locally, so the demo doesn't wait on the network. Leave one or two things un-generated to show live.
- Window at least 1440 px wide; browser zoom 100%. A fresh browser then shows all three columns on the first visit.
- Keep a screen recording of the full flow as a fallback in case the venue Wi-Fi fails.

## The screen, in one sentence

Left is the AI, the middle is the paper, right is your notes; each column's name and controls sit in the header above it.

## The 90 seconds

1. **The problem (10 s).** "Reading a paper in your second language means copying a paragraph into a translator or a chatbot, losing your place, and losing the figure it was next to."
2. **The brief (10 s).** Point at the left column: the gist, then one line each for the claim, method, result and an admitted limitation, each one click from its sentence. Click one: the paper jumps there and the sentence flashes. Press **K** to underline them all in the paper.
3. **Translate in place (20 s).** Select one sentence in the abstract, press **T**. The sentence turns into Chinese exactly where it was; the rest of the paragraph stays English. Hold **⌥** to show the original, release to come back.
4. **Whole paper (10 s).** Click **简体中文** in the header. Paragraphs fill in as they are ready; author names, equations and references stay as they are.
5. **Ask without copying (15 s).** Select a paragraph about multi-head attention, press **E**. The explanation appears in the AI column with page chips; click one to jump back.
6. **Box a figure (10 s).** Drag from the blank space beside Figure 1 across it (no key needed; the cursor turns to a crosshair there), choose **Translate text**: every label inside the diagram turns into Chinese in its place. Or choose Explain: the figure itself is sent to the model.
7. **Notes and mind map (15 s).** In the notes column, press the red **Draft a mind map**. The map opens wide and grows calmly: the paper's own main branches, each in Chinese with the paper's words underneath and a page chip, arriving folded with a count. Tap a count to unfold. Tap a node: "+" on its edges, ✨ and ⋯ appear; tap it again to write in it. Switch to **Outline** to see the same tree written down the page.

## Extras, if a judge asks

- **No keys needed.** Select a node: "+" right adds inside, "+" on its corner adds after, ✨ expands it with AI, ⋯ moves it (↑ ↓ → ←), folds, translates or deletes it; deleting shows Undo. Keys do the same faster (Tab, Enter, Space, ⌫, ⌘Z). AI nodes are dashed drafts until you keep them; anything you touch in a draft is yours.
- **Drag a sentence into the map.** Select a sentence in the paper and drag it onto a branch: it lands there with its page, and is marked in the paper.
- **Check a reference without leaving.** Rest the pointer on a page chip in an answer: the sentence lights up in the paper.
- **Everything the AI can do.** The "+" in the composer lists it, each with its key.
- **From reading to notes.** Select a sentence and press **N**: it is marked in the paper and kept under 摘录 (Excerpts) with its page. "Add to notes" under any answer turns a list into a branch. Right-click a node: expand it with AI, have it explained, or ask about it.
- **A word.** Double-click a single technical term and press **T**: a small card with its meaning in this paper.
- **Test yourself.** In the mind map's ⋯ menu: the details hide; click one, try to remember, reveal, mark it.
- **Export.** Markdown, or the map as a PNG, from the ⋯ menu.
- **Another version.** On a dashed AI draft, "Redraft" discards what nobody touched and drafts again.
- **Your language.** The ▾ beside 简体中文 in the header: choose 日本語 and the brief is written again in Japanese, with English under its gist; answers follow, even to a question typed in English.

## Lines that answer common questions

- *How is this different from a PDF translator?* Those make a second file; annotations on the original don't carry over, and you can't ask about a passage. Here the translation lives on the page you're reading, sentence by sentence.
- *Can I trust the answers?* Every point in the brief, every answer and every map node points to the sentences it relies on, and you can check each one in one click. What the AI writes into your notes stays a draft until you keep it.
- *Why three columns?* Each has one job: the AI tells you things on the left, you read in the middle, you keep things on the right. Nothing else floats over the paper.
- *Which model?* OpenAI's GPT-6 Luna: fast and inexpensive, so a whole paper can be translated in place. The AI layer also runs on Claude.
- *Where is my data?* In the browser. Only the text of a request goes to the model, and the provider is asked not to store it.
