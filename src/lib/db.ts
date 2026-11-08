/**
 * Local-first persistence. Papers, derived text, translations, chats and maps live in IndexedDB on this device;
 * nothing is uploaded except the text a request sends to the model. Each record is written on its own, never as
 * a whole-database rewrite.
 */
import { createStore, del, entries, get, set } from "idb-keyval";

const store = typeof indexedDB !== "undefined" ? createStore("readlit", "kv") : undefined;

export async function dbGet<T>(key: string): Promise<T | undefined> {
  if (!store) return undefined;
  try {
    return await get<T>(key, store);
  } catch {
    return undefined;
  }
}

export async function dbSet<T>(key: string, value: T): Promise<void> {
  if (!store) return;
  try {
    await set(key, value, store);
  } catch (err) {
    console.warn("Could not save", key, err);
  }
}

export async function dbDel(key: string): Promise<void> {
  if (!store) return;
  try {
    await del(key, store);
  } catch {
    /* nothing to remove */
  }
}

export async function dbEntries<T>(prefix: string): Promise<[string, T][]> {
  if (!store) return [];
  try {
    const all = await entries<string, T>(store);
    return all.filter(([k]) => typeof k === "string" && k.startsWith(prefix));
  } catch {
    return [];
  }
}

export const keys = {
  paperMeta: (id: string) => `paper:${id}`,
  paperFile: (id: string) => `file:${id}`,
  /** Versioned with the text model: sentence ids are only stable within one version of it. */
  translations: (id: string, lang: string) => `tr3:${id}:${lang}`,
  chat: (id: string) => `chat:${id}`,
  map: (id: string) => `map:${id}`,
  brief: (id: string) => `brief:${id}`,
  highlights: (id: string) => `hl:${id}`,
  reading: (id: string) => `read:${id}`,
  settings: () => "settings",
};
