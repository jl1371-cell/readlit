"use client";
import { ArrowRight } from "lucide-react";
import { useState } from "react";

export function AccessForm() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-6"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!code.trim() || busy) return;
        setBusy(true);
        setError(null);
        const res = await fetch("/api/access", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code }),
        }).catch(() => null);
        if (res?.ok) {
          window.location.replace("/");
          return;
        }
        const body = (await res?.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Couldn't check the code. Try again.");
        setBusy(false);
      }}
    >
      <label className="sr-only" htmlFor="access-code">
        Access code
      </label>
      <div className="flex items-center gap-1.5 rounded-full border border-latte-line/60 bg-canvas/60 p-1.5 pl-4 transition-colors focus-within:border-latte">
        <input
          id="access-code"
          type="password"
          autoComplete="off"
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Access code"
          className="h-9 min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-latte/80"
        />
        <button
          type="submit"
          disabled={!code.trim() || busy}
          aria-label="Continue"
          className="inline-flex h-9 items-center gap-1 rounded-full bg-paprika px-4 text-ui font-medium text-white transition-colors hover:bg-paprika-soft disabled:opacity-40"
        >
          {busy ? "Checking…" : "Continue"}
          {!busy && <ArrowRight className="h-4 w-4" />}
        </button>
      </div>
      <p role="status" className="mt-3 min-h-[1.25rem] text-label text-paprika">
        {error}
      </p>
    </form>
  );
}
