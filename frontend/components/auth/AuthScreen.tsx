"use client";
import { Layers } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppRaw } from "@/components/AppState";
import { Button, Field, GithubMark, InfoBanner, Spinner, cn, inputCls } from "@/components/ui";
import { api, ApiError, errorMessage } from "@/lib/api";

type Mode = "signin" | "register";
type OrgChoice = "create" | "join";

function authErrorText(e: unknown, mode: Mode): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return "Incorrect email or password.";
    if (e.status === 409) return "An account with this email already exists. Sign in instead.";
    if (e.status === 422) return `Please check the form: ${e.detail}`;
    if (e.status === 404 && mode === "register") return `Invite not found: ${e.detail}`;
  }
  return errorMessage(e);
}

export function AuthScreen() {
  const { signedIn, notice, setNotice } = useAppRaw();
  const [mode, setMode] = useState<Mode>("signin");
  const [orgChoice, setOrgChoice] = useState<OrgChoice>("create");
  const [githubOauth, setGithubOauth] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.authConfig().then((c) => { if (!cancelled) setGithubOauth(!!c.github_oauth); }, () => { if (!cancelled) setGithubOauth(false); });
    return () => { cancelled = true; };
  }, []);

  const switchMode = (m: Mode) => { setMode(m); setError(null); setNotice(null); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (mode === "register" && password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (mode === "register" && orgChoice === "join" && !inviteCode.trim()) { setError("Enter the invite code you were given."); return; }
    setBusy(true);
    try {
      const me = mode === "signin"
        ? await api.login({ email: email.trim(), password })
        : await api.register({
            email: email.trim(), password, name: name.trim(),
            ...(orgChoice === "join" ? { invite_code: inviteCode.trim() } : orgName.trim() ? { org_name: orgName.trim() } : {}),
          });
      signedIn(me);
    } catch (err) {
      setError(authErrorText(err, mode));
      setBusy(false);
    }
  };

  const githubHref = `/api/auth/github/login${mode === "register" && orgChoice === "join" && inviteCode.trim() ? `?invite_code=${encodeURIComponent(inviteCode.trim())}` : ""}`;
  const shownError = error ?? (notice?.kind === "error" ? notice.text : null);

  return (
    <div className="relative grid min-h-screen place-items-center overflow-y-auto px-6 py-10">
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-brand to-info"><Layers className="h-5 w-5 text-[#0a0b10]" /></div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">ArchMind</h1>
            <p className="text-xs text-muted">Engineering memory you can govern</p>
          </div>
        </div>

        <div className="rounded-xl border border-line bg-panel/90 p-5 shadow-[0_30px_80px_-20px_#000]">
          <div role="tablist" className="mb-4 grid grid-cols-2 rounded-lg bg-panel-2 p-1 text-xs">
            {(["signin", "register"] as const).map((m) => (
              <button key={m} role="tab" aria-selected={mode === m} type="button" onClick={() => switchMode(m)}
                className={cn("rounded-md py-1.5 font-medium", mode === m ? "bg-line text-fg" : "text-muted hover:text-fg")}>
                {m === "signin" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          {notice?.kind === "ok" && <InfoBanner tone="ok" className="mb-3">{notice.text}</InfoBanner>}
          {shownError && <div role="alert" className="mb-3 rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-xs text-bad">{shownError}</div>}

          <form onSubmit={submit} className="space-y-3">
            {mode === "register" && (
              <Field label="Name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" /></Field>
            )}
            <Field label="Email"><input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></Field>
            <Field label="Password" hint={mode === "register" ? "At least 8 characters." : undefined}>
              <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === "register" ? 8 : undefined} autoComplete={mode === "register" ? "new-password" : "current-password"} />
            </Field>

            {mode === "register" && (
              <div className="space-y-2">
                <div role="radiogroup" aria-label="Organization" className="grid grid-cols-2 rounded-lg bg-panel-2 p-1 text-[12px]">
                  {(["create", "join"] as const).map((c) => (
                    <button key={c} type="button" role="radio" aria-checked={orgChoice === c} onClick={() => setOrgChoice(c)}
                      className={cn("rounded-md py-1.5", orgChoice === c ? "bg-line text-fg" : "text-muted hover:text-fg")}>
                      {c === "create" ? "Create an organization" : "Join with invite code"}
                    </button>
                  ))}
                </div>
                {orgChoice === "create" ? (
                  <Field label="Organization name" hint="You become its owner. Leave empty to use “<your name>'s workspace”.">
                    <input className={inputCls} value={orgName} onChange={(e) => setOrgName(e.target.value)} autoComplete="organization" />
                  </Field>
                ) : (
                  <Field label="Invite code" hint="You join that organization with the role and team set on the invite.">
                    <input className={cn(inputCls, "font-mono")} value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} required autoComplete="off" spellCheck={false} />
                  </Field>
                )}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Spinner className="h-3.5 w-3.5 text-[#0a0b10]" />}{mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>

          {githubOauth && (
            <>
              <div className="my-4 flex items-center gap-3 text-[12px] text-muted"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>
              <a href={githubHref} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-line bg-panel-2 text-sm font-medium hover:bg-line/60">
                <GithubMark className="h-4 w-4" />Continue with GitHub
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
