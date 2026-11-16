"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, Layers, Loader2 } from "lucide-react";
import { WAKING_EVENT } from "@/lib/api";
import { AppProvider, useAppRaw } from "@/components/AppState";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { Ide } from "@/components/ide/Ide";
import { WorkspacePicker } from "@/components/ide/WorkspacePicker";
import { Button } from "@/components/ui";

function Boot({ children }: { children: React.ReactNode }) {
  return <div className="grid h-screen place-items-center px-6"><div className="flex flex-col items-center gap-3 text-center text-xs text-muted">{children}</div></div>;
}

/** True while the API client is retrying because the backend is still starting up. */
function useWaking(): boolean {
  const [waking, setWaking] = useState(false);
  useEffect(() => {
    const h = (e: Event) => setWaking(Boolean((e as CustomEvent<boolean>).detail));
    window.addEventListener(WAKING_EVENT, h);
    return () => window.removeEventListener(WAKING_EVENT, h);
  }, []);
  return waking;
}

function Root() {
  const { status, bootError, retryBoot, me, workspace } = useAppRaw();
  const waking = useWaking();
  if (status === "loading") {
    return (
      <Boot>
        <Layers className="h-6 w-6 text-brand" />
        <span className="flex items-center gap-2" role="status"><Loader2 className="h-4 w-4 animate-spin" />{waking ? "Waking up the server…" : "Loading ArchMind…"}</span>
        {waking && <p className="max-w-sm">The backend sleeps when nobody is using it. Starting it takes up to a minute.</p>}
      </Boot>
    );
  }
  if (status === "error") {
    return (
      <Boot>
        <AlertTriangle className="h-6 w-6 text-bad" />
        <p className="max-w-sm text-sm text-fg">Could not reach the ArchMind server</p>
        <p className="max-w-sm" role="alert">{bootError}</p>
        <Button size="sm" onClick={retryBoot}>Retry</Button>
      </Boot>
    );
  }
  if (status === "signed_out" || !me) return <AuthScreen />;
  return workspace ? <Ide /> : <WorkspacePicker />;
}

export default function Home() {
  return (
    <AppProvider>
      <Root />
    </AppProvider>
  );
}
