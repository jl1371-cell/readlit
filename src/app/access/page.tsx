import { AccessForm } from "./AccessForm";

export const metadata = { title: "ReadLit" };

/** The door of a deployed ReadLit: the one thing shown until the access code is entered. */
export default function AccessPage() {
  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-canvas px-6">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 45% at 50% 0%, rgba(233,167,82,0.10), transparent 65%), radial-gradient(ellipse 50% 40% at 85% 85%, rgba(166,209,230,0.10), transparent 70%)",
        }}
      />
      <main className="relative w-full max-w-[24rem] rounded-3xl border border-latte-line/40 bg-paper px-8 pb-8 pt-9 text-center shadow-card-hover">
        <div className="flex items-center justify-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-paprika shadow-card" aria-hidden>
            <span className="font-display text-heading font-semibold leading-none text-paper">R</span>
          </span>
          <span className="font-display text-title font-semibold text-ink">ReadLit</span>
        </div>
        <p className="mt-5 text-body text-ink-soft">Read any paper, in place.</p>
        <p className="mt-1 text-ui text-latte">This preview is open to people with its access code.</p>
        <AccessForm />
      </main>
    </div>
  );
}
