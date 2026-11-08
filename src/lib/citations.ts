/**
 * Models sometimes cite a run of sentences as a range ("[[p5s21-p5s24]]" or "[[p5s21–24]]"). Every citation is
 * written out id by id before it is read, so a range shows as page chips like any other citation. A range is capped
 * at 12 sentences and never crosses a page.
 */
export function expandCitationRanges(text: string): string {
  return text.replace(/\[\[([^\]\n]*?\d+s\d+\s*[-–—]\s*(?:p?\d+s)?\d+[^\]\n]*)\]\]/g, (whole, inner: string) => {
    const ids = inner.split(/\s*[,;]\s*/).flatMap((part) => {
      const m = /^p(\d+)s(\d+)\s*[-–—]\s*(?:p(\d+)s)?(\d+)$/.exec(part.trim());
      if (!m) return [part.trim()];
      const page = Number(m[1]);
      const from = Number(m[2]);
      const to = Number(m[4]);
      if ((m[3] && Number(m[3]) !== page) || to < from || to - from > 11) return [`p${page}s${from}`];
      return Array.from({ length: to - from + 1 }, (_, i) => `p${page}s${from + i}`);
    });
    return ids.every((id) => /^p\d+s\d+$/.test(id)) ? `[[${ids.join(", ")}]]` : whole;
  });
}
