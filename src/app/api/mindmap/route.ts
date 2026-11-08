import { z } from "zod";
import { errorResponse, keepAsWritten, languageName, paperBlock, structured } from "@/lib/ai/server";

export const maxDuration = 300;

/**
 * Mind maps are generated in two steps so the first level appears quickly:
 *  - `outline` names the root and the main branches, following the paper's own argument;
 *  - `branch` fills one branch (questions for a reading skeleton, statements for a full draft), one call per branch;
 *  - `expand` grows a single node the reader picked.
 * The paper is the first, cached system block of every call, so the parallel branch calls reuse it.
 */
const Body = z.object({
  title: z.string().max(400).default(""),
  paper: z.string().max(1_500_000),
  lang: z.string().max(20),
  mode: z.enum(["outline", "branch", "expand"]),
  style: z.enum(["questions", "statements", "explain"]).default("statements"),
  /** Path from the root to the node being filled or expanded, as shown to the reader. */
  path: z.array(z.string().max(400)).max(10).default([]),
  /** Other main branches, so a branch doesn't repeat its neighbours. */
  siblings: z.array(z.string().max(400)).max(12).default([]),
  /** Children the node already has, so they aren't repeated. */
  existing: z.array(z.string().max(400)).max(60).default([]),
  /** An optional instruction from the reader for this expansion. */
  ask: z.string().max(400).default(""),
});

function schemas(langName: string) {
  const text = {
    in_paper_language: z.string().describe("The node's text, written in the language the paper is written in."),
    in_reader_language: z
      .string()
      .describe(
        `The same text written in ${langName}, as natural ${langName} a researcher would write. ${keepAsWritten(langName)} Don't add the original wording in parentheses; it is shown under the node. If the paper is written in ${langName}, repeat the first text.`,
      ),
  };
  const sids = z
    .array(z.string())
    .describe("Ids of 1 to 3 of the paper's sentences that support this node, copied from the paper, such as p4s12. Empty only when no sentence of the paper supports it.");
  const Leaf = z.object({ ...text, sids });
  const Node = z.object({ ...text, sids, children: z.array(Leaf).describe("Usually empty. Add children only where the paper has real substructure.") });
  return {
    Outline: z.object({
      root: z.object(text).describe("The paper's own title."),
      branches: z.array(
        z.object({
          role_in_paper_language: z.string().describe("The part's name from the spine, in the paper's language, such as Problem or Evidence."),
          role_in_reader_language: z
            .string()
            .describe(`The same part's name in ${langName}, one to four words. If the paper is written in ${langName}, repeat the first.`),
          ...text,
          sids,
        }),
      ),
    }),
    Branch: z.object({ children: z.array(Node) }),
  };
}

const LENGTH = `Keep every node short, like an entry in a mind map rather than a sentence of prose: a topic is at most 6 words, a question at most 14 words, a statement at most 18 words. Keep the paper's numbers exactly.`;

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  const { title, paper, lang, mode, style, path, siblings, existing, ask } = parsed.data;
  const langName = languageName(lang);
  const { Outline, Branch } = schemas(langName);
  const system = paperBlock(title, paper);

  try {
    if (mode === "outline") {
      // The paper's line of argument, not its table of contents (report 14): a spine for its kind of paper, each main
      // branch a short statement of what this paper says about that part.
      const instructions = `Start a reader's mind map of the paper above. The map shows the paper's line of argument: what it claims and why a reader should believe it.

1. Decide what kind of paper this is: empirical (collects and analyses data to answer a question), method (proposes a technique, model, system or tool and evaluates it), theory (definitions, theorems and proofs), survey (organises earlier work), position (argues for a view), resource (releases a dataset or benchmark), or other. If it mixes kinds, take the one that carries its main contribution.

2. Take the spine for that kind, in this order:
- empirical: question, why it matters, design, findings, interpretation, limits, implications
- method: problem, why existing approaches fall short, key idea, how it works, evidence, limits, what it enables
- theory: question, setting and assumptions, main results, proof idea, consequences, limits
- survey: scope, how works were selected, framework, what is agreed, disagreements and gaps, open problems
- position: position, why now, arguments, alternative views, what should change, limits
- resource: gap, contents, how it was built, baseline results, uses and limits, access
- other: problem, gap, main claim, approach, evidence, limits, implications
Keep 4 to 7 branches. Leave out a part the paper doesn't have and merge a thin part into its neighbour; never invent one. Use "limits" only for limits the authors state about their own work.

3. Each branch has a role, the part's name from the spine, and a text: one short statement of what this paper says about that part, at most 10 words. The statement is a claim with a verb, not a topic, and does not repeat the role's name. Follow the argument, not the section headings: never a branch for "Introduction", "Related work", "Experiments" or "Conclusion" as such. Make each statement specific to this paper; if it would be true of most papers in the field, rewrite it.

- root: the paper's own title.
- Give each branch the ids of 1 to 3 sentences where the paper states it.`;
      const out = await structured("mapOutline", {
        schema: Outline,
        system: [system, { type: "text", text: instructions }],
        content: "Start the map.",
      });
      return Response.json(out);
    }

    const where = path.join(" › ");
    const here = path[path.length - 1] ?? title;
    const neighbours = siblings.length ? `\nThe other main branches are: ${siblings.join("; ")}. Stay within this branch and don't repeat them.` : "";
    const avoid = existing.length ? `\nThe node already has these children; don't repeat them: ${existing.join("; ")}.` : "";
    const wish = ask.trim() ? `\nThe reader asked for: ${ask.trim()}` : "";

    const task =
      style === "questions"
        ? `Write 2 to 4 questions about "${here}" that this paper answers, the questions a reader should be able to answer after reading it. Write only the questions, never their answers. For each question, \`sids\` points to the sentences where the paper gives the answer. No children.`
        : style === "explain"
          ? `Write 2 to 4 short statements that explain "${here}" to a reader who is new to it: what it is, why it is used here, how it relates to the rest of the paper. You may add general background that the paper doesn't state; give \`sids\` only for statements the paper supports, and leave them empty for background. No children.`
          : `Write 2 to 4 statements under "${here}" that a reader needs in order to understand and check this part of the argument.
- One idea per statement; if two claims need "and" to join them, write two statements. Write a statement with a verb (what the paper claims, did or found), never a bare topic.
- Keep each number with its unit, what it is compared with, and the condition it holds under, and keep the paper's qualifiers (the data, setting or language it was tested on). Never state a result more broadly than the paper does.
- Write only what the paper says: no inferences, background or judgements of your own.
- Each statement needs \`sids\`: 1 to 3 sentences that state it, preferring the body's detailed sentence over the abstract.
- Order the statements as the argument runs. Add children only under evidence, findings and how it works: at most 3, for separate results (one per dataset, condition or measure) or separate components.`;

    const instructions = `You are adding to a reader's mind map of the paper above. The node's place in the map is: ${where}.

${task}${neighbours}${avoid}${wish}

${LENGTH}`;
    const out = await structured(mode === "branch" ? "mapBranch" : "mapExpand", {
      schema: Branch,
      system: [system, { type: "text", text: instructions }],
      content: "Add the nodes.",
    });
    return Response.json(out);
  } catch (err) {
    return errorResponse(err);
  }
}
