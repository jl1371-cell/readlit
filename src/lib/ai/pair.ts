"use client";
import { postJSON } from "./client";

/**
 * The English version of texts the AI wrote in the reader's language, keyed by the caller's ids. Long lists go in
 * a few requests at once; an id the model left out simply has no English line.
 */
export async function englishOf(texts: { id: string; text: string }[], lang: string, title: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const todo = texts.filter((t) => t.text.trim());
  const chunks: (typeof todo)[] = [];
  for (let i = 0; i < todo.length; i += 40) chunks.push(todo.slice(i, i + 40));
  const results = await Promise.all(
    chunks.map((texts) => postJSON<{ texts: { id: string; text: string }[] }>("/api/pair", { title, lang, texts })),
  );
  const wanted = new Set(todo.map((t) => t.id));
  for (const r of results) for (const t of r.texts) if (wanted.has(t.id) && t.text.trim()) out[t.id] = t.text.trim();
  return out;
}
