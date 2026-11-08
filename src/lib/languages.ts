/** Languages a reader can translate into. `code` is a BCP 47 tag; `name` is how the language names itself. */
export interface Language {
  code: string;
  name: string;
  english: string;
  short: string;
  cjk: boolean;
}

export const LANGUAGES: Language[] = [
  { code: "zh-Hans", name: "简体中文", english: "Simplified Chinese", short: "中", cjk: true },
  { code: "zh-Hant", name: "繁體中文", english: "Traditional Chinese", short: "繁", cjk: true },
  { code: "ja", name: "日本語", english: "Japanese", short: "日", cjk: true },
  { code: "ko", name: "한국어", english: "Korean", short: "한", cjk: true },
  { code: "en", name: "English", english: "English", short: "En", cjk: false },
  { code: "es", name: "Español", english: "Spanish", short: "Es", cjk: false },
  { code: "fr", name: "Français", english: "French", short: "Fr", cjk: false },
  { code: "de", name: "Deutsch", english: "German", short: "De", cjk: false },
  { code: "pt", name: "Português", english: "Portuguese", short: "Pt", cjk: false },
  { code: "ru", name: "Русский", english: "Russian", short: "Ru", cjk: false },
];

export function languageByCode(code: string): Language {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}

/** First non-English language the browser prefers, else Simplified Chinese. */
export function defaultTargetLanguage(): string {
  if (typeof navigator === "undefined") return "zh-Hans";
  for (const tag of navigator.languages ?? [navigator.language]) {
    const t = tag.toLowerCase();
    if (t.startsWith("en")) continue;
    if (t.startsWith("zh")) return /tw|hk|mo|hant/.test(t) ? "zh-Hant" : "zh-Hans";
    const hit = LANGUAGES.find((l) => t.startsWith(l.code.toLowerCase()));
    if (hit) return hit.code;
  }
  return "zh-Hans";
}
