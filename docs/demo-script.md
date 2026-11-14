# Demo script (3 min live)

**Before going on stage:** `uv run python -m scripts.seed_demo`, backend + frontend running, browser at localhost:3000 signed out. Do one A/B dry run to confirm Gemini latency; then re-seed.

**0:00 – Problem (20 s).** "Deploys fail with AccessDenied on Secrets Manager. Every on-call re-diagnoses from scratch, and naive agent memory leaks between customers and never forgets bad fixes. RecallOps makes memory governable."

**0:20 – Agent (40 s).** Sign in as **Alice (Alpha Payments)**. Submit the prefilled incident with memory on. Point at:
- *Retrieved 3 governed memories*, with scores
- the decision that **cites `mem_alpha_secrets_iam`**
- the approval gate: "the model cannot approve itself; approval is enforced in code against MongoDB"

**1:00 – Real action (30 s).** Approve. The simulated environment card flips **DENIED → ALLOWED** and the `iam_get_secret_value` check turns green. "Verification re-reads state from Mongo; it does not trust the tool's acknowledgement." The memory write-back shows *reconfirmed* (dedup).

**1:30 – Governance (50 s).** Memory inspector:
1. Search shows only Alpha memories. Expired `mem_alpha_expired_restart` and invalidated `mem_alpha_bad_rotate` are absent: "filtered *inside* `$vectorSearch`".
2. Correct `mem_alpha_orders_s3` to "bucket policy missing s3:PutObject; restart did not help". Show v1 superseded, v2 active, plus the audit event.
3. Sign out and sign in as **Bob (Beta)**. Same search returns Beta's memory, which recommends *rotate_secret*. "If that had leaked into Alpha, Alpha's agent would have rotated a secret for nothing."

**2:20 – Memory changes behavior (35 s).** As Alice, open **Memory A/B → Run A/B**. Read the four deltas (tool calls, diagnostics). "Same incident, same tools, same model, simulator reset, no memory writes. The only variable is governed memory." Point at the citation in the with-memory arm.

**2:55 – Close.** "RecallOps doesn't just give AI agents memory. It makes organizational memory useful, accountable, and governable."

Built during the hackathon: everything in this repo. Simulated: the AWS environment and the demo identity.

---

# 60-second submission video script

1. (0–8 s) Title card: *RecallOps: governed memory for incident-response agents* · MongoDB Atlas Vector Search + Gemini + LangGraph.
2. (8–22 s) Submit incident → agent retrieves a verified memory → cites it → approval gate.
3. (22–32 s) Approve → simulator flips to ALLOWED via independent verification → memory reconfirmed.
4. (32–45 s) Memory inspector: tenant-filtered vector search, correction creating v2, Beta can't see Alpha.
5. (45–57 s) A/B: without memory N tool calls vs with memory M, same controls.
6. (57–60 s) "Memory that's useful, accountable, and governable." Repo link. Note: AWS environment simulated.
