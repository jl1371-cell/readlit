import { z } from "zod";
import { errorResponse, keepAsWritten, languageName, paperBlock, structured } from "@/lib/ai/server";

export const maxDuration = 300;

/**
 * The brief: what a reader wants in the first minute with a paper. One call writes the gist, the key points and
 * three next questions; the points are anchored to sentences, so the same set is listed in the assistant and
 * underlined in the paper.
 */
const Body = z.object({
  title: z.string().max(400).default(""),
  paper: z.string().max(1_500_000),
  lang: z.string().max(20),
});

function schema(langName: string) {
  return z.object({
    gist: z
      .string()
      .describe(
        `One or two sentences in ${langName}: the problem the paper takes on, what it does, and what it finds, with its key number if it has one. Plain words that a researcher from a neighbouring field follows. ${keepAsWritten(langName)} Cite the sentence a statement rests on right after it, as its id in double square brackets, such as [[p1s3]].`,
      ),
    kind: z
      .string()
      .describe(
        `A short line in ${langName}, at most 14 words: what kind of paper this is (a new method or system, an empirical study, a theory paper, a survey, a dataset or benchmark, a position paper) and the form of its evidence, such as how many datasets, baselines or participants, or proofs. ${keepAsWritten(langName)}`,
      ),
    novelty: z.object({
      sid: z.string().describe("Id of the sentence, usually in the introduction or related work, where the paper says how its work differs from earlier work."),
      text: z
        .string()
        .describe(`In ${langName}, at most 18 words: how this work differs from the earlier work the paper names (name that work as the paper does), not a restatement of its contribution. ${keepAsWritten(langName)}`),
    }),
    look_first: z
      .array(
        z.object({
          sid: z.string().describe("Id of the caption sentence of the figure or table, copied from the paper."),
          label: z.string().describe("The figure or table as the paper labels it, such as Figure 1 or Table 2."),
          why: z.string().describe(`In ${langName}, at most 8 words: what it shows.`),
        }),
      )
      .describe("The one or two figures or tables that carry the key idea or the main result, in the order to look at them. Empty when the paper has none."),
    points: z.array(
      z.object({
        kind: z.enum(["claim", "method", "result", "limitation"]),
        sid: z.string().describe("Id of the one sentence of the paper that states this point, copied from the paper, such as p4s12."),
        text: z
          .string()
          .describe(
            `The point restated in ${langName}, at most 20 words: specific rather than general, with the paper's own numbers. ${keepAsWritten(langName)}`,
          ),
      }),
    ),
    questions: z
      .array(z.string().describe(`A question written in ${langName}, at most 16 words.`))
      .describe("Three questions to read the paper with, each answerable from it: one about its main claim, one about its evidence (pointing to a figure or table where it can), and one about an assumption or limit."),
    question_sources: z
      .array(z.string())
      .describe("For each question, in the same order, the id of the sentence where the paper answers it, copied from the paper."),
  });
}

const RULES = `Write a brief of the paper above for a researcher who is about to read it and wants its central argument first.

Key points, each kind in order of importance:
- claim: what the authors say their work contributes. At most 3.
- method: the design choices that make the approach work. At most 3.
- result: findings of the authors' own experiments or analysis, with their numbers. At most 3.
- limitation: at most 2, and only when all four hold: the authors say it themselves; it is about their own work; it is not a weakness of earlier work; it is not generic future work. Returning none is correct when no sentence passes.

Rules:
- Anchor each point to the single sentence of the paper that states it, using only ids that appear in the paper above. Never anchor a point to a heading, a figure or table caption, or an entry of the reference list; only look_first anchors to captions.
- State every finding with the conditions it was tested under (the data, setting or population), as what the authors report. Keep the paper's hedges, and never widen a finding beyond those conditions.
- Spread the anchors through the paper: the abstract and introduction state the claims, but anchor methods and results where the paper describes them in detail.
- Never state the same point twice: not under two kinds, and not as both a claim and the novelty. The novelty says how the work differs from named earlier work; a claim says what the authors contribute.`;

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  const { title, paper, lang } = parsed.data;
  try {
    const out = await structured("brief", {
      schema: schema(languageName(lang)),
      system: [paperBlock(title, paper), { type: "text", text: RULES }],
      content: "Write the brief.",
    });
    return Response.json(out);
  } catch (err) {
    return errorResponse(err);
  }
}
