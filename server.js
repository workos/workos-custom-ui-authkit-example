import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import { doubleCsrf } from "csrf-csrf";
import { WorkOS } from "@workos-inc/node";

// ---------------------------------------------------------------------------
// Environment validation
// ---------------------------------------------------------------------------

const REQUIRED_ENV = [
  "WORKOS_API_KEY",
  "WORKOS_CLIENT_ID",
  "WORKOS_COOKIE_PASSWORD",
];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json({ limit: "16kb" }));
app.use(cookieParser());

const workos = new WorkOS(process.env.WORKOS_API_KEY, {
  clientId: process.env.WORKOS_CLIENT_ID,
});

const PORT = process.env.PORT || 3001;
const IS_PROD = process.env.NODE_ENV === "production";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5176";
const COOKIE_PASSWORD = process.env.WORKOS_COOKIE_PASSWORD;
const SESSION_COOKIE = "wos-session";
const COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  secure: IS_PROD,
  sameSite: "lax",
  maxAge: 400 * 24 * 60 * 60 * 1000, // 400 days
};

const sessionConfig = {
  sealSession: true,
  cookiePassword: COOKIE_PASSWORD,
};

// ---------------------------------------------------------------------------
// CSRF protection
// ---------------------------------------------------------------------------

const CSRF_SECRET = process.env.CSRF_SECRET || COOKIE_PASSWORD;

const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => CSRF_SECRET,
  getSessionIdentifier: (req) => req.cookies[SESSION_COOKIE] ?? "",
  cookieName: "__csrf",
  cookieOptions: {
    path: "/",
    httpOnly: true,
    secure: IS_PROD,
    sameSite: "lax",
  },
  getTokenFromRequest: (req) =>
    req.headers["x-csrf-token"] || req.body?._csrf,
});

app.get("/api/auth/csrf-token", (req, res) => {
  const token = generateCsrfToken(req, res);
  return res.json({ csrfToken: token });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setSessionCookie(res, sealedSession) {
  res.cookie(SESSION_COOKIE, sealedSession, COOKIE_OPTIONS);
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

function isOrgSelectionRequired(err) {
  const rawData = err.rawData || {};
  return (
    (rawData.code === "organization_selection_required" ||
      err.error === "organization_selection_required" ||
      err.code === "organization_selection_required") &&
    !!rawData.pending_authentication_token
  );
}

function handleOrgSelectionError(err, res) {
  if (!isOrgSelectionRequired(err)) return null;

  return res.status(403).json({
    status: "org_selection_required",
    pendingAuthenticationToken: err.rawData.pending_authentication_token,
    organizations: err.rawData.organizations ?? [],
  });
}

function requireBody(req, res, fields) {
  for (const field of fields) {
    if (!req.body?.[field]) {
      res.status(400).json({
        status: "error",
        error: `Missing required field: ${field}`,
      });
      return false;
    }
  }
  return true;
}

const NO_REFRESH_REASONS = new Set([
  "no_session_cookie_provided",
  "invalid_session_cookie",
]);

// ---------------------------------------------------------------------------
// Auth middleware — matches the WorkOS docs withAuth pattern
//
// For the customer's Lambda setup, this logic would live in each Lambda
// handler or in a shared utility. The pattern is the same: authenticate,
// check reason, refresh if needed, update cookie.
// ---------------------------------------------------------------------------

async function withAuth(req, res, next) {
  const sessionData = req.cookies[SESSION_COOKIE];

  if (!sessionData) {
    return res.status(401).json({ authenticated: false, reason: "no_session_cookie" });
  }

  try {
    const session = workos.userManagement.loadSealedSession({
      sessionData,
      cookiePassword: COOKIE_PASSWORD,
    });

    const { authenticated, reason, ...claims } = await session.authenticate();

    if (authenticated) {
      req.session = claims;
      return next();
    }

    if (NO_REFRESH_REASONS.has(reason)) {
      clearSessionCookie(res);
      return res.status(401).json({ authenticated: false, reason });
    }

    // Session expired — attempt refresh
    try {
      const refreshResult = await session.refresh();

      if (refreshResult.authenticated) {
        setSessionCookie(res, refreshResult.sealedSession);
        req.session = {
          user: refreshResult.user,
          organizationId: refreshResult.organizationId,
          role: refreshResult.role,
          permissions: refreshResult.permissions,
        };
        return next();
      }
    } catch {
      // refresh failed
    }

    clearSessionCookie(res);
    return res.status(401).json({ authenticated: false, reason: reason || "session_expired" });
  } catch (err) {
    console.error("Auth middleware error:", err.message);
    clearSessionCookie(res);
    return res.status(401).json({ authenticated: false, reason: "session_error" });
  }
}

function isSsoRequired(err) {
  const rawData = err.rawData || {};
  return (
    rawData.error === "sso_required" ||
    err.error === "sso_required" ||
    err.code === "sso_required"
  );
}

function handleSsoRequiredError(err, res) {
  if (!isSsoRequired(err)) return null;

  const rawData = err.rawData || {};
  const connectionIds = rawData.connection_ids || [];
  return res.status(403).json({
    status: "sso_required",
    connectionIds,
    email: rawData.email,
  });
}

// ---------------------------------------------------------------------------
// POST /api/auth/check-email — domain-based SSO detection
// ---------------------------------------------------------------------------
app.post("/api/auth/check-email", async (req, res) => {
  if (!requireBody(req, res, ["email"])) return;

  const domain = req.body.email.split("@")[1]?.toLowerCase();
  if (!domain) {
    return res.json({ method: "credentials" });
  }

  try {
    const connections = await workos.sso.listConnections({ domain });
    const active = connections.data.filter((c) => c.state === "active");

    if (active.length > 0) {
      return res.json({
        method: "sso",
        ssoUrl: `/api/auth/sso?connection_id=${encodeURIComponent(active[0].id)}`,
      });
    }

    return res.json({ method: "credentials" });
  } catch (err) {
    console.error("Check email error:", err.message);
    return res.json({ method: "credentials" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/sso — redirect to SSO identity provider
// ---------------------------------------------------------------------------
app.get("/api/auth/sso", async (req, res) => {
  const { connection_id } = req.query;

  if (!connection_id) {
    return res.redirect(
      `${FRONTEND_URL}?error=${encodeURIComponent("Missing connection ID")}`,
    );
  }

  try {
    const authorizationUrl = workos.userManagement.getAuthorizationUrl({
      connectionId: connection_id,
      redirectUri: `${FRONTEND_URL}/api/auth/callback`,
    });
    return res.redirect(authorizationUrl);
  } catch (err) {
    console.error("SSO redirect error:", err.message);
    return res.redirect(
      `${FRONTEND_URL}?error=${encodeURIComponent(err.message)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/google — redirect to Google OAuth via WorkOS
// ---------------------------------------------------------------------------
app.get("/api/auth/google", async (_req, res) => {
  try {
    const authorizationUrl = workos.userManagement.getAuthorizationUrl({
      provider: "GoogleOAuth",
      redirectUri: `${FRONTEND_URL}/api/auth/callback`,
    });
    return res.redirect(authorizationUrl);
  } catch (err) {
    console.error("Google auth URL error:", err.message);
    return res.redirect(
      `${FRONTEND_URL}?error=${encodeURIComponent(err.message)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/callback — OAuth redirect callback (Google, etc.)
// ---------------------------------------------------------------------------
app.get("/api/auth/callback", async (req, res) => {
  const { code } = req.query;

  if (!code) {
    const errMsg =
      req.query.error_description ||
      req.query.error ||
      "Missing authorization code";
    return res.redirect(
      `${FRONTEND_URL}?error=${encodeURIComponent(errMsg)}`,
    );
  }

  try {
    const result = await workos.userManagement.authenticateWithCode({
      code,
      session: sessionConfig,
    });

    setSessionCookie(res, result.sealedSession);
    return res.redirect(FRONTEND_URL);
  } catch (err) {
    if (isOrgSelectionRequired(err)) {
      const token = err.rawData.pending_authentication_token;
      const orgs = encodeURIComponent(
        JSON.stringify(err.rawData.organizations ?? []),
      );
      return res.redirect(
        `${FRONTEND_URL}?org_selection=true&token=${token}&orgs=${orgs}`,
      );
    }

    console.error("OAuth callback error:", err.message);
    return res.redirect(
      `${FRONTEND_URL}?error=${encodeURIComponent(err.errorDescription || err.message)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/password
// ---------------------------------------------------------------------------
app.post("/api/auth/password", async (req, res) => {
  if (!requireBody(req, res, ["email", "password"])) return;
  const { email, password } = req.body;

  try {
    const result = await workos.userManagement.authenticateWithPassword({
      email,
      password,
      session: sessionConfig,
    });

    setSessionCookie(res, result.sealedSession);
    return res.json({
      status: "authenticated",
      user: result.user,
      organizationId: result.organizationId,
    });
  } catch (err) {
    const orgRes = handleOrgSelectionError(err, res);
    if (orgRes) return orgRes;

    const ssoRes = handleSsoRequiredError(err, res);
    if (ssoRes) return ssoRes;

    console.error("Password auth error:", err.message);
    return res.status(err.status || 500).json({
      status: "error",
      error: err.errorDescription || err.message,
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/magic-auth/send
// ---------------------------------------------------------------------------
app.post("/api/auth/magic-auth/send", async (req, res) => {
  if (!requireBody(req, res, ["email"])) return;
  const { email } = req.body;

  try {
    await workos.userManagement.createMagicAuth({ email });
    return res.json({ status: "sent" });
  } catch (err) {
    console.error("Magic auth send error:", err.message);
    return res.status(err.status || 500).json({
      status: "error",
      error: err.errorDescription || err.message,
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/magic-auth/verify
// ---------------------------------------------------------------------------
app.post("/api/auth/magic-auth/verify", async (req, res) => {
  if (!requireBody(req, res, ["email", "code"])) return;
  const { email, code } = req.body;

  try {
    const result = await workos.userManagement.authenticateWithMagicAuth({
      email,
      code,
      session: sessionConfig,
    });

    setSessionCookie(res, result.sealedSession);
    return res.json({
      status: "authenticated",
      user: result.user,
      organizationId: result.organizationId,
    });
  } catch (err) {
    const orgRes = handleOrgSelectionError(err, res);
    if (orgRes) return orgRes;

    const ssoRes = handleSsoRequiredError(err, res);
    if (ssoRes) return ssoRes;

    console.error("Magic auth verify error:", err.message);
    return res.status(err.status || 500).json({
      status: "error",
      error: err.errorDescription || err.message,
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/org-selection
// ---------------------------------------------------------------------------
app.post("/api/auth/org-selection", async (req, res) => {
  if (!requireBody(req, res, ["pendingAuthenticationToken", "organizationId"]))
    return;
  const { pendingAuthenticationToken, organizationId } = req.body;

  try {
    const result =
      await workos.userManagement.authenticateWithOrganizationSelection({
        pendingAuthenticationToken,
        organizationId,
        session: sessionConfig,
      });

    setSessionCookie(res, result.sealedSession);
    return res.json({
      status: "authenticated",
      user: result.user,
      organizationId: result.organizationId,
    });
  } catch (err) {
    console.error("Org selection error:", err.message);
    return res.status(err.status || 500).json({
      status: "error",
      error: err.errorDescription || err.message,
    });
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/session — uses withAuth middleware
// ---------------------------------------------------------------------------
app.get("/api/auth/session", withAuth, (req, res) => {
  return res.json({
    authenticated: true,
    user: req.session.user,
    organizationId: req.session.organizationId,
    role: req.session.role,
    permissions: req.session.permissions,
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/switch-org — CSRF-protected, requires auth
// ---------------------------------------------------------------------------
app.post(
  "/api/auth/switch-org",
  doubleCsrfProtection,
  withAuth,
  async (req, res) => {
    if (!requireBody(req, res, ["organizationId"])) return;
    const { organizationId } = req.body;
    const sessionData = req.cookies[SESSION_COOKIE];

    try {
      const session = workos.userManagement.loadSealedSession({
        sessionData,
        cookiePassword: COOKIE_PASSWORD,
      });

      const refreshResult = await session.refresh({ organizationId });

      if (refreshResult.authenticated) {
        setSessionCookie(res, refreshResult.sealedSession);
        return res.json({
          status: "switched",
          user: refreshResult.user,
          organizationId: refreshResult.organizationId,
          role: refreshResult.role,
          permissions: refreshResult.permissions,
        });
      }

      return res
        .status(401)
        .json({ status: "error", error: "Refresh failed" });
    } catch (err) {
      console.error("Switch org error:", err.message);
      return res.status(err.status || 500).json({
        status: "error",
        error: err.errorDescription || err.message,
      });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/auth/logout — CSRF-protected
// ---------------------------------------------------------------------------
app.post("/api/auth/logout", doubleCsrfProtection, async (req, res) => {
  const sessionData = req.cookies[SESSION_COOKIE];

  if (!sessionData) {
    clearSessionCookie(res);
    return res.json({ status: "logged_out" });
  }

  try {
    const session = workos.userManagement.loadSealedSession({
      sessionData,
      cookiePassword: COOKIE_PASSWORD,
    });

    const logOutUrl = await session.getLogOutUrl();
    clearSessionCookie(res);
    return res.json({ status: "logged_out", logOutUrl });
  } catch {
    clearSessionCookie(res);
    return res.json({ status: "logged_out" });
  }
});

// ---------------------------------------------------------------------------
// Start (skip when imported for testing)
// ---------------------------------------------------------------------------
if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`API server running on http://localhost:${PORT}`);
  });
}

export {
  app,
  isOrgSelectionRequired,
  isSsoRequired,
  requireBody,
};
