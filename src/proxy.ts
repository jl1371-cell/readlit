import { type NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, accessCode, accessToken, limiter, sameText, visitor } from "@/lib/access";

/** The routes that call the AI, so cost money. */
const AI_ROUTES = new Set(["/api/chat", "/api/brief", "/api/mindmap", "/api/translate", "/api/translate-labels", "/api/figure-text", "/api/lookup", "/api/pair"]);

// Generous for one person reading (a drafted map alone is about ten calls), tight for a script.
const perMinute = limiter(90, 60_000);
const perDay = limiter(2500, 24 * 60 * 60_000);

/**
 * Before any page or API route: with an access code set, nothing but the code page answers until the visitor has
 * entered it; then the AI routes are limited per visitor.
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const code = accessCode();
  if (code && pathname !== "/api/access" && pathname !== "/access") {
    const token = req.cookies.get(ACCESS_COOKIE)?.value ?? "";
    if (!sameText(token, await accessToken(code))) {
      if (pathname.startsWith("/api/")) return NextResponse.json({ error: "This ReadLit needs its access code. Reload the page to enter it." }, { status: 401 });
      const url = req.nextUrl.clone();
      url.pathname = "/access";
      return NextResponse.rewrite(url);
    }
  }
  if (AI_ROUTES.has(pathname)) {
    const who = visitor(req.headers);
    if (!perMinute(who) || !perDay(who)) {
      return NextResponse.json({ error: "That's a lot of requests at once. Wait a minute, then try again." }, { status: 429 });
    }
  }
  return NextResponse.next();
}

export const config = {
  // Everything but the built assets and the PDF engine's files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|pdfjs/).*)"],
};
