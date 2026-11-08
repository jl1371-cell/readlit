import { z } from "zod";
import { errorResponse, languageName, structured } from "@/lib/ai/server";

export const maxDuration = 120;

/**
 * The English version of what the AI wrote in the reader's language, one text at a time (a paragraph, a list item,
 * a key point, a question), shown one step quieter under its original. It translates the finished text rather than
 * writing a second answer, so the two never disagree.
 */
const Body = z.object({
  title: z.string().max(400).default(""),
  /** The language the texts are written in. */
  lang: z.string().max(20),
  texts: z.array(z.object({ id: z.string().max(60), text: z.string().max(6000) })).min(1).max(80),
});

const Out = z.object({ texts: z.array(z.object({ id: z.string(), text: z.string() })) });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  const { title, lang, texts } = parsed.data;
  const from = languageName(lang);

  const system = `You write the English version of short texts that a reading assistant wrote in ${from} about a research paper. Each English version is shown under its original, so a reader can follow along in English.

Rules:
- Translate each text faithfully into clear, natural academic English: the same meaning, the same hedges and the same numbers. Add nothing, drop nothing, and do not summarize.
- Use the standard English terms of the field, as the paper would write them. Proper names, abbreviations, symbols, variable names and code stay exactly as they are.
- Keep **bold** and \`code\` markup where the original has it. Leave out citation markers such as [[p3s12]].
- A text may be a heading, a list item or a question; keep its form and its length.
- If a text is already in English, return it unchanged.
- Return exactly one English version for every id.`;

  const content =
    (title ? `Paper: ${title}\n\n` : "") + texts.map((t) => `<text id="${t.id}">\n${t.text}\n</text>`).join("\n\n");

  try {
    const out = await structured("pair", { schema: Out, system: [{ type: "text", text: system }], content });
    return Response.json(out);
  } catch (err) {
    return errorResponse(err);
  }
}
