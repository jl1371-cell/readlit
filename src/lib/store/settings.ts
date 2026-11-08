"use client";
import { create } from "zustand";
import { dbGet, dbSet, keys } from "@/lib/db";
import { defaultTargetLanguage } from "@/lib/languages";

export interface Settings {
  /**
   * The reader's language. One setting for everything: the paper is translated into it, and everything the AI writes
   * (the brief, explanations, answers, the mind map) is written in it.
   */
  lang: string;
  /** Under each paragraph the AI writes, the same paragraph in English, one step quieter. */
  bilingual: boolean;
  /** Underline the brief's key points in the paper. */
  marks: boolean;
  /** What the reader works on, in their words; the AI uses it to say what a paper means for them. */
  research: string;
  /** The same in English, to search the papers that cite this one for the closest to the reader's work. */
  researchEn: string;
}

export type LensKind = "claim" | "method" | "result" | "limitation";

interface SettingsState extends Settings {
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<Settings>) => void;
}

const defaults = (): Settings => ({ lang: defaultTargetLanguage(), bilingual: true, marks: false, research: "", researchEn: "" });

/** Settings saved before there was one language setting kept two (translations, and what the AI writes). */
type Saved = Partial<Settings> & { targetLang?: string; explainLang?: string };

export const useSettings = create<SettingsState>((set, get) => ({
  ...defaults(),
  loaded: false,
  load: async () => {
    const saved = await dbGet<Saved>(keys.settings());
    const lang = saved?.lang ?? saved?.explainLang ?? saved?.targetLang;
    set({
      ...defaults(),
      ...(lang ? { lang } : {}),
      ...(typeof saved?.bilingual === "boolean" ? { bilingual: saved.bilingual } : {}),
      ...(typeof saved?.marks === "boolean" ? { marks: saved.marks } : {}),
      ...(typeof saved?.research === "string" ? { research: saved.research } : {}),
      ...(typeof saved?.researchEn === "string" ? { researchEn: saved.researchEn } : {}),
      loaded: true,
    });
  },
  update: (patch) => {
    set(patch);
    const { lang, bilingual, marks, research, researchEn } = { ...get(), ...patch };
    void dbSet(keys.settings(), { lang, bilingual, marks, research, researchEn });
  },
}));

/** Whether what the AI writes gets an English version under it: asked for, and the reader's language isn't English. */
export function pairsWanted(s: Pick<Settings, "lang" | "bilingual"> = useSettings.getState()): boolean {
  return s.bilingual && !s.lang.toLowerCase().startsWith("en");
}

export function usePairs(): boolean {
  return useSettings((s) => pairsWanted(s));
}
