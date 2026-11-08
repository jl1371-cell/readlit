import "server-only";
import { z } from "zod";
import { AiError } from "./errors";
import type { Part, SystemBlock, Task, TaskConfig, Turn } from "./server";

/**
 * OpenAI through the Responses API, called directly so the request is exactly what is written here.
 * - The paper comes first in every request about it, so OpenAI's automatic prompt caching reuses it.
 * - Structured answers use strict JSON Schema generated from the route's zod schema, then validated with zod.
 * - Nothing is stored on OpenAI's side (`store: false`).
 */
const ENDPOINT = "https://api.openai.com/v1/responses";

function model(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-6-luna";
}

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new AiError("The AI key isn't set up. Add OPENAI_API_KEY to .env.local and restart.", 401);
  return key;
}

export function openaiReady(): void {
  apiKey();
}

type InputContent = { type: "input_text"; text: string } | { type: "input_image"; image_url: string; detail: "high" };

function plainText(content: string | Part[]): string {
  return typeof content === "string" ? content : content.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n\n");
}

function userContent(content: string | Part[]): string | InputContent[] {
  if (typeof content === "string") return content;
  return content.map((p) => (p.type === "text" ? { type: "input_text", text: p.text } : { type: "input_image", image_url: p.dataUrl, detail: "high" }));
}

function input(system: SystemBlock[], turns: Turn[]) {
  return [
    ...system.map((b) => ({ role: "developer" as const, content: b.text })),
    ...turns.map((t) => (t.role === "assistant" ? { role: "assistant" as const, content: plainText(t.content) || "…" } : { role: "user" as const, content: userContent(t.content) })),
  ];
}

type Json = Record<string, unknown>;

/**
 * Strict structured outputs want every property listed as required and no others allowed; a property the zod
 * schema marks optional becomes "this, or null" (nulls are dropped again before validation).
 */
export function strictSchema(schema: z.ZodType): Json {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const out: Json = { ...(node as Json) };
    for (const k of ["$schema", "default", "minLength", "maxLength", "examples"]) delete out[k];
    if (out.items) out.items = walk(out.items);
    if (Array.isArray(out.anyOf)) out.anyOf = out.anyOf.map(walk);
    if (out.$defs && typeof out.$defs === "object") out.$defs = Object.fromEntries(Object.entries(out.$defs as Json).map(([k, v]) => [k, walk(v)]));
    if (out.type === "object" && out.properties && typeof out.properties === "object") {
      const required = new Set((out.required as string[] | undefined) ?? []);
      const props: Json = {};
      for (const [k, v] of Object.entries(out.properties as Json)) props[k] = required.has(k) ? walk(v) : { anyOf: [walk(v), { type: "null" }] };
      out.properties = props;
      out.required = Object.keys(props);
      out.additionalProperties = false;
    }
    return out;
  };
  return walk(z.toJSONSchema(schema)) as Json;
}

function dropNulls(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(dropNulls);
  if (!v || typeof v !== "object") return v;
  return Object.fromEntries(
    Object.entries(v as Json)
      .filter(([, x]) => x !== null)
      .map(([k, x]) => [k, dropNulls(x)]),
  );
}

async function httpError(res: Response): Promise<AiError> {
  const data = (await res.json().catch(() => null)) as { error?: { message?: string; code?: string } } | null;
  const message = data?.error?.message ?? "";
  const code = data?.error?.code ?? "";
  if (res.status === 401) return new AiError("The OpenAI key was rejected. Check OPENAI_API_KEY in .env.local.", 401);
  if (res.status === 403 || code === "model_not_found") return new AiError(`This OpenAI key can't use ${model()}.`, 403);
  if (res.status === 429) {
    return new AiError(code === "insufficient_quota" ? "The OpenAI account has run out of credit." : "The AI is busy right now. Try again in a moment.", 429);
  }
  if (res.status === 400) {
    console.error("Bad request to the model:", message);
    return new AiError("The request couldn't be processed.", 400);
  }
  console.error(`OpenAI error ${res.status}:`, message);
  return new AiError("The AI service had a problem. Try again.", 502);
}

async function post(body: Json, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey()}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err instanceof AiError || signal?.aborted) throw err;
    throw new AiError("Couldn't reach the AI service.", 502);
  }
  if (!res.ok) throw await httpError(res);
  return res;
}

interface ResponseBody {
  status?: string;
  model?: string;
  incomplete_details?: { reason?: string } | null;
  output?: { type: string; content?: { type: string; text?: string; refusal?: string }[] }[];
}

export async function openaiStructured<S extends z.ZodType>(
  task: Task,
  cfg: TaskConfig,
  opts: { schema: S; system: SystemBlock[]; content: string | Part[] },
): Promise<z.infer<S>> {
  const res = await post({
    model: model(),
    store: false,
    input: input(opts.system, [{ role: "user", content: opts.content }]),
    max_output_tokens: cfg.maxTokens,
    reasoning: { effort: cfg.effort },
    text: { format: { type: "json_schema", name: task, strict: true, schema: strictSchema(opts.schema) } },
  });
  const data = (await res.json()) as ResponseBody;
  if (data.status === "incomplete") {
    const reason = data.incomplete_details?.reason;
    if (reason === "content_filter") throw new AiError("The model declined this request.", 422);
    throw new AiError("That was too long to finish in one go.", 413);
  }
  const parts = (data.output ?? []).filter((o) => o.type === "message").flatMap((o) => o.content ?? []);
  if (parts.some((p) => p.type === "refusal")) throw new AiError("The model declined this request.", 422);
  const text = parts.flatMap((p) => (p.type === "output_text" && p.text ? [p.text] : [])).join("");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AiError("The model's answer couldn't be read.", 502);
  }
  const parsed = opts.schema.safeParse(dropNulls(json));
  if (!parsed.success) {
    console.error(`[${task}] answer didn't match the schema:`, parsed.error.message);
    throw new AiError("The model's answer couldn't be read.", 502);
  }
  return parsed.data;
}

/** Yields text as it arrives; returns the model that answered. */
export async function* openaiStream(
  task: Task,
  cfg: TaskConfig,
  opts: { system: SystemBlock[]; messages: Turn[]; signal?: AbortSignal },
): AsyncGenerator<string, string> {
  const res = await post(
    {
      model: model(),
      store: false,
      stream: true,
      input: input(opts.system, opts.messages),
      max_output_tokens: cfg.maxTokens,
      reasoning: { effort: cfg.effort },
    },
    opts.signal,
  );
  if (!res.body) throw new AiError("The AI service had a problem. Try again.", 502);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answered = model();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const data = chunk
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("\n");
      if (!data || data === "[DONE]") continue;
      let event: { type?: string; delta?: string; response?: { model?: string; error?: { message?: string } }; message?: string };
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }
      switch (event.type) {
        case "response.output_text.delta":
          if (event.delta) yield event.delta;
          break;
        case "response.refusal.delta":
          throw new AiError("The model declined this request.", 422);
        case "response.failed":
        case "error":
          console.error(`[${task}] stream failed:`, event.response?.error?.message ?? event.message ?? "");
          throw new AiError("The AI service had a problem. Try again.", 502);
        case "response.completed":
        case "response.incomplete":
          answered = event.response?.model ?? answered;
          break;
      }
    }
  }
  return answered;
}
