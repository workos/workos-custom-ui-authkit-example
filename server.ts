import "dotenv/config";
import { createHmac, randomBytes } from "node:crypto";
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { serve } from "@hono/node-server";
import { WorkOS } from "@workos-inc/node";

// ---------------------------------------------------------------------------
// Environment validation
// ---------------------------------------------------------------------------

const REQUIRED_ENV = [
  "WORKOS_API_KEY",
  "WORKOS_CLIENT_ID",
  "WORKOS_COOKIE_PASSWORD",
] as const;

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

interface SessionData {
  user: unknown;
  organizationId?: string;
  role?: string;
  permissions?: string[];
}

type AppEnv = {
  Variables: {
    session: SessionData;
  };
};

const app = new Hono<AppEnv>();

const workos = new WorkOS(process.env.WORKOS_API_KEY!, {
  clientId: process.env.WORKOS_CLIENT_ID!,
});

const PORT = Number(process.env.PORT) || 3001;
const IS_PROD = process.env.NODE_ENV === "production";
const FRONTEND_PORT = process.env.FRONTEND_PORT || "5176";
const FRONTEND_URL =
  process.env.FRONTEND_URL || `http://localhost:${FRONTEND_PORT}`;
const COOKIE_PASSWORD = process.env.WORKOS_COOKIE_PASSWORD!;
const SESSION_COOKIE = "wos-session";
const COOKIE_MAX_AGE = 400 * 24 * 60 * 60; // 400 days in seconds

const COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  secure: IS_PROD,
  sameSite: "Lax" as const,
  maxAge: COOKIE_MAX_AGE,
};

const sessionConfig = {
  sealSession: true,
  cookiePassword: COOKIE_PASSWORD,
};

// ---------------------------------------------------------------------------
// CSRF protection (double-submit cookie)
// ---------------------------------------------------------------------------

const CSRF_SECRET = process.env.CSRF_SECRET || COOKIE_PASSWORD;
const CSRF_COOKIE = "__csrf";

function csrfHash(token: string, sessionId: string): string {
  return createHmac("sha256", CSRF_SECRET)
    .update(`${sessionId}!${token}`)
    .digest("hex");
}

function generateCsrfToken(
  c: Parameters<MiddlewareHandler<AppEnv>>[0],
): string {
  const token = randomBytes(32).toString("hex");
  const sessionId = getCookie(c, SESSION_COOKIE) ?? "";
  const hash = csrfHash(token, sessionId);
  setCookie(c, CSRF_COOKIE, hash, {
    path: "/",
    httpOnly: true,
    secure: IS_PROD,
    sameSite: "Lax",
  });
  return token;
}

const csrfProtection: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = c.req.header("x-csrf-token") ?? "";
  const hash = getCookie(c, CSRF_COOKIE) ?? "";
  const sessionId = getCookie(c, SESSION_COOKIE) ?? "";
  const expected = csrfHash(token, sessionId);
  if (!hash || hash !== expected) {
    return c.json({ error: "Invalid CSRF token" }, 403);
  }
  await next();
};

app.get("/api/auth/csrf-token", (c) => {
  const token = generateCsrfToken(c);
  return c.json({ csrfToken: token });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface WorkOSError {
  message: string;
  status?: number;
  error?: string;
  code?: string;
  errorDescription?: string;
  rawData?: {
    code?: string;
    error?: string;
    pending_authentication_token?: string;
    organizations?: Array<{ id: string; name: string }>;
    connection_ids?: string[];
    email?: string;
  };
}

function setSessionCookie(
  c: Parameters<MiddlewareHandler<AppEnv>>[0],
  sealedSession: string,
): void {
  setCookie(c, SESSION_COOKIE, sealedSession, COOKIE_OPTIONS);
}

function clearSessionCookie(
  c: Parameters<MiddlewareHandler<AppEnv>>[0],
): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

function isOrgSelectionRequired(err: WorkOSError): boolean {
  const rawData = err.rawData || {};
  return (
    (rawData.code === "organization_selection_required" ||
      err.error === "organization_selection_required" ||
      err.code === "organization_selection_required") &&
    !!rawData.pending_authentication_token
  );
}

function handleOrgSelectionError(
  err: WorkOSError,
  c: Parameters<MiddlewareHandler<AppEnv>>[0],
): Response | null {
  if (!isOrgSelectionRequired(err)) return null;

  return c.json(
    {
      status: "org_selection_required",
      pendingAuthenticationToken: err.rawData!.pending_authentication_token,
      organizations: err.rawData!.organizations ?? [],
    },
    403,
  );
}

function isSsoRequired(err: WorkOSError): boolean {
  const rawData = err.rawData || {};
  return (
    rawData.error === "sso_required" ||
    err.error === "sso_required" ||
    err.code === "sso_required"
  );
}

function handleSsoRequiredError(
  err: WorkOSError,
  c: Parameters<MiddlewareHandler<AppEnv>>[0],
): Response | null {
  if (!isSsoRequired(err)) return null;

  const rawData = err.rawData || {};
  return c.json(
    {
      status: "sso_required",
      connectionIds: rawData.connection_ids || [],
      email: rawData.email,
    },
    403,
  );
}

function findMissingField(
  body: Record<string, unknown>,
  fields: string[],
): string | null {
  for (const field of fields) {
    if (!body?.[field]) return field;
  }
  return null;
}

const NO_REFRESH_REASONS = new Set([
  "no_session_cookie_provided",
  "invalid_session_cookie",
]);

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

const withAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const sessionData = getCookie(c, SESSION_COOKIE);

  if (!sessionData) {
    return c.json(
      { authenticated: false, reason: "no_session_cookie" },
      401,
    );
  }

  try {
    const session = workos.userManagement.loadSealedSession({
      sessionData,
      cookiePassword: COOKIE_PASSWORD,
    });

    const authResult = await session.authenticate();

    if (authResult.authenticated) {
      c.set("session", authResult as unknown as SessionData);
      return next();
    }

    const { reason } = authResult;

    if (NO_REFRESH_REASONS.has(reason)) {
      clearSessionCookie(c);
      return c.json({ authenticated: false, reason }, 401);
    }

    // Session expired — attempt refresh
    try {
      const refreshResult = await session.refresh();

      if (refreshResult.authenticated) {
        setSessionCookie(c, refreshResult.sealedSession!);
        c.set("session", {
          user: refreshResult.user,
          organizationId: refreshResult.organizationId,
          role: refreshResult.role,
          permissions: refreshResult.permissions,
        });
        return next();
      }
    } catch {
      // refresh failed
    }

    clearSessionCookie(c);
    return c.json(
      { authenticated: false, reason: reason || "session_expired" },
      401,
    );
  } catch (err) {
    console.error("Auth middleware error:", (err as Error).message);
    clearSessionCookie(c);
    return c.json({ authenticated: false, reason: "session_error" }, 401);
  }
};

// ---------------------------------------------------------------------------
// POST /api/auth/check-email — domain-based SSO detection
// ---------------------------------------------------------------------------
app.post("/api/auth/check-email", async (c) => {
  const body = await c.req.json<{ email?: string }>();
  const missing = findMissingField(body, ["email"]);
  if (missing)
    return c.json(
      { status: "error", error: `Missing required field: ${missing}` },
      400,
    );

  const domain = body.email!.split("@")[1]?.toLowerCase();
  if (!domain) {
    return c.json({ method: "credentials" });
  }

  try {
    const connections = await workos.sso.listConnections({ domain });
    const active = connections.data.filter((cn) => cn.state === "active");

    if (active.length > 0) {
      return c.json({
        method: "sso",
        ssoUrl: `/api/auth/sso?connection_id=${encodeURIComponent(active[0].id)}`,
      });
    }

    return c.json({ method: "credentials" });
  } catch (err) {
    console.error("Check email error:", (err as Error).message);
    return c.json({ method: "credentials" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/sso — redirect to SSO identity provider
// ---------------------------------------------------------------------------
app.get("/api/auth/sso", async (c) => {
  const connectionId = c.req.query("connection_id");

  if (!connectionId) {
    return c.redirect(
      `${FRONTEND_URL}?error=${encodeURIComponent("Missing connection ID")}`,
    );
  }

  try {
    const authorizationUrl = workos.userManagement.getAuthorizationUrl({
      connectionId,
      redirectUri: `${FRONTEND_URL}/api/auth/callback`,
    });
    return c.redirect(authorizationUrl);
  } catch (err) {
    console.error("SSO redirect error:", (err as Error).message);
    return c.redirect(
      `${FRONTEND_URL}?error=${encodeURIComponent((err as Error).message)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/google — redirect to Google OAuth via WorkOS
// ---------------------------------------------------------------------------
app.get("/api/auth/google", async (c) => {
  try {
    const authorizationUrl = workos.userManagement.getAuthorizationUrl({
      provider: "GoogleOAuth",
      redirectUri: `${FRONTEND_URL}/api/auth/callback`,
    });
    return c.redirect(authorizationUrl);
  } catch (err) {
    console.error("Google auth URL error:", (err as Error).message);
    return c.redirect(
      `${FRONTEND_URL}?error=${encodeURIComponent((err as Error).message)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/callback — OAuth redirect callback (Google, etc.)
// ---------------------------------------------------------------------------
app.get("/api/auth/callback", async (c) => {
  const code = c.req.query("code");

  if (!code) {
    const errMsg =
      c.req.query("error_description") ||
      c.req.query("error") ||
      "Missing authorization code";
    return c.redirect(
      `${FRONTEND_URL}?error=${encodeURIComponent(errMsg)}`,
    );
  }

  try {
    const result = await workos.userManagement.authenticateWithCode({
      code,
      session: sessionConfig,
    });

    setSessionCookie(c, result.sealedSession!);
    return c.redirect(FRONTEND_URL);
  } catch (err) {
    const wErr = err as WorkOSError;
    if (isOrgSelectionRequired(wErr)) {
      const token = wErr.rawData!.pending_authentication_token;
      const orgs = encodeURIComponent(
        JSON.stringify(wErr.rawData!.organizations ?? []),
      );
      return c.redirect(
        `${FRONTEND_URL}?org_selection=true&token=${token}&orgs=${orgs}`,
      );
    }

    console.error("OAuth callback error:", wErr.message);
    return c.redirect(
      `${FRONTEND_URL}?error=${encodeURIComponent(wErr.errorDescription || wErr.message)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/password
// ---------------------------------------------------------------------------
app.post("/api/auth/password", async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>();
  const missing = findMissingField(body, ["email", "password"]);
  if (missing)
    return c.json(
      { status: "error", error: `Missing required field: ${missing}` },
      400,
    );

  try {
    const result = await workos.userManagement.authenticateWithPassword({
      email: body.email!,
      password: body.password!,
      session: sessionConfig,
    });

    setSessionCookie(c, result.sealedSession!);
    return c.json({
      status: "authenticated",
      user: result.user,
      organizationId: result.organizationId,
    });
  } catch (err) {
    const wErr = err as WorkOSError;
    const orgRes = handleOrgSelectionError(wErr, c);
    if (orgRes) return orgRes;

    const ssoRes = handleSsoRequiredError(wErr, c);
    if (ssoRes) return ssoRes;

    console.error("Password auth error:", wErr.message);
    return c.json(
      { status: "error", error: wErr.errorDescription || wErr.message },
      (wErr.status || 500) as ContentfulStatusCode,
    );
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/magic-auth/send
// ---------------------------------------------------------------------------
app.post("/api/auth/magic-auth/send", async (c) => {
  const body = await c.req.json<{ email?: string }>();
  const missing = findMissingField(body, ["email"]);
  if (missing)
    return c.json(
      { status: "error", error: `Missing required field: ${missing}` },
      400,
    );

  try {
    await workos.userManagement.createMagicAuth({ email: body.email! });
    return c.json({ status: "sent" });
  } catch (err) {
    const wErr = err as WorkOSError;
    console.error("Magic auth send error:", wErr.message);
    return c.json(
      { status: "error", error: wErr.errorDescription || wErr.message },
      (wErr.status || 500) as ContentfulStatusCode,
    );
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/magic-auth/verify
// ---------------------------------------------------------------------------
app.post("/api/auth/magic-auth/verify", async (c) => {
  const body = await c.req.json<{ email?: string; code?: string }>();
  const missing = findMissingField(body, ["email", "code"]);
  if (missing)
    return c.json(
      { status: "error", error: `Missing required field: ${missing}` },
      400,
    );

  try {
    const result = await workos.userManagement.authenticateWithMagicAuth({
      email: body.email!,
      code: body.code!,
      session: sessionConfig,
    });

    setSessionCookie(c, result.sealedSession!);
    return c.json({
      status: "authenticated",
      user: result.user,
      organizationId: result.organizationId,
    });
  } catch (err) {
    const wErr = err as WorkOSError;
    const orgRes = handleOrgSelectionError(wErr, c);
    if (orgRes) return orgRes;

    const ssoRes = handleSsoRequiredError(wErr, c);
    if (ssoRes) return ssoRes;

    console.error("Magic auth verify error:", wErr.message);
    return c.json(
      { status: "error", error: wErr.errorDescription || wErr.message },
      (wErr.status || 500) as ContentfulStatusCode,
    );
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/org-selection
// ---------------------------------------------------------------------------
app.post("/api/auth/org-selection", async (c) => {
  const body = await c.req.json<{
    pendingAuthenticationToken?: string;
    organizationId?: string;
  }>();
  const missing = findMissingField(body, [
    "pendingAuthenticationToken",
    "organizationId",
  ]);
  if (missing)
    return c.json(
      { status: "error", error: `Missing required field: ${missing}` },
      400,
    );

  try {
    const result =
      await workos.userManagement.authenticateWithOrganizationSelection({
        pendingAuthenticationToken: body.pendingAuthenticationToken!,
        organizationId: body.organizationId!,
        session: sessionConfig,
      });

    setSessionCookie(c, result.sealedSession!);
    return c.json({
      status: "authenticated",
      user: result.user,
      organizationId: result.organizationId,
    });
  } catch (err) {
    const wErr = err as WorkOSError;
    console.error("Org selection error:", wErr.message);
    return c.json(
      { status: "error", error: wErr.errorDescription || wErr.message },
      (wErr.status || 500) as ContentfulStatusCode,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/session — uses withAuth middleware
// ---------------------------------------------------------------------------
app.get("/api/auth/session", withAuth, (c) => {
  const session = c.get("session");
  return c.json({
    authenticated: true,
    user: session.user,
    organizationId: session.organizationId,
    role: session.role,
    permissions: session.permissions,
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/switch-org — CSRF-protected, requires auth
// ---------------------------------------------------------------------------
app.post("/api/auth/switch-org", csrfProtection, withAuth, async (c) => {
  const body = await c.req.json<{ organizationId?: string }>();
  const missing = findMissingField(body, ["organizationId"]);
  if (missing)
    return c.json(
      { status: "error", error: `Missing required field: ${missing}` },
      400,
    );

  const sessionData = getCookie(c, SESSION_COOKIE)!;

  try {
    const session = workos.userManagement.loadSealedSession({
      sessionData,
      cookiePassword: COOKIE_PASSWORD,
    });

    const refreshResult = await session.refresh({
      organizationId: body.organizationId!,
    });

    if (refreshResult.authenticated) {
      setSessionCookie(c, refreshResult.sealedSession!);
      return c.json({
        status: "switched",
        user: refreshResult.user,
        organizationId: refreshResult.organizationId,
        role: refreshResult.role,
        permissions: refreshResult.permissions,
      });
    }

    return c.json({ status: "error", error: "Refresh failed" }, 401);
  } catch (err) {
    const wErr = err as WorkOSError;
    console.error("Switch org error:", wErr.message);
    return c.json(
      { status: "error", error: wErr.errorDescription || wErr.message },
      (wErr.status || 500) as ContentfulStatusCode,
    );
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout — CSRF-protected
// ---------------------------------------------------------------------------
app.post("/api/auth/logout", csrfProtection, async (c) => {
  const sessionData = getCookie(c, SESSION_COOKIE);

  if (!sessionData) {
    clearSessionCookie(c);
    return c.json({ status: "logged_out" });
  }

  try {
    const session = workos.userManagement.loadSealedSession({
      sessionData,
      cookiePassword: COOKIE_PASSWORD,
    });

    const logOutUrl = await session.getLogoutUrl();
    clearSessionCookie(c);
    return c.json({ status: "logged_out", logOutUrl });
  } catch {
    clearSessionCookie(c);
    return c.json({ status: "logged_out" });
  }
});

// ---------------------------------------------------------------------------
// Start (skip when imported for testing)
// ---------------------------------------------------------------------------
if (process.env.NODE_ENV !== "test") {
  serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`API server running on http://localhost:${info.port}`);
  });
}

export { app, isOrgSelectionRequired, isSsoRequired, findMissingField };
