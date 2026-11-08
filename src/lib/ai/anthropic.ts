import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { AiError } from "./errors";
import type { Part, SystemBlock, Task, TaskConfig, Turn } from "./server";

/**
 * Claude, kept as the second provider (AI_PROVIDER=anthropic). Opus 5.5 with effort per task; server-side
 * fallbacks are on so a safety decline is retried on Anthropic's recommended model instead of failing.
 */
const MODEL = "claude-opus-5-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  // A key from another provider gets a clear message instead of a vague authentication error.
  if (!key || !key.startsWith("sk-ant-")) {
    throw new AiError("The AI key isn't set up. Add an Anthropic API key as ANTHROPIC_API_KEY in .env.local and restart.", 401);
  }
  client ??= new Anthropic({ apiKey: key });
  return client;
}

export function anthropicReady(): void {
  anthropic();
}

/** The cached blocks get the 1-hour lifetime; `plain` drops it for accounts that don't accept it. */
function systemBlocks(system: SystemBlock[], plain: boolean): Anthropic.Beta.BetaTextBlockParam[] {
  return system.map((b) =>
    b.cache ? { type: "text", text: b.text, cache_control: plain ? { type: "ephemeral" } : { type: "ephemeral", ttl: "1h" } } : { type: "text", text: b.text },
  );
}

function content(c: string | Part[]): string | Anthropic.Beta.BetaContentBlockParam[] {
  if (typeof c === "string") return c;
  return c.map((p) =>
    p.type === "text"
      ? { type: "text", text: p.text }
      : { type: "image", source: { type: "base64", media_type: "image/png", data: p.dataUrl.slice(p.dataUrl.indexOf(",") + 1) } },
  );
}

function toAiError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  if (err instanceof Anthropic.AuthenticationError) return new AiError("The AI key isn't set up. Add ANTHROPIC_API_KEY to .env.local and restart.", 401);
  if (err instanceof Anthropic.PermissionDeniedError) return new AiError("This AI key can't use that model.", 403);
  if (err instanceof Anthropic.RateLimitError) return new AiError("The AI is busy right now. Try again in a moment.", 429);
  if (err instanceof Anthropic.BadRequestError) {
    console.error("Bad request to the model:", err.message);
    return new AiError("The request couldn't be processed.", 400);
  }
  if (err instanceof Anthropic.APIConnectionError) return new AiError("Couldn't reach the AI service.", 502);
  if (err instanceof Anthropic.APIError) return new AiError("The AI service had a problem. Try again.", 502);
  console.error(err);
  return new AiError("Something went wrong.", 500);
}

export async function anthropicStructured<S extends z.ZodType>(
  task: Task,
  cfg: TaskConfig,
  opts: { schema: S; system: SystemBlock[]; content: string | Part[] },
): Promise<z.infer<S>> {
  const request = (plain: boolean) =>
    anthropic().beta.messages.parse({
      model: MODEL,
      max_tokens: cfg.maxTokens,
      ...(plain ? {} : { betas: [FALLBACK_BETA], fallbacks: "default" as const }),
      output_config: { effort: cfg.effort, format: betaZodOutputFormat(opts.schema) },
      system: systemBlocks(opts.system, plain),
      messages: [{ role: "user", content: content(opts.content) }],
    });
  try {
    let res;
    try {
      res = await request(false);
    } catch (err) {
      // An account without the fallback beta or the 1-hour cache gets the plain request instead of an error.
      if (!(err instanceof Anthropic.BadRequestError)) throw err;
      console.warn(`[${task}] retrying without optional features:`, err.message);
      res = await request(true);
    }
    if (res.stop_reason === "refusal") throw new AiError("The model declined this request.", 422);
    if (res.stop_reason === "max_tokens") throw new AiError("That was too long to finish in one go.", 413);
    if (res.parsed_output == null) throw new AiError("The model's answer couldn't be read.", 502);
    return res.parsed_output as z.infer<S>;
  } catch (err) {
    throw toAiError(err);
  }
}

/** Yields text as it arrives; returns the model that answered. */
export async function* anthropicStream(
  task: Task,
  cfg: TaskConfig,
  opts: { system: SystemBlock[]; messages: Turn[]; signal?: AbortSignal },
): AsyncGenerator<string, string> {
  const messages: Anthropic.Beta.BetaMessageParam[] = opts.messages.map((m) => ({ role: m.role, content: content(m.content) }));
  const open = (plain: boolean) =>
    anthropic().beta.messages.stream(
      {
        model: MODEL,
        max_tokens: cfg.maxTokens,
        ...(plain ? {} : { betas: [FALLBACK_BETA], fallbacks: "default" as const }),
        output_config: { effort: cfg.effort },
        system: systemBlocks(opts.system, plain),
        messages,
      },
      { signal: opts.signal },
    );
  try {
    let stream = open(false);
    let sent = false;
    try {
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          sent = true;
          yield event.delta.text;
        }
      }
    } catch (err) {
      if (!(err instanceof Anthropic.BadRequestError) || sent) throw err;
      console.warn(`[${task}] retrying without optional features:`, err.message);
      stream = open(true);
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield event.delta.text;
      }
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") throw new AiError("The model declined this request.", 422);
    return final.model;
  } catch (err) {
    throw toAiError(err);
  }
}
