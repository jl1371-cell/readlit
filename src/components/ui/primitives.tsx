"use client";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import clsx from "clsx";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="ml-1.5 inline-flex min-w-[20px] items-center justify-center rounded-[5px] border border-latte-line/50 bg-paper px-1 font-sans text-caption text-latte">
      {children}
    </kbd>
  );
}

export function Tip({ label, keys, children, side = "bottom" }: { label: string; keys?: string; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <TooltipPrimitive.Root delayDuration={450}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={8}
          className="z-[80] flex items-center rounded-lg border border-latte-line/40 bg-paper px-2.5 py-1.5 text-label text-ink shadow-card"
        >
          {label}
          {keys && <Kbd>{keys}</Kbd>}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export const TipProvider = TooltipPrimitive.Provider;

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; size?: "sm" | "md" };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { active, size = "md", className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={clsx(
        "inline-flex items-center justify-center rounded-full text-latte-deep transition-colors duration-150",
        "hover:bg-parchment/70 hover:text-ink disabled:pointer-events-none disabled:opacity-40",
        size === "md" ? "h-8 w-8" : "h-7 w-7",
        active && "bg-parchment text-ink",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

type PillProps = ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "quiet" | "outline"; active?: boolean };

export const Pill = forwardRef<HTMLButtonElement, PillProps>(function Pill({ tone = "quiet", active, className, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={clsx(
        "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-ui font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-45",
        tone === "primary" && "bg-paprika text-white hover:bg-paprika-soft",
        tone === "quiet" && "text-latte-deep hover:bg-parchment/70 hover:text-ink",
        tone === "outline" && "border border-latte-line/60 bg-paper text-ink hover:bg-parchment/50",
        active && tone !== "primary" && "bg-parchment text-ink",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
