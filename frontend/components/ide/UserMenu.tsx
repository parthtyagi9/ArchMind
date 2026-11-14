"use client";
import { Check, LogOut, Repeat, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppState";
import { Badge, ErrorBanner, cn } from "@/components/ui";
import { errorMessage } from "@/lib/api";

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";

export function UserMenu({ popover = "right" }: { popover?: "right" | "below" }) {
  const { me, openPage, signOut, switchOrg } = useApp();
  const [open, setOpen] = useState(false);
  const [orgs, setOrgs] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open]);

  const pick = async (id: string) => {
    if (id === me.org.id) { setOrgs(false); return; }
    setBusy(true); setError(null);
    try { await switchOrg(id); setOpen(false); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} title={`${me.user.name} · ${me.org.name}`}
        className="grid h-8 w-8 place-items-center overflow-hidden rounded-full bg-brand-soft text-[12px] font-semibold text-brand">
        {me.user.avatar_url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={me.user.avatar_url} alt="" className="h-full w-full object-cover" />
          : initials(me.user.name)}
      </button>
      {open && (
        <div role="menu" className={cn("absolute z-40 w-72 rounded-lg border border-line bg-panel-2 p-1 shadow-xl", popover === "right" ? "bottom-0 left-11" : "right-0 top-10")}>
          <div className="px-2.5 py-2">
            <div className="truncate text-xs font-medium">{me.user.name}</div>
            <div className="truncate text-[12px] text-muted">{me.user.email}</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
              <span className="truncate text-fg">{me.org.name}</span><Badge tone="brand">{me.org.role}</Badge>{me.org.team && <Badge>team {me.org.team}</Badge>}
            </div>
          </div>
          <div className="my-1 h-px bg-line" />
          <MenuItem icon={Settings} onClick={() => { setOpen(false); openPage("settings"); }}>Settings</MenuItem>
          <MenuItem icon={Repeat} onClick={() => setOrgs((o) => !o)}>Switch organization</MenuItem>
          {orgs && (
            <div className="mb-1 ml-3 border-l border-line pl-1">
              {me.orgs.map((o) => (
                <button key={o.id} disabled={busy} onClick={() => void pick(o.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-line/50 disabled:opacity-60">
                  <span className="min-w-0 flex-1 truncate text-xs">{o.name}</span><span className="text-[11px] text-muted">{o.role}</span>
                  {o.id === me.org.id && <Check className="h-3.5 w-3.5 text-ok" />}
                </button>
              ))}
              {error && <ErrorBanner error={error} className="m-1" />}
            </div>
          )}
          <MenuItem icon={LogOut} onClick={() => void signOut()}>Sign out</MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon: Icon, onClick, children }: { icon: typeof Settings; onClick: () => void; children: React.ReactNode }) {
  return (
    <button role="menuitem" onClick={onClick} className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs hover:bg-line/50">
      <Icon className="h-3.5 w-3.5 text-muted" />{children}
    </button>
  );
}
