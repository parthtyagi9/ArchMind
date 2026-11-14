"use client";
// Small shadcn/ui-style primitives (hand-written; no extra dependencies).
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { AlertTriangle, ExternalLink, Loader2, RefreshCw, X } from "lucide-react";
import * as React from "react";
import { errorMessage } from "@/lib/api";

export const cn = (...c: ClassValue[]) => twMerge(clsx(c));

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "outline" | "ok" | "danger";
  size?: "sm" | "md";
};
export function Button({ variant = "primary", size = "md", className, ...p }: BtnProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-4 text-sm",
        variant === "primary" && "bg-brand text-[#0a0b10] hover:bg-brand/90",
        variant === "ok" && "bg-ok text-[#04130d] hover:bg-ok/90",
        variant === "danger" && "bg-bad/90 text-[#1a0606] hover:bg-bad",
        variant === "outline" && "border border-line bg-panel-2 hover:bg-line/60",
        variant === "ghost" && "text-muted hover:bg-line/50 hover:text-fg",
        className,
      )}
      {...p}
    />
  );
}

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-line bg-panel/80", className)} {...p} />;
}

export function CardHeader({ title, sub, icon, right }: { title: string; sub?: string; icon?: React.ReactNode; right?: React.ReactNode }) {
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
  info: "bg-info-soft text-info",
};
export type Tone = keyof typeof tones;

export function Badge({ tone = "neutral", className, ...p }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium", tones[tone], className)} {...p} />;
}

export function PageHeader({ title, sub, right }: { title: string; sub: string; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        <p className="text-xs text-muted">{sub}</p>
      </div>
      {right}
    </div>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted">{children}</div>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="grid place-items-center rounded-lg border border-dashed border-line px-4 py-10 text-xs text-muted">{children}</div>;
}

export const inputCls = "h-9 w-full rounded-lg border border-line bg-panel-2 px-3 text-xs outline-none placeholder:text-muted/70 focus:border-brand disabled:cursor-not-allowed disabled:opacity-60";
export const textareaCls = "w-full rounded-lg border border-line bg-panel-2 p-2.5 text-xs leading-relaxed outline-none placeholder:text-muted/70 focus:border-brand disabled:cursor-not-allowed disabled:opacity-60";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin text-brand", className)} aria-label="Loading" />;
}

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cn("animate-pulse rounded-md bg-line/50", className)} style={style} aria-hidden />;
}

export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted" role="status"><Spinner />{label}</div>;
}

export function ErrorBanner({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("flex items-start gap-2 rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-xs text-bad", className)}>
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 break-words">{errorMessage(error)}</span>
      {onRetry && <button onClick={onRetry} className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-medium hover:bg-bad/10"><RefreshCw className="h-3 w-3" />Retry</button>}
    </div>
  );
}

export function InfoBanner({ tone = "warn", children, className }: { tone?: "warn" | "info" | "ok"; children: React.ReactNode; className?: string }) {
  const c = tone === "warn" ? "border-warn/30 bg-warn-soft text-warn" : tone === "ok" ? "border-ok/30 bg-ok-soft text-ok" : "border-info/30 bg-info-soft text-info";
  return <div className={cn("rounded-lg border px-3 py-2 text-xs leading-relaxed", c, className)}>{children}</div>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

export function Chip({ active, onClick, children, count }: { active: boolean; onClick: () => void; children: React.ReactNode; count?: number }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs capitalize", active ? "bg-brand-soft text-brand" : "text-muted hover:bg-line/50")}>
      {children}
      {count !== undefined && <span className="rounded bg-line/60 px-1 font-mono text-[10px]">{count}</span>}
    </button>
  );
}

export function ExtLink({ href, children, className }: { href: string; children?: React.ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cn("inline-flex items-center gap-1 text-brand hover:underline", className)}>
      {children}<ExternalLink className="h-3 w-3 shrink-0" />
    </a>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}
        className={cn("max-h-[90vh] w-full overflow-y-auto rounded-xl border border-line bg-panel p-5 shadow-2xl", wide ? "max-w-xl" : "max-w-md")}>
        <div className="mb-3 flex items-center gap-2">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="ml-auto text-muted hover:text-fg"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/** Renders text with `inline code` spans. */
export function RichText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className}>
      {text.split(/(`[^`]+`)/g).map((part, i) =>
        part.length > 2 && part.startsWith("`") && part.endsWith("`")
          ? <code key={i} className="rounded bg-line/60 px-1 py-0.5 font-mono text-[0.92em] text-brand">{part.slice(1, -1)}</code>
          : <React.Fragment key={i}>{part}</React.Fragment>,
      )}
    </span>
  );
}
