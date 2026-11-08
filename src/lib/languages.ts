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

/** The language a new reader starts in. */
export function defaultTargetLanguage(): string {
  // English first: the papers are in English and so are most readers we show it to. Every other language is one
  // choice away in the language menu, and a reader's choice is saved and wins over this default.
  return "en";
}
