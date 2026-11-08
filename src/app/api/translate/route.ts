import { z } from "zod";
import { errorResponse, keepAsWritten, languageName, structured } from "@/lib/ai/server";

export const maxDuration = 120;

const Body = z.object({
  title: z.string().max(400).default(""),
  lang: z.string().max(20),
  passages: z
    .array(
      z.object({
        id: z.string().max(40),
        /** The whole paragraph and its neighbours, so a single sentence is translated in its context. */
        context: z.string().max(12000).optional(),
        sentences: z.array(z.object({ id: z.string().max(40), text: z.string().max(4000) })).min(1).max(80),
      }),
    )
    .min(1)
    .max(12),
});

const Out = z.object({
  passages: z.array(
    z.object({
      id: z.string(),
      sentences: z.array(z.object({ id: z.string(), text: z.string() })),
    }),
  ),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  const { title, lang, passages } = parsed.data;
  const target = languageName(lang);

  const system = `You translate passages of a research paper for a reader who reads ${target}. Your translation is shown in place of the original text, sentence by sentence.

Rules:
- Translate every listed sentence into ${target}, faithfully and completely. Do not summarize, explain, soften or skip anything.
- Keep the academic register of the original and use the standard ${target} terminology of the field.
- ${keepAsWritten(target)} Mathematical expressions, citation markers such as [12] or (Smith et al., 2020) and URLs stay exactly as they are.
- The first time a key technical term of the field appears in a passage, follow its translation with the original term in parentheses, so the reader learns the term used in the literature. Do this for at most two terms per passage, and never for a term the passage already gives in parentheses.
- Return exactly one translation for every sentence id, keeping the ids and their order. Never merge, split or drop sentences.
- A passage may come with its surrounding context. Use the context only to understand the sentences; translate only the listed sentences.
- A sentence may be cut off where a column or page ends. Translate exactly the part you are given, so that it reads on naturally into the rest.
- If a sentence is already written in ${target}, return it unchanged.`;

  const content =
    (title ? `Paper: ${title}\n\n` : "") +
    passages
      .map((p) => {
        const ctx = p.context ? `<context>\n${p.context}\n</context>\n` : "";
        return `<passage id="${p.id}">\n${ctx}<sentences>\n${p.sentences.map((s) => `[${s.id}] ${s.text}`).join("\n")}\n</sentences>\n</passage>`;
      })
      .join("\n\n");

  try {
    const out = await structured("translate", { schema: Out, system: [{ type: "text", text: system }], content });
    return Response.json(out);
  } catch (err) {
    return errorResponse(err);
  }
}
