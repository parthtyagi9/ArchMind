"use client";
import { useState } from "react";
import { useApp } from "@/components/AppState";
import { AccountPanel } from "@/components/settings/AccountPanel";
import { IntegrationsPanel } from "@/components/settings/IntegrationsPanel";
import { InvitesPanel } from "@/components/settings/InvitesPanel";
import { MembersPanel } from "@/components/settings/MembersPanel";
import { OrgPanel } from "@/components/settings/OrgPanel";
import { PageHeader, cn } from "@/components/ui";

const SECTIONS = [
  { id: "integrations", label: "Integrations" },
  { id: "members", label: "Members" },
  { id: "invites", label: "Invites" },
  { id: "org", label: "Organization" },
  { id: "account", label: "Account" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

export function SettingsView() {
  const { me } = useApp();
  const [section, setSection] = useState<SectionId>("integrations");
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Settings" sub={`${me.org.name} · role ${me.org.role}${me.org.team ? ` · team ${me.org.team}` : ""}`} />
      <div role="tablist" className="mb-4 flex flex-wrap gap-1 border-b border-line pb-2">
        {SECTIONS.map((s) => (
          <button key={s.id} role="tab" aria-selected={section === s.id} onClick={() => setSection(s.id)}
            className={cn("rounded-md px-3 py-1.5 text-xs", section === s.id ? "bg-brand-soft text-brand" : "text-muted hover:bg-line/50")}>{s.label}</button>
        ))}
      </div>
      {section === "integrations" && <IntegrationsPanel />}
      {section === "members" && <MembersPanel />}
      {section === "invites" && <InvitesPanel />}
      {section === "org" && <OrgPanel />}
      {section === "account" && <AccountPanel />}
    </div>
  );
}
