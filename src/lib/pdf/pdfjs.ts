/** Lazily loads pdf.js in the browser with its worker and data files served from our own origin. */
import type * as PdfJs from "pdfjs-dist";

let lib: Promise<typeof PdfJs> | null = null;

export function pdfjs(): Promise<typeof PdfJs> {
  if (!lib) {
    lib = import("pdfjs-dist").then((m) => {
      m.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
      return m;
    });
  }
  return lib;
}

export async function openPdf(data: ArrayBuffer) {
  const m = await pdfjs();
  // pdf.js transfers the buffer to its worker; give it a copy so the caller's bytes stay usable.
  const task = m.getDocument({
    data: new Uint8Array(data.slice(0)),
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    wasmUrl: "/pdfjs/wasm/",
    // Exposes pdf.js's own judgement of whether a font is serif (from its name, not only its flags), so translated
    // text can follow the paper's typeface.
    fontExtraProperties: true,
  });
  return task.promise;
}

// The faces papers are set in. pdf.js's own serif list misses several (NimbusRomNo9L, the Times that arXiv's
// LaTeX uses, among them), so the font's name decides; sans names are checked first.
const SANS = /sans|nimbussan|helvet|arial|gothic|grotesk|biolinum|cmss|lmsans|frutiger|myriad|calibri|verdana|roboto|inter\b/i;
const SERIF =
  /times|roman|serif|nimbusrom|termes|pagella|schola|bonum|^cm(r|bx|ti|sl|csc)\d|^sf(rm|bx|ti)\d|lmroman|libertine|palatino|palladio|garamond|minion|georgia|baskerville|caslon|cambria|charter|utopia|bookman|century|stix|merriweather|tinos|charis|lucidabright|songti|mincho|ming/i;

/**
 * Whether the paper's body text is set in a serif face: the font carrying most of page 1's text, as pdf.js judges
 * it. The generic family pdf.js reports with text content says "sans-serif" for many Times-like fonts, so it isn't
 * enough on its own. Null when it can't be told.
 */
export async function bodyIsSerif(page: PdfJs.PDFPageProxy, content: { items: unknown[] }): Promise<boolean | null> {
  const weight = new Map<string, number>();
  for (const it of content.items) {
    const item = it as { str?: string; fontName?: string };
    if (item.fontName && item.str) weight.set(item.fontName, (weight.get(item.fontName) ?? 0) + item.str.length);
  }
  const body = [...weight].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!body) return null;
  try {
    // The operator list loads the page's fonts into the document's shared objects.
    await page.getOperatorList();
    if (!page.commonObjs.has(body)) return null;
    const font = page.commonObjs.get(body) as { isSerifFont?: boolean; name?: string } | undefined;
    const name = (font?.name ?? "").replace(/^[A-Z]{6}\+/, "");
    if (SANS.test(name)) return false;
    if (font?.isSerifFont || SERIF.test(name)) return true;
    return name ? false : null;
  } catch {
    return null;
  }
}
