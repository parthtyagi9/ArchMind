"use client";
import { CheckCircle2, Link2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppState";
import { Badge, Button, Card, CardHeader, ErrorBanner, ExtLink, Field, GithubMark, InfoBanner, Spinner, inputCls } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { AtlassianInfo } from "@/lib/types";

const splitList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export function IntegrationsPanel() {
  const { integrations, refreshIntegrations, can } = useApp();
  const [loaded, setLoaded] = useState(false);
  const [privateOpen, setPrivateOpen] = useState(false);
  useEffect(() => { void refreshIntegrations().finally(() => setLoaded(true)); }, [refreshIntegrations]);

  if (!integrations) return loaded ? <ErrorBanner error="Could not load integrations." onRetry={() => void refreshIntegrations()} /> : <div className="flex justify-center py-10"><Spinner /></div>;
  return (
    <div className="space-y-4">
      <PublicSourcesCard />
      <GithubCard />
      {integrations.atlassian.connected || privateOpen
        ? <AtlassianCard info={integrations.atlassian} canManage={can("manage_integrations")} />
        : <button onClick={() => setPrivateOpen(true)} className="text-xs text-brand hover:underline">Source needs sign-in? Connect a private Atlassian Cloud site</button>}
    </div>
  );
}

function PublicSourcesCard() {
  const { integrations, refreshIntegrations, can, repos, repo } = useApp();
  const [url, setUrl] = useState("");
  const [repoId, setRepoId] = useState(repo?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState<string | null>(null);
  const canManage = can("manage_integrations");
  const sources = integrations?.public_sources ?? [];

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setConnected(null);
    try {
      const source = await api.connectPublicSource({ url: url.trim(), ...(repoId ? { repo_id: repoId } : {}) });
      await refreshIntegrations();
      setUrl("");
      setConnected(`${source.title} connected. ${source.search_available ? "Agents can search this source and cite its content." : "Agents can read this page; this site does not expose public search."}`);
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    setRemoving(id); setError(null); setConnected(null);
    try { await api.disconnectPublicSource(id); await refreshIntegrations(); }
    catch (err) { setError(errorMessage(err)); }
    finally { setRemoving(null); }
  };

  return (
    <Card>
      <CardHeader title="Jira & Confluence context" sub="Paste a public project, space, issue or page link. No account or API token needed." icon={<Link2 className="h-4 w-4" />} />
      <div className="space-y-4 p-4">
        <form onSubmit={(e) => void connect(e)} className="space-y-3">
          <Field label="Source link">
            <input type="url" className={inputCls} placeholder="https://issues.apache.org/jira/projects/KAFKA" value={url} onChange={(e) => { setUrl(e.target.value); setConnected(null); }} required disabled={!canManage || busy} />
          </Field>
          <Field label="Use for" hint="Agents use this source only for the selected repository, or across your organization.">
            <select className={inputCls} value={repoId} onChange={(e) => setRepoId(e.target.value)} disabled={!canManage || busy}>
              <option value="">All repositories in this organization</option>
              {repos.map((r) => <option key={r.id} value={r.id}>{r.full_name}</option>)}
            </select>
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={!canManage || busy || !url.trim()}>{busy ? <Spinner className="h-3.5 w-3.5 text-[#0a0b10]" /> : <Link2 className="h-3.5 w-3.5" />}{busy ? "Checking public access…" : "Connect source"}</Button>
            {!canManage && <span className="text-[11px] text-muted">An admin or owner can connect sources.</span>}
          </div>
          {canManage && <p className="text-[11px] text-muted">Try Apache Kafka:{" "}
            <button type="button" className="text-brand hover:underline" disabled={busy} onClick={() => setUrl("https://issues.apache.org/jira/projects/KAFKA")}>Jira</button>{" · "}
            <button type="button" className="text-brand hover:underline" disabled={busy} onClick={() => setUrl("https://cwiki.apache.org/confluence/display/KAFKA/Index")}>Confluence</button>
          </p>}
        </form>
        {error && <ErrorBanner error={error} />}
        {connected && <InfoBanner tone="ok">{connected}</InfoBanner>}
        {sources.length > 0 && <ul className="space-y-2 border-t border-line pt-3">
          {sources.map((s) => (
            <li key={s.id} className="rounded-lg border border-line bg-panel-2 p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 break-words font-medium">{s.title}</span><Badge tone="info">{s.kind === "jira" ? "Jira" : "Confluence"}</Badge><Badge tone="ok">Public access</Badge></div>
              <div className="mt-1 break-all"><ExtLink href={s.url}>{s.url}</ExtLink></div>
              <p className="mt-1 text-[11px] text-muted">{s.repo_id ? repos.find((r) => r.id === s.repo_id)?.full_name ?? "Repository" : "All repositories"} · {s.search_available ? "Search and read" : "Read this page only"}</p>
              {canManage && <Button size="sm" variant="ghost" className="mt-1" disabled={removing !== null} onClick={() => void remove(s.id)}>{removing === s.id && <Spinner className="h-3 w-3" />}Disconnect</Button>}
            </li>
          ))}
        </ul>}
      </div>
    </Card>
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
      <CardHeader title="Private Atlassian Cloud" sub="For sources that require sign-in; credentials are stored encrypted"
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
