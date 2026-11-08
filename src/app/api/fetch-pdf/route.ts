import { lookup } from "node:dns/promises";
import net from "node:net";

// A large PDF from a slow server takes a while to pass through.
export const maxDuration = 120;

const MAX_BYTES = 60 * 1024 * 1024;

function isPrivate(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v6 = ip.toLowerCase();
  return v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80") || v6.startsWith("::ffff:");
}

/** Turn common paper links into direct PDF links. */
function normalize(raw: string): URL | null {
  let s = raw.trim().replace(/^<|>$/g, "");
  const arxivId = s.match(/^(?:arxiv:\s*)?(\d{4}\.\d{4,5})(v\d+)?$/i);
  if (arxivId) s = `https://arxiv.org/pdf/${arxivId[1]}${arxivId[2] ?? ""}`;
  // "arxiv.org/abs/…" or "www.example.org/paper.pdf" without a scheme.
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(s) && /^[\w-]+(\.[\w-]+)+(\/|$)/.test(s)) s = `https://${s}`;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (/(^|\.)arxiv\.org$/.test(url.hostname)) {
    const m = url.pathname.match(/^\/(abs|pdf|html)\/([^/]+?)(\.pdf)?$/);
    if (m) url = new URL(`https://arxiv.org/pdf/${m[2]}`);
  }
  if (url.hostname === "openreview.net" && url.pathname === "/forum") {
    url = new URL(`https://openreview.net/pdf?id=${url.searchParams.get("id") ?? ""}`);
  }
  return url;
}

async function safeFetch(url: URL, hops = 0): Promise<Response> {
  if (hops > 4) throw new Error("Too many redirects.");
  const host = url.hostname;
  if (host === "localhost" || host.endsWith(".local") || net.isIP(host)) throw new Error("That address isn't allowed.");
  const addrs = await lookup(host, { all: true });
  if (addrs.some((a) => isPrivate(a.address))) throw new Error("That address isn't allowed.");
  // no-store: a PDF passing through must never be copied into Next's data cache (which would also hold it in memory).
  const res = await fetch(url, {
    cache: "no-store",
    redirect: "manual",
    headers: { "user-agent": "ReadLit/0.1 (paper reader)", accept: "application/pdf,*/*" },
  });
  if (res.status >= 300 && res.status < 400) {
    const next = res.headers.get("location");
    if (!next) throw new Error("Broken redirect.");
    return safeFetch(new URL(next, url), hops + 1);
  }
  return res;
}

/** The bytes read so far, as one array. */
function joined(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("url") ?? "";
  const url = normalize(raw);
  if (!url) return Response.json({ error: "That doesn't look like a link to a paper." }, { status: 400 });
  try {
    const res = await safeFetch(url);
    if (!res.ok || !res.body) return Response.json({ error: `The site answered ${res.status}.` }, { status: 502 });
    if (Number(res.headers.get("content-length")) > MAX_BYTES) {
      void res.body.cancel().catch(() => {});
      return Response.json({ error: "That PDF is too large." }, { status: 413 });
    }
    // Look at the first bytes before answering, so a web page gets a clear message instead of being passed on.
    const reader = res.body.getReader();
    const head: Uint8Array[] = [];
    let size = 0;
    while (size < 5) {
      const { done, value } = await reader.read();
      if (done) break;
      head.push(value);
      size += value.byteLength;
    }
    const first = joined(head);
    const type = res.headers.get("content-type") ?? "";
    const isPdf = type.includes("pdf") || (first[0] === 0x25 && first[1] === 0x50 && first[2] === 0x44 && first[3] === 0x46);
    if (!isPdf || !first.byteLength) {
      void reader.cancel().catch(() => {});
      return Response.json({ error: "That link isn't a PDF. Try the paper's PDF link." }, { status: 415 });
    }
    const name = (url.pathname.split("/").pop() || "paper").replace(/[^\w.-]+/g, "_");
    // Passed on as it arrives: a hosted function may answer with at most 4.5 MB at once, but a stream has no such
    // cap, and nothing waits on the whole file in memory. The size limit still holds for servers that don't say
    // how large the file is.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(first);
      },
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) return controller.close();
        size += value.byteLength;
        if (size > MAX_BYTES) {
          controller.error(new Error("That PDF is too large."));
          void reader.cancel().catch(() => {});
          return;
        }
        controller.enqueue(value);
      },
      cancel(reason) {
        void reader.cancel(reason).catch(() => {});
      },
    });
    return new Response(body, {
      headers: {
        "content-type": "application/pdf",
        "cache-control": "no-store",
        "x-file-name": name.endsWith(".pdf") ? name : `${name}.pdf`,
      },
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Couldn't fetch that PDF." }, { status: 502 });
  }
}
