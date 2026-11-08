import { expandCitationRanges } from "@/lib/citations";

const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", theta: "θ", lambda: "λ", mu: "μ",
  pi: "π", sigma: "σ", tau: "τ", phi: "φ", omega: "ω", Delta: "Δ", Sigma: "Σ", Omega: "Ω",
};

/** Inline LaTeX, read as plain text: the common commands become their symbols, the rest drops its markup. */
function plainMath(m: string): string {
  return m
    .replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\{([^{}]*)\}/g, "$1")
    .replace(/\\sqrt\{([^{}]*)\}/g, "√$1")
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1/$2")
    .replace(/\\(times|cdot|leq?|geq?|approx|infty|to|rightarrow|in|sum)\b/g, (_, c: string) =>
      ({ times: "×", cdot: "·", le: "≤", leq: "≤", ge: "≥", geq: "≥", approx: "≈", infty: "∞", to: "→", rightarrow: "→", in: "∈", sum: "Σ" })[c] ?? c,
    )
    .replace(/\\([A-Za-z]+)/g, (_, c: string) => GREEK[c] ?? c)
    .replace(/[_^]\{([^{}]*)\}/g, (t, x: string) => `${t[0]}${x}`)
    .replace(/[{}]/g, "");
}

/**
 * Before rendering: citations that sit side by side become one chip group, and inline LaTeX is read as plain text
 * (models sometimes write it although they are asked not to; raw "\(t\)" reads badly).
 */
export function tidy(text: string): string {
  // While an answer streams in, its newest citation can arrive half-written ("[[p6"); it waits until it is whole
  // instead of flashing as raw brackets.
  return expandCitationRanges(text.replace(/\[\[[^\]\n]*\]?$/, ""))
    .replace(/\r/g, "")
    // Citations side by side become one chip group (the beyond-the-paper marker is never merged into one).
    .replace(/(\[\[\s*p\d+s\d+[^\]]*)\]\]\s*\[\[(?=\s*p\d+s\d+)/g, "$1, ")
    // A citation sits after the punctuation that ends its sentence, so a chip never leaves "。" or "." alone at the
    // start of a line.
    .replace(/[ \t]*(\[\[[^\]\n]+\]\])[ \t]*([。．，、；：！？）」』.,;:!?)]+)/g, (_, cite: string, mark: string) =>
      /^[。．，、；：！？）」』]/.test(mark) ? `${mark}${cite}` : `${mark} ${cite}`,
    )
    .replace(/\\\(\s*([^\n]*?)\s*\\\)/g, (_, m: string) => plainMath(m))
    .replace(/\\\[\s*([^\n]*?)\s*\\\]/g, (_, m: string) => plainMath(m))
    .replace(/\$(?=[^$\n]*[\\^_{])([^$\n]{1,80})\$/g, (_, m: string) => plainMath(m));
}
