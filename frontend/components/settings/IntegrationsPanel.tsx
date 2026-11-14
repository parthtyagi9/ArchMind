"use client";
import { CheckCircle2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppState";
import { Badge, Button, Card, CardHeader, ErrorBanner, Field, GithubMark, InfoBanner, Spinner, inputCls } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { AtlassianInfo } from "@/lib/types";

const splitList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export function IntegrationsPanel() {
  const { integrations, refreshIntegrations, can } = useApp();
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { void refreshIntegrations().finally(() => setLoaded(true)); }, [refreshIntegrations]);

  if (!integrations) return loaded ? <ErrorBanner error="Could not load integrations." onRetry={() => void refreshIntegrations()} /> : <div className="flex justify-center py-10"><Spinner /></div>;
  return (
    <div className="space-y-4">
      <GithubCard />
      <AtlassianCard info={integrations.atlassian} canManage={can("manage_integrations")} />
    </div>
  );
}

function GithubCard() {
  const { integrations, refreshIntegrations } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gh = integrations!.github;

  const unlink = async () => {
    setBusy(true); setError(null);
    try { await api.deleteGithub(); await refreshIntegrations(); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader title="GitHub" sub="Your personal link, used to read private repositories you have access to" icon={<GithubMark className="h-4 w-4" />}
        right={<Badge tone={gh.connected ? "ok" : "neutral"}>{gh.connected ? `linked${gh.login ? ` as ${gh.login}` : ""}` : "not linked"}</Badge>} />
      <div className="space-y-3 p-4 text-xs">
        {error && <ErrorBanner error={error} />}
        {gh.connected ? (
          <>
            <p className="text-muted">Agents acting for you can read repositories this GitHub account can read. Unlinking removes the stored token; repositories already indexed stay available.</p>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void unlink()}>{busy && <Spinner className="h-3 w-3" />}Unlink GitHub</Button>
          </>
        ) : gh.oauth_configured ? (
          <>
            <p className="text-muted">Link your GitHub account to connect private repositories. Public repositories work without linking.</p>
            <a href="/api/auth/github/connect" className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-brand px-2.5 text-xs font-medium text-[#0a0b10] hover:bg-brand/90"><GithubMark className="h-3.5 w-3.5" />Link GitHub</a>
          </>
        ) : (
          <InfoBanner>GitHub OAuth is not configured on this server, so accounts cannot be linked. Public repositories can still be connected by name.</InfoBanner>
        )}
      </div>
    </Card>
  );
}

function AtlassianCard({ info, canManage }: { info: AtlassianInfo; canManage: boolean }) {
  const { refreshIntegrations } = useApp();
  const [baseUrl, setBaseUrl] = useState(info.base_url ?? "");
  const [email, setEmail] = useState(info.email ?? "");
  const [token, setToken] = useState("");
  const [jira, setJira] = useState(info.jira_projects.join(", "));
  const [conf, setConf] = useState(info.confluence_spaces.join(", "));
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("save"); setError(null); setSaved(false);
    try {
      await api.putAtlassian({ base_url: baseUrl.trim().replace(/\/$/, ""), email: email.trim(), api_token: token, jira_projects: splitList(jira), confluence_spaces: splitList(conf) });
      setToken(""); setSaved(true);
      await refreshIntegrations();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(null); }
  };
  const remove = async () => {
    setBusy("remove"); setError(null); setSaved(false);
    try {
      await api.deleteAtlassian();
      setBaseUrl(""); setEmail(""); setToken(""); setJira(""); setConf("");
      await refreshIntegrations();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(null); }
  };

  return (
    <Card>
      <CardHeader title="Atlassian (Jira and Confluence)" sub="One Atlassian Cloud connection powers both agents"
        right={info.connected
          ? <Badge tone={info.status === "ok" ? "ok" : "bad"}>{info.status === "ok" ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}{info.status ?? "connected"}</Badge>
          : <Badge>not connected</Badge>} />
      <form onSubmit={(e) => void save(e)} className="space-y-3 p-4">
        {info.connected && info.status === "error" && (
          <ErrorBanner error={info.error ?? "The stored credentials no longer work. Update the API token below."} />
        )}
        {!canManage && <InfoBanner>Only admins and owners can manage integrations (needs manage_integrations). You can see the status but not change it.</InfoBanner>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Site URL"><input className={inputCls} type="url" placeholder="https://your-team.atlassian.net" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} required disabled={!canManage} /></Field>
          <Field label="Account email"><input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={!canManage} autoComplete="off" /></Field>
        </div>
        <Field label="API token" hint={info.connected ? "Stored encrypted and never shown again. Enter a token to replace it." : "Create one at id.atlassian.com under Security, API tokens."}>
          <input className={inputCls} type="password" value={token} onChange={(e) => setToken(e.target.value)} required disabled={!canManage} autoComplete="new-password" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Jira projects (optional)" hint="Comma separated keys, e.g. AUTH, PAY"><input className={inputCls} value={jira} onChange={(e) => setJira(e.target.value)} disabled={!canManage} /></Field>
          <Field label="Confluence spaces (optional)" hint="Comma separated keys, e.g. ENG, ARCH"><input className={inputCls} value={conf} onChange={(e) => setConf(e.target.value)} disabled={!canManage} /></Field>
        </div>
        {error && <ErrorBanner error={error} />}
        {saved && <InfoBanner tone="ok">Credentials validated against Jira and Confluence and saved.</InfoBanner>}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={!canManage || busy !== null}>{busy === "save" && <Spinner className="h-3 w-3 text-[#0a0b10]" />}{info.connected ? "Update connection" : "Connect"}</Button>
          {info.connected && <Button type="button" size="sm" variant="outline" disabled={!canManage || busy !== null} onClick={() => void remove()}>{busy === "remove" && <Spinner className="h-3 w-3" />}Disconnect</Button>}
        </div>
      </form>
    </Card>
  );
}
