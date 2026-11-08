import "server-only";
import type { z } from "zod";
import { anthropicReady, anthropicStream, anthropicStructured } from "./anthropic";
import { AiError } from "./errors";
import { MOCK, mockStream, mockStructured } from "./mock";
import { openaiReady, openaiStream, openaiStructured } from "./openai";

export { AiError };

/**
 * The AI layer. Routes describe a request in neutral terms (instruction blocks, text and image parts, turns);
 * a provider adapter turns it into that provider's API call. OpenAI (GPT-6 Luna by default) is used when an
 * OpenAI key is configured; Claude remains available with AI_PROVIDER=anthropic.
 */

/** A block of instructions or context. `cache` marks text that is identical across requests about the same paper. */
export interface SystemBlock {
  type: "text";
  text: string;
  cache?: boolean;
}

export type Part = { type: "text"; text: string } | { type: "image"; dataUrl: string };

export interface Turn {
  role: "user" | "assistant";
  content: string | Part[];
}

export type Effort = "low" | "medium";

/** How hard each task thinks and how long its answer may be; the model is the provider's. */
export const TASKS = {
  translate: { effort: "low", maxTokens: 16000 },
  labels: { effort: "low", maxTokens: 8000 },
  figureText: { effort: "low", maxTokens: 8000 },
  lookup: { effort: "low", maxTokens: 4000 },
  chat: { effort: "medium", maxTokens: 32000 },
  mapOutline: { effort: "low", maxTokens: 8000 },
  mapBranch: { effort: "low", maxTokens: 12000 },
  mapExpand: { effort: "low", maxTokens: 12000 },
  brief: { effort: "medium", maxTokens: 12000 },
  pair: { effort: "low", maxTokens: 12000 },
} as const satisfies Record<string, { effort: Effort; maxTokens: number }>;

export type Task = keyof typeof TASKS;
export type TaskConfig = (typeof TASKS)[Task];

export type Provider = "openai" | "anthropic";

export function provider(): Provider {
  const chosen = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (chosen === "openai" || chosen === "anthropic") return chosen;
  return process.env.OPENAI_API_KEY?.trim() ? "openai" : "anthropic";
}

/** The paper as a stable block: identical bytes for every request about the same paper, so providers can cache it. */
export function paperBlock(title: string, paper: string): SystemBlock {
  return { type: "text", text: `<paper title="${title.replace(/"/g, "'")}">\n${paper}\n</paper>`, cache: true };
}

function toAiError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  console.error(err);
  return new AiError("Something went wrong.", 500);
}

export function errorResponse(err: unknown): Response {
  const e = toAiError(err);
  return Response.json({ error: e.message }, { status: e.status });
}

/** One structured call: the answer is parsed and validated against the zod schema. */
export async function structured<S extends z.ZodType>(
  task: Task,
  opts: { schema: S; system: SystemBlock[]; content: string | Part[] },
): Promise<z.infer<S>> {
  if (MOCK) return (await mockStructured(task, opts.system, opts.content)) as z.infer<S>;
  const cfg = TASKS[task];
  try {
    return provider() === "openai" ? await openaiStructured(task, cfg, opts) : await anthropicStructured(task, cfg, opts);
  } catch (err) {
    throw toAiError(err);
  }
}

const NDJSON = { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" };

/** Streams text as newline-delimited JSON events: {type:"delta"} … {type:"done"} or {type:"error"}. */
export function streamText(task: Task, opts: { system: SystemBlock[]; messages: Turn[]; signal?: AbortSignal }): Response {
  const encoder = new TextEncoder();
  const line = (event: object) => encoder.encode(JSON.stringify(event) + "\n");
  if (MOCK) {
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        for await (const text of mockStream(opts.system)) controller.enqueue(line({ type: "delta", text }));
        controller.enqueue(line({ type: "done", model: "mock" }));
        controller.close();
      },
    });
    return new Response(body, { headers: NDJSON });
  }
  const which = provider();
  // A missing key is reported as a plain error response, before any stream starts.
  try {
    if (which === "openai") openaiReady();
    else anthropicReady();
  } catch (err) {
    return errorResponse(err);
  }
  const cfg = TASKS[task];
  // Stopping in the reader (or leaving) cancels the stream, which stops the model too.
  const upstream = new AbortController();
  opts.signal?.addEventListener("abort", () => upstream.abort());
  let open = true;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: object) => open && controller.enqueue(line(event));
      const args = { ...opts, signal: upstream.signal };
      const source = which === "openai" ? openaiStream(task, cfg, args) : anthropicStream(task, cfg, args);
      try {
        let step = await source.next();
        while (!step.done) {
          send({ type: "delta", text: step.value });
          step = await source.next();
        }
        send({ type: "done", model: step.value });
      } catch (err) {
        if (!upstream.signal.aborted) send({ type: "error", message: toAiError(err).message });
      } finally {
        if (open) {
          open = false;
          controller.close();
        }
      }
    },
    cancel() {
      open = false;
      upstream.abort();
    },
  });
  return new Response(body, { headers: NDJSON });
}

/**
 * What stays as the paper wrote it when text is written in the reader's language. One rule for every task, stated
 * plainly: smaller models keep far too much in the source language when told only to "keep names as written".
 */
export function keepAsWritten(langName: string): string {
  return `Keep in the paper's own spelling only: proper names (of models, systems, datasets, benchmarks, people and organisations), abbreviations that researchers use unchanged (such as BLEU or F1), mathematical symbols and variable names, citation markers, and code. Write everything else in ${langName}, including ordinary technical terms and units. Keep the paper's numbers as digits, exactly as the paper writes them (such as 28.4 or 3.5 days), never spelled out in words. Write formulas in plain text with Unicode symbols (such as √, ×, ≤ and d_k), never in LaTeX.`;
}

/**
 * The reader's language decides what everything is written in, whatever language the reader types in; only an
 * explicit request in the message changes it, for that one answer. (Stated plainly, without examples: examples of
 * one language pair make smaller models copy the pair.)
 */
export function writeInRule(langName: string): string {
  return `Write in ${langName}, whatever language the reader writes in. Only when the reader's message asks for another language, write that one answer in the language asked for.`;
}

export function languageName(code: string): string {
  const names: Record<string, string> = {
    "zh-Hans": "Simplified Chinese",
    "zh-Hant": "Traditional Chinese",
    en: "English",
    ja: "Japanese",
    ko: "Korean",
    es: "Spanish",
    fr: "French",
    de: "German",
    pt: "Portuguese",
    ru: "Russian",
  };
  return names[code] ?? "English";
}
