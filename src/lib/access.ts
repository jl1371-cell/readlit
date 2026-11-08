/**
 * A deployed ReadLit can be closed behind an access code, so that only the people given the code spend its AI budget.
 * The code lives in the server's environment (READLIT_ACCESS_CODE); the browser keeps only a token derived from it,
 * so changing the code signs everyone out. With no code set, the app is open on this computer and shut when deployed.
 */
export const ACCESS_COOKIE = "readlit_access";

export function accessCode(): string | null {
  return process.env.READLIT_ACCESS_CODE?.trim() || null;
}

/**
 * A deployed copy (Vercel sets VERCEL=1) with no code stays shut instead of open, so a forgotten setting never hands
 * the AI budget to everyone who finds the address.
 */
export function needsSetup(): boolean {
  return !accessCode() && !!process.env.VERCEL;
}

export async function accessToken(code: string): Promise<string> {
  const bytes = new TextEncoder().encode(`readlit-access:${code}`);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The same strings, compared in constant time. */
export function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * A small per-visitor limit, kept in memory: a burst guard in front of the AI routes and the code form. It is best
 * effort (each server instance counts on its own); the hard ceiling on spending is the budget set on the OpenAI key.
 */
export function limiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    return true;
  };
}

export function visitor(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}
