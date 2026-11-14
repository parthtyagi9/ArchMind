"use client";
// Small shadcn/ui-style primitives (hand-written; no extra dependencies).
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import * as React from "react";

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
