import { z } from "zod";
import { errorResponse, keepAsWritten, languageName, structured } from "@/lib/ai/server";

export const maxDuration = 90;

const Body = z.object({
  title: z.string().max(400).default(""),
  lang: z.string().max(20),
  image: z.string().startsWith("data:image/png;base64,").max(8_000_000),
  /** Pixel size of the image, so boxes can be placed back on the page. */
  width: z.number().int().min(1).max(10000).optional(),
  height: z.number().int().min(1).max(10000).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  const { title, lang, image, width, height } = parsed.data;
  const target = languageName(lang);
  const sized = !!width && !!height;
  const Line = z.object({
    original: z.string().describe("The text exactly as it appears in the image."),
    text: z.string().describe(`The same text in ${target}.`),
    ...(sized
      ? {
          box: z
            .array(z.number())
            .describe(`Where the text sits: [left, top, right, bottom] in pixels of this ${width}×${height} image, tightly around the text.`),
        }
      : {}),
  });
  const Out = z.object({ lines: z.array(Line) });

  const system = `You read the text inside an image cropped from a research paper (a figure, chart, diagram or table) and translate it into ${target}.

Rules:
- Transcribe each distinct piece of text you can read — titles, axis labels, legend entries, annotations, table cells — in reading order, top to bottom, left to right.
- For each, give the original text and its ${target} translation, about as short as the original so it fits in the same place. ${keepAsWritten(target)} Unit symbols stay as they are.
- Each piece is one line of text as it is laid out in the image; a label that wraps over two lines is two pieces.
- Skip text you cannot read with confidence rather than guessing. If there is no readable text, return an empty list.`;

  try {
    const out = await structured("figureText", {
      schema: Out,
      system: [{ type: "text", text: system }],
      content: [
        { type: "image", dataUrl: image },
        {
          type: "text",
          text: `${title ? `This image is from the paper "${title}".` : "This image is from a research paper."}${sized ? ` It is ${width}×${height} pixels.` : ""}`,
        },
      ],
    });
    return Response.json(out);
  } catch (err) {
    return errorResponse(err);
  }
}
