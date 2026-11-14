"use client";
// Minimal shadcn/ui-style primitives (hand-written; the shadcn CLI registry was not reachable from the build sandbox).
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { Loader2 } from "lucide-react";
import * as React from "react";

export const cn = (...c: ClassValue[]) => twMerge(clsx(c));

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "outline" | "ok" | "danger"; loading?: boolean; size?: "sm" | "md";
};
export function Button({ variant = "primary", size = "md", loading, className, children, disabled, ...p }: BtnProps) {
  return (
    <button
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        size === "sm" ? "h-8 px-3 text-xs" : "h-9 px-4 text-sm",
        variant === "primary" && "bg-brand text-white hover:bg-brand/90",
        variant === "ok" && "bg-ok text-black hover:bg-ok/90",
        variant === "danger" && "bg-bad/90 text-white hover:bg-bad",
        variant === "outline" && "border border-line bg-panel-2 hover:bg-line/60",
        variant === "ghost" && "hover:bg-line/50 text-muted hover:text-fg",
        className,
      )}
      {...p}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-line bg-panel/80 backdrop-blur", className)} {...p} />;
}

export function CardHeader({ title, icon, right, sub }: { title: string; icon?: React.ReactNode; right?: React.ReactNode; sub?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
      <div className="flex items-center gap-2">
        {icon && <span className="text-brand">{icon}</span>}
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {sub && <p className="text-xs text-muted">{sub}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

const tones = {
  neutral: "bg-line/60 text-muted",
  brand: "bg-brand-soft text-brand",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
};
export function Badge({ tone = "neutral", className, ...p }: React.HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium", tones[tone], className)} {...p} />;
}

export function statusTone(s?: string): keyof typeof tones {
  if (!s) return "neutral";
  if (["resolved", "active", "verified", "success"].includes(s)) return "ok";
  if (["awaiting_approval", "running", "human_corrected", "superseded"].includes(s)) return "warn";
  if (["failed", "rejected", "invalidated", "purged", "escalated"].includes(s)) return "bad";
  return "neutral";
}

export function Json({ value, className }: { value: unknown; className?: string }) {
  return (
    <pre className={cn("max-h-64 overflow-auto rounded-lg bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-muted", className)}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function fmt(ts?: string | null) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}

export const inputCls = "w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm outline-none focus:border-brand";
