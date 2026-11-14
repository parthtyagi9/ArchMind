// SYNTHETIC DEMO REPOSITORY: acme/payments-platform. File contents are invented for the preview.
export const DEMO_FILES: Record<string, string> = {
  "README.md": `# payments-platform

Monorepo for the Acme payments stack.

- \`services/gateway\`   edge router and rate limiting
- \`services/auth\`      token issuing and validation
- \`services/payments\`  balances, charges, ledger
- \`services/users\`     user directory
- \`services/notify\`    receipts and alerts
- \`packages/authz\`     shared authorization middleware
- \`db/migrations\`      PostgreSQL migrations
`,
  CODEOWNERS: `services/auth/        @acme/platform
packages/authz/       @acme/platform
services/gateway/     @acme/platform
services/payments/    @acme/payments
services/notify/      @acme/mobile
`,
  "services/auth/src/index.ts": `import express from "express";
import { authorizeRequest } from "@acme/authz";
import { issueSession, refreshSession } from "./session";
import { validate } from "./validate";

const app = express();
app.use(express.json());

app.post("/login", async (req, res) => {
  const session = await issueSession(req.body.email, req.body.password);
  res.json(session);
});

app.post("/refresh", authorizeRequest("session:refresh"), async (req, res) => {
  res.json(await refreshSession(req.body.refreshToken));
});

app.get("/introspect", (req, res) => {
  res.json(validate(String(req.headers.authorization ?? "").replace("Bearer ", "")));
});

app.listen(4001);
`,
  "services/auth/src/validate.ts": `import jwt from "jsonwebtoken";
import { config } from "../config";
import { TokenError } from "./errors";

// Expected audience for tokens issued by auth-service.
const EXPECTED_AUD = config.auth.audience;

export interface Claims {
  sub: string;
  aud: string;
  scope: string[];
  exp: number;
}

export function validate(token: string): Claims {
  try {
    const claims = jwt.verify(token, config.auth.publicKey, {
      algorithms: ["RS256"],
      audience: EXPECTED_AUD,
      clockTolerance: 5,
    }) as Claims;
    return claims;
  } catch (err) {
    throw new TokenError("invalid_token", err);
  }
}

export function hasScope(claims: Claims, scope: string): boolean {
  return claims.scope.includes(scope);
}
`,
  "services/auth/src/session.ts": `import { db } from "../db";
import { randomBytes } from "crypto";
import { signToken } from "./sign";

const SESSION_TTL_MS = 15 * 60 * 1000;

export async function issueSession(email: string, password: string) {
  const user = await db.users.verify(email, password);
  const refreshToken = randomBytes(32).toString("hex");
  await db.sessions.insert({ userId: user.id, refreshToken, expiresAt: Date.now() + 7 * 864e5 });
  return { accessToken: signToken(user, SESSION_TTL_MS), refreshToken };
}

export async function refreshSession(refreshToken: string) {
  const row = await db.sessions.consume(refreshToken);
  return { accessToken: signToken(row.user, SESSION_TTL_MS) };
}
`,
  "services/auth/src/refresh.ts": `import { db } from "../db";

// Rotate refresh tokens on every use; reuse of an old token revokes the family.
export async function rotate(oldToken: string) {
  const row = await db.sessions.consume(oldToken);
  if (!row) await db.sessions.revokeFamilyOf(oldToken);
  return row;
}
`,
  "services/gateway/src/router.ts": `import { createProxy } from "./proxy";
import { rateLimit } from "./rateLimit";

const routes = [
  { prefix: "/auth", target: "http://auth-service:4001" },
  { prefix: "/payments", target: "http://payments-service:4002" },
];

// The gateway only routes and rate-limits. Token validation is intentionally not done here;
// downstream services validate tokens themselves.
export function buildRouter() {
  const proxies = routes.map((r) => ({ ...r, handler: createProxy(r.target) }));
  return (req, res, next) => {
    const route = proxies.find((r) => req.path.startsWith(r.prefix));
    if (!route) return res.status(404).end();
    return rateLimit(req, res, () => route.handler(req, res, next));
  };
}
`,
  "services/gateway/src/rateLimit.ts": `const WINDOW_MS = 60_000;
const MAX_REQUESTS = 300;
const hits = new Map<string, { n: number; reset: number }>();

export function rateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip;
  const entry = hits.get(key);
  if (!entry || entry.reset < now) hits.set(key, { n: 1, reset: now + WINDOW_MS });
  else if (++entry.n > MAX_REQUESTS) return res.status(429).end();
  next();
}
`,
  "services/users/src/directory.ts": `import { db } from "../db";

export async function getUser(id: string) {
  return db.users.findById(id);
}

export async function rolesFor(id: string): Promise<string[]> {
  return (await db.users.findById(id))?.roles ?? [];
}
`,
  "services/payments/src/index.ts": `import express from "express";
import { authorizeRequest } from "@acme/authz";
import { getBalance } from "./balance";
import { charge } from "./charge";

const app = express();
app.use(express.json());

app.get("/accounts/:id/balance", authorizeRequest("balance:read"), async (req, res) => {
  res.json({ balance_cents: await getBalance(req.params.id, req.user.id) });
});

app.post("/charges", authorizeRequest("charge:create"), async (req, res) => {
  res.json(await charge(req.body, req.user.id));
});

app.listen(4002);
`,
  "services/payments/src/balance.ts": `import { db } from "../db";
import { authorize } from "@acme/authz";

export async function getBalance(accountId: string, userId: string) {
  await authorize(userId, "balance:read", accountId);

  // Read straight from the ledger so the value is always strongly consistent.
  const { rows } = await db.query(
    "SELECT balance_cents FROM ledger_accounts WHERE id = $1",
    [accountId],
  );
  return rows[0]?.balance_cents ?? 0;
}

export async function getStatement(accountId: string, limit = 50) {
  const { rows } = await db.query(
    "SELECT * FROM ledger_entries WHERE account_id = $1 ORDER BY created_at DESC LIMIT $2",
    [accountId, limit],
  );
  return rows;
}
`,
  "services/payments/src/charge.ts": `import { db } from "../db";
import { writeEntry } from "./ledger/write";
import { notify } from "../../notify/src/send";

export async function charge(req: { accountId: string; amountCents: number }, userId: string) {
  if (req.amountCents <= 0) throw new Error("invalid_amount");
  const entry = await writeEntry({ debit: req.accountId, credit: "merchant", amount: req.amountCents });
  await notify(userId, \`Payment of \${req.amountCents / 100} processed\`);
  return entry;
}
`,
  "services/payments/src/ledger/write.ts": `import { pool } from "../../db";

export async function writeEntry(e: { debit: string; credit: string; amount: number }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("UPDATE ledger_accounts SET balance_cents = balance_cents - $2 WHERE id = $1", [e.debit, e.amount]);
    await client.query("UPDATE ledger_accounts SET balance_cents = balance_cents + $2 WHERE id = $1", [e.credit, e.amount]);
    const { rows } = await client.query("INSERT INTO ledger_entries (debit, credit, amount) VALUES ($1,$2,$3) RETURNING id", [e.debit, e.credit, e.amount]);
    await client.query("COMMIT");
    return rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
`,
  "services/notify/src/send.ts": `import { mailer, push } from "./transports";

export async function notify(userId: string, message: string) {
  await Promise.all([mailer.send(userId, message), push.send(userId, message)]);
}
`,
  "packages/authz/src/middleware.ts": `import { rolesFor } from "../../../services/users/src/directory";

const POLICIES: Record<string, string[]> = {
  "balance:read": ["customer", "support"],
  "charge:create": ["customer"],
  "session:refresh": ["customer", "support", "admin"],
};

export async function authorize(userId: string, action: string, _resource?: string) {
  const roles = await rolesFor(userId);
  if (!POLICIES[action]?.some((r) => roles.includes(r))) throw new Error("forbidden");
}

// Every service mounts this instead of writing its own checks.
export function authorizeRequest(action: string) {
  return async (req, res, next) => {
    try {
      await authorize(req.user.id, action);
      next();
    } catch {
      res.status(403).end();
    }
  };
}
`,
  "db/migrations/0042_ledger.sql": `CREATE TABLE ledger_accounts (
  id            UUID PRIMARY KEY,
  owner_id      UUID NOT NULL,
  balance_cents BIGINT NOT NULL DEFAULT 0 CHECK (balance_cents >= 0)
);

CREATE TABLE ledger_entries (
  id         BIGSERIAL PRIMARY KEY,
  debit      UUID NOT NULL REFERENCES ledger_accounts(id),
  credit     UUID NOT NULL REFERENCES ledger_accounts(id),
  amount     BIGINT NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`,
};
