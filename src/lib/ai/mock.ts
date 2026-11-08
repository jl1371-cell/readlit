import "server-only";
/**
 * Development only: canned answers shaped exactly like the real ones, so every screen can be exercised without
 * an API key. Enabled with READLIT_MOCK_AI=1 and refused in production builds.
 */
import type { SystemBlock } from "./server";

export const MOCK = process.env.READLIT_MOCK_AI === "1" && process.env.NODE_ENV !== "production";

const FILL = "这是用于检验原位排版的模拟译文，长度大致接近真实的中文翻译，会随原句变长而变长";

function fakeChinese(source: string): string {
  const n = Math.max(6, Math.round(source.length * 0.42));
  let out = "";
  while (out.length < n) out += FILL;
  return `${out.slice(0, n)}。`;
}

const ID_LINE = /^\[(p\d+s\d+)\]\s+(.*)$/;

function paperLines(system: SystemBlock[]): { sid: string; text: string; heading: boolean }[] {
  const paper = system[0]?.text ?? "";
  const out: { sid: string; text: string; heading: boolean }[] = [];
  for (const raw of paper.split("\n")) {
    const line = raw.trim();
    const h = /^##\s+\[(p\d+s\d+)\]\s+(.*)$/.exec(line);
    if (h) out.push({ sid: h[1], text: h[2], heading: true });
    const m = ID_LINE.exec(line);
    if (m && !m[2].startsWith("(reference)")) out.push({ sid: m[1], text: m[2].replace(/^\(caption\)\s*/, ""), heading: false });
  }
  return out;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function mockStructured(task: string, system: SystemBlock[], content: unknown): Promise<unknown> {
  await wait(500 + Math.random() * 900);
  const text = typeof content === "string" ? content : JSON.stringify(content);
  if (task === "translate") {
    const passages: { id: string; sentences: { id: string; text: string }[] }[] = [];
    for (const block of text.split("<passage ").slice(1)) {
      const id = /id="([^"]+)"/.exec(block)?.[1] ?? "";
      const sents = block.split("<sentences>")[1]?.split("</sentences>")[0] ?? "";
      const sentences = sents
        .split("\n")
        .map((l) => ID_LINE.exec(l.trim()))
        .filter((m): m is RegExpExecArray => !!m)
        .map((m) => ({ id: m[1], text: fakeChinese(m[2]) }));
      passages.push({ id, sentences });
    }
    return { passages };
  }
  if (task === "labels") {
    const labels = text
      .split("\n")
      .map((l) => /^\[([^\]]+)\]\s+(.*)$/.exec(l.trim()))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => ({ id: m[1], text: `标签${m[2].length > 6 ? "（较长）" : ""}` }));
    return { labels };
  }
  if (task === "figureText") {
    const size = /It is (\d+)×(\d+) pixels/.exec(text);
    const W = size ? Number(size[1]) : 0;
    const H = size ? Number(size[2]) : 0;
    const box = (fx: number, fy: number, fw: number, fh: number) => (W ? { box: [fx * W, fy * H, (fx + fw) * W, (fy + fh) * H] } : {});
    return {
      lines: [
        { original: "Output Probabilities", text: "输出概率", ...box(0.42, 0.01, 0.2, 0.03) },
        { original: "Softmax", text: "Softmax", ...box(0.47, 0.06, 0.1, 0.025) },
        { original: "Positional Encoding", text: "位置编码", ...box(0.0, 0.7, 0.13, 0.05) },
        { original: "Inputs", text: "输入", ...box(0.2, 0.9, 0.08, 0.03) },
      ],
    };
  }
  if (task === "pair") {
    const texts = [...text.matchAll(/<text id="([^"]+)">\n?([\s\S]*?)\n?<\/text>/g)].map((m) => ({
      id: m[1],
      text: `The English version of this text (mock), about as long as the original${m[2].length > 40 ? ", so a longer original gets a longer line here" : ""}.`,
    }));
    return { texts };
  }
  if (task === "lookup") return { translation: "注意力机制", sense: "模型在处理每个词时，按相关程度给句中其他词分配权重的方法（模拟回答）。" };
  const lines = paperLines(system);
  if (task === "brief") {
    const kinds = ["claim", "method", "result", "limitation"] as const;
    const body = lines.filter((l) => !l.heading && l.text.length > 60);
    const picks = body.filter((_, i) => i % 11 === 2).slice(0, 10);
    const first = body[1]?.sid ?? "p1s1";
    return {
      gist: `这是一段模拟概览：论文提出一种新方法，并用实验说明它比已有做法更好 [[${first}]]。正式版由模型根据全文写成。`,
      points: picks.map((l, i) => ({ sid: l.sid, kind: kinds[Math.min(3, Math.floor(i / 3))], text: "模拟要点：论文里的一个关键说法，正式版由模型改写成一句话" })),
      questions: ["它要解决的核心问题是什么？（模拟）", "方法里最关键的一步是什么？（模拟）", "主要结果有哪些证据支撑？（模拟）"],
    };
  }
  if (task === "mapOutline") {
    const heads = lines.filter((l) => l.heading && !/^(references|acknowledg)/i.test(l.text)).slice(0, 6);
    return {
      root: { in_paper_language: "Paper title", in_reader_language: "论文标题（模拟）" },
      branches: heads.map((h) => ({ in_paper_language: h.text.slice(0, 40), in_reader_language: `${h.text.slice(0, 12)}（模拟）`, sids: [h.sid] })),
    };
  }
  if (task === "mapBranch" || task === "mapExpand") {
    const body = lines.filter((l) => !l.heading && l.text.length > 40);
    const pick = body.sort(() => Math.random() - 0.5).slice(0, 3);
    const questions = system.some((b) => b.text.includes("Write only the questions"));
    return {
      children: pick.map((l) => ({
        in_paper_language: questions ? `What does the paper say about ${l.text.split(" ").slice(0, 4).join(" ")}?` : l.text.split(" ").slice(0, 10).join(" "),
        in_reader_language: questions ? "论文对这一点是怎么说的？（模拟）" : "模拟要点：论文中的一个具体说法",
        sids: [l.sid],
        children: [],
      })),
    };
  }
  throw new Error(`No mock for ${task}`);
}

export async function* mockStream(system: SystemBlock[]): AsyncGenerator<string> {
  const lines = paperLines(system).filter((l) => !l.heading && l.text.length > 50);
  const a = lines[2]?.sid ?? "p1s1";
  const b = lines[5]?.sid ?? a;
  const answer = `这是一段**模拟回答**，用于检验对话界面 [[${a}]]。\n\n要点：\n- 第一点，引用原文 [[${b}]]。\n- 第二点，再引用一次 [[${a}, ${b}]]。\n\n真实回答会根据论文内容生成。`;
  for (const piece of answer.match(/[\s\S]{1,6}/g) ?? []) {
    await wait(30);
    yield piece;
  }
}
