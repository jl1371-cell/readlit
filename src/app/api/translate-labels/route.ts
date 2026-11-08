import { z } from "zod";
import { errorResponse, keepAsWritten, languageName, structured } from "@/lib/ai/server";

export const maxDuration = 60;

const Body = z.object({
  title: z.string().max(400).default(""),
  lang: z.string().max(20),
  labels: z.array(z.object({ id: z.string().max(40), text: z.string().max(600) })).min(1).max(200),
});

const Out = z.object({ labels: z.array(z.object({ id: z.string(), text: z.string() })) });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  const { title, lang, labels } = parsed.data;
  const target = languageName(lang);

  const system = `You translate the short text labels found inside a figure or table of a research paper into ${target}: axis titles, legend entries, column headers, annotations.

Rules:
- Keep every translation about as short as the original label, so it fits in the same place.
- ${keepAsWritten(target)} Unit symbols stay as they are.
- A label that is only a number, symbol or name stays exactly as it is.
- Return one translation for every id.`;

  const content =
    (title ? `Paper: ${title}\n\n` : "") + labels.map((l) => `[${l.id}] ${l.text}`).join("\n");

  try {
    const out = await structured("labels", { schema: Out, system: [{ type: "text", text: system }], content });
    return Response.json(out);
  } catch (err) {
    return errorResponse(err);
  }
}
