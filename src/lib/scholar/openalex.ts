import "server-only";

/**
 * Real later work for a paper, from OpenAlex (open scholarly metadata, CC0, no key needed). Used so that "what came
 * after" names papers that exist, instead of what a model remembers. Every call is optional: a slow or failed lookup
 * leaves the answer to the model's own, labelled, knowledge.
 */

export interface LaterWork {
  title: string;
  year: number | null;
  firstAuthor: string;
  citedBy: number;
}

export interface Lineage {
  /** How many works in OpenAlex cite this paper. */
  citedBy: number;
  /** The most-cited of them. */
  top: LaterWork[];
}

const BASE = "https://api.openalex.org";
const TIMEOUT = 3500;
const cache = new Map<string, Promise<Lineage | null>>();

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), headers: { accept: "application/json" }, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type Work = {
  id: string;
  display_name?: string;
  publication_year?: number;
  cited_by_count?: number;
  authorships?: { author?: { display_name?: string } }[];
};

/** The paper itself, found by its exact title (a near-miss is no match: a wrong paper's citers would mislead). */
async function findWork(title: string): Promise<Work | null> {
  const want = norm(title);
  if (want.length < 8) return null;
  const q = encodeURIComponent(title.slice(0, 300));
  const res = await getJson<{ results: Work[] }>(`${BASE}/works?search=${q}&per-page=5&select=id,display_name,publication_year,cited_by_count`);
  return res?.results.find((w) => norm(w.display_name ?? "") === want) ?? null;
}

export function lineage(title: string, limit = 12): Promise<Lineage | null> {
  const key = `${norm(title)}:${limit}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const job = (async () => {
    const work = await findWork(title);
    if (!work) return null;
    const id = work.id.split("/").pop();
    const res = await getJson<{ results: Work[] }>(
      `${BASE}/works?filter=cites:${id}&sort=cited_by_count:desc&per-page=${limit}&select=display_name,publication_year,cited_by_count,authorships`,
    );
    if (!res) return null;
    const seen = new Set<string>();
    const top = res.results
      .map((w) => ({
        title: (w.display_name ?? "").trim(),
        year: w.publication_year ?? null,
        firstAuthor: w.authorships?.[0]?.author?.display_name ?? "",
        citedBy: w.cited_by_count ?? 0,
      }))
      // OpenAlex sometimes lists a preprint and its published version as two works.
      .filter((w) => w.title && !seen.has(norm(w.title)) && seen.add(norm(w.title)));
    return { citedBy: work.cited_by_count ?? 0, top };
  })();
  cache.set(key, job);
  void job.then((v) => {
    if (!v) cache.delete(key);
  });
  return job;
}

/** The works citing this paper that come closest to the reader's own research (by OpenAlex's relevance search). */
export function nearReader(title: string, research: string, limit = 8): Promise<LaterWork[] | null> {
  const topic = research.replace(/\s+/g, " ").trim().slice(0, 240);
  if (topic.length < 6) return Promise.resolve(null);
  const key = `near:${norm(title)}:${norm(topic)}`;
  const hit = nearCache.get(key);
  if (hit) return hit;
  const job = (async () => {
    const work = await findWork(title);
    if (!work) return null;
    const id = work.id.split("/").pop();
    const res = await getJson<{ results: Work[] }>(
      `${BASE}/works?filter=cites:${id}&search=${encodeURIComponent(topic)}&per-page=${limit}&select=display_name,publication_year,cited_by_count,authorships`,
    );
    if (!res) return null;
    return res.results
      .map((w) => ({
        title: (w.display_name ?? "").trim(),
        year: w.publication_year ?? null,
        firstAuthor: w.authorships?.[0]?.author?.display_name ?? "",
        citedBy: w.cited_by_count ?? 0,
      }))
      .filter((w) => w.title);
  })();
  nearCache.set(key, job);
  void job.then((v) => {
    if (!v) nearCache.delete(key);
  });
  return job;
}

const nearCache = new Map<string, Promise<LaterWork[] | null>>();

/** Whatever arrives within `ms`; otherwise none this time (the lookup goes on, and is cached for the next ask). */
export async function within<T>(job: Promise<T | null>, ms = 3500): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([job, late]);
  } finally {
    clearTimeout(timer);
  }
}
