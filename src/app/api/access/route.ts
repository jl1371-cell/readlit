import { ACCESS_COOKIE, accessCode, accessToken, limiter, sameText, visitor } from "@/lib/access";

const attempts = limiter(12, 10 * 60_000);

/** Check the access code; when it matches, the browser keeps a token for 30 days. */
export async function POST(req: Request) {
  const code = accessCode();
  if (!code) return Response.json({ ok: true });
  if (!attempts(visitor(req.headers))) return Response.json({ error: "Too many tries. Wait a few minutes." }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
  const given = typeof body?.code === "string" ? body.code.trim() : "";
  if (!given || !sameText(await accessToken(given), await accessToken(code))) {
    await new Promise((r) => setTimeout(r, 600));
    return Response.json({ error: "That code doesn't work." }, { status: 401 });
  }
  const res = Response.json({ ok: true });
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  res.headers.append("set-cookie", `${ACCESS_COOKIE}=${await accessToken(code)}; Path=/; Max-Age=${30 * 24 * 60 * 60}; HttpOnly; SameSite=Lax${secure}`);
  return res;
}
