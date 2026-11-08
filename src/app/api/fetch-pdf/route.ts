import { lookup } from "node:dns/promises";
import net from "node:net";

export const maxDuration = 60;

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
  const res = await fetch(url, { redirect: "manual", headers: { "user-agent": "ReadLit/0.1 (paper reader)", accept: "application/pdf,*/*" } });
  if (res.status >= 300 && res.status < 400) {
    const next = res.headers.get("location");
    if (!next) throw new Error("Broken redirect.");
    return safeFetch(new URL(next, url), hops + 1);
  }
  return res;
}

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("url") ?? "";
  const url = normalize(raw);
  if (!url) return Response.json({ error: "That doesn't look like a link to a paper." }, { status: 400 });
  try {
    const res = await safeFetch(url);
    if (!res.ok || !res.body) return Response.json({ error: `The site answered ${res.status}.` }, { status: 502 });
    const type = res.headers.get("content-type") ?? "";
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) return Response.json({ error: "That PDF is too large." }, { status: 413 });
    const isPdf = type.includes("pdf") || (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46);
    if (!isPdf) return Response.json({ error: "That link isn't a PDF. Try the paper's PDF link." }, { status: 415 });
    const name = (url.pathname.split("/").pop() || "paper").replace(/[^\w.-]+/g, "_");
    return new Response(buf, {
      headers: { "content-type": "application/pdf", "x-file-name": name.endsWith(".pdf") ? name : `${name}.pdf` },
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Couldn't fetch that PDF." }, { status: 502 });
  }
}
