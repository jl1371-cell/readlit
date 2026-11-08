import { z } from "zod";
import { errorResponse, keepAsWritten, languageName, structured } from "@/lib/ai/server";

export const maxDuration = 60;

const Body = z.object({
  title: z.string().max(400).default(""),
  lang: z.string().max(20),
  term: z.string().min(1).max(200),
  context: z.string().max(4000).default(""),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  const { title, lang, term, context } = parsed.data;
  const target = languageName(lang);

  const Out = z.object({
    translation: z
      .string()
      .describe(`The term written in ${target}: the standard translation used in this field, or the one that fits this context when there are several. At most 8 words.`),
    sense: z
      .string()
      .describe(`What the term means in this paper, written in ${target}: one plain sentence of at most 30 words.`),
  });

  const system = `You help a reader understand a word or short phrase they selected while reading a research paper. Answer for this paper's context, not in general. ${keepAsWritten(target)}`;
  const content = `${title ? `Paper: ${title}\n` : ""}Selected: "${term}"\n\nWhere it appears:\n${context || term}`;

  try {
    const out = await structured("lookup", { schema: Out, system: [{ type: "text", text: system }], content });
    return Response.json(out);
  } catch (err) {
    return errorResponse(err);
  }
}
