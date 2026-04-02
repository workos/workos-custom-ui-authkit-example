import { useState, useEffect, useCallback, useRef, type FormEvent } from "react";

// Capture URL params immediately (survives React StrictMode double-mount)
const initialParams = new URLSearchParams(window.location.search);
if (initialParams.toString()) {
  window.history.replaceState({}, "", "/");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface User {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  profilePictureUrl: string | null;
}

interface OrgChoice {
  id: string;
  name: string;
}

interface AuthResponse {
  status: string;
  user: User;
  organizationId?: string;
}

interface OrgRequiredResponse {
  status: "org_selection_required";
  pendingAuthenticationToken: string;
  organizations: OrgChoice[];
}

interface SsoRequiredResponse {
  status: "sso_required";
  connectionIds: string[];
  email?: string;
}

interface CheckEmailResponse {
  method: "sso" | "credentials";
  connectionId?: string;
  connectionType?: string;
  organizationId?: string;
}

interface SessionResponse {
  authenticated: boolean;
  user?: User;
  organizationId?: string;
  reason?: string;
}

interface ErrorResponse {
  status: "error";
  error: string;
}

type View =
  | "loading"
  | "login"
  | "magic-code"
  | "org-picker"
  | "dashboard";

type LoginStep = "email" | "credentials";

interface LogEntry {
  ts: string;
  method: string;
  url: string;
  status: number;
  body: unknown;
}

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------

let csrfToken: string | null = null;

async function fetchCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  const res = await fetch("/api/auth/csrf-token", { credentials: "include" });
  const data = await res.json();
  csrfToken = data.csrfToken;
  return csrfToken!;
}

async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";

  if (method !== "GET") {
    headers["x-csrf-token"] = await fetchCsrfToken();
  }

  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include",
  });

  // CSRF token may be rotated — refetch on 403 with "invalid csrf token"
  if (res.status === 403) {
    const clone = res.clone();
    try {
      const errBody = await clone.json();
      if (typeof errBody?.error === "string" && errBody.error.toLowerCase().includes("csrf")) {
        csrfToken = null;
        headers["x-csrf-token"] = await fetchCsrfToken();
        const retry = await fetch(path, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          credentials: "include",
        });
        const retryData = await retry.json();
        return { status: retry.status, data: retryData };
      }
    } catch {
      // not JSON — fall through
    }
  }

  const data = await res.json();
  return { status: res.status, data };
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = {
  page: {
    minHeight: "100vh",
    background: "linear-gradient(135deg, #0f172a, #1e293b)",
    color: "#e2e8f0",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "40px 16px",
  },
  card: {
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: 12,
    padding: 32,
    width: "100%",
    maxWidth: 420,
    boxShadow: "0 8px 32px rgba(0,0,0,.4)",
  },
  heading: {
    fontSize: 24,
    fontWeight: 700,
    marginBottom: 24,
    textAlign: "center" as const,
  },
  label: {
    display: "block",
    fontSize: 13,
    fontWeight: 500,
    color: "#94a3b8",
    marginBottom: 6,
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: 8,
    color: "#e2e8f0",
    fontSize: 14,
    outline: "none",
    marginBottom: 16,
    boxSizing: "border-box" as const,
  },
  button: {
    width: "100%",
    padding: "12px 0",
    border: "none",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    marginBottom: 12,
    transition: "opacity .15s",
  },
  primaryBtn: {
    background: "#6366f1",
    color: "#fff",
  },
  secondaryBtn: {
    background: "transparent",
    border: "1px solid #475569",
    color: "#94a3b8",
  },
  dangerBtn: {
    background: "#ef4444",
    color: "#fff",
  },
  googleBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    background: "#fff",
    color: "#1f2937",
    textDecoration: "none",
    borderRadius: 8,
    padding: "12px 0",
    fontWeight: 600,
    fontSize: 14,
  },
  orgCard: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 16px",
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: 8,
    marginBottom: 8,
    cursor: "pointer",
    transition: "border-color .15s",
  },
  userInfo: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    marginBottom: 24,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: "50%",
    background: "#6366f1",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 20,
    fontWeight: 700,
    color: "#fff",
    flexShrink: 0,
  },
  badge: {
    display: "inline-block",
    padding: "4px 10px",
    background: "#6366f1",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    color: "#fff",
    marginBottom: 16,
  },
  mono: {
    padding: 16,
    background: "#0f172a",
    borderRadius: 8,
    border: "1px solid #334155",
    fontSize: 13,
    fontFamily: "monospace",
    marginBottom: 20,
    wordBreak: "break-all" as const,
  },
  logPanel: {
    width: "100%",
    maxWidth: 420,
    marginTop: 24,
  },
  logEntry: {
    padding: "8px 12px",
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: 8,
    marginBottom: 6,
    fontSize: 12,
    fontFamily: "monospace",
    wordBreak: "break-all" as const,
  },
  error: {
    color: "#fca5a5",
    background: "#450a0a",
    padding: "10px 14px",
    borderRadius: 8,
    fontSize: 13,
    marginBottom: 16,
  },
  divider: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
    color: "#475569",
    fontSize: 13,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    background: "#334155",
  },
  codeInput: {
    letterSpacing: 6,
    textAlign: "center" as const,
    fontSize: 20,
  },
} satisfies Record<string, React.CSSProperties>;

const MAX_LOG_ENTRIES = 20;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function App() {
  const [view, setView] = useState<View>("loading");
  const [loginStep, setLoginStep] = useState<LoginStep>("email");
  const [user, setUser] = useState<User | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [magicCode, setMagicCode] = useState("");

  const [orgChoices, setOrgChoices] = useState<OrgChoice[]>([]);
  const [pendingToken, setPendingToken] = useState("");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const addLog = useCallback(
    (method: string, url: string, status: number, body: unknown) => {
      setLogs((prev) => [
        { ts: new Date().toLocaleTimeString(), method, url, status, body },
        ...prev.slice(0, MAX_LOG_ENTRIES - 1),
      ]);
    },
    [],
  );

  const callApi = useCallback(
    async <T = unknown>(
      method: string,
      path: string,
      body?: unknown,
    ): Promise<{ status: number; data: T }> => {
      const result = await api<T>(method, path, body);
      addLog(method, path, result.status, result.data);
      return result;
    },
    [addLog],
  );

  // ------ Check URL params from OAuth callback, then check session ------
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    if (initialParams.has("error")) {
      setError(initialParams.get("error")!);
      setView("login");
      return;
    }

    if (initialParams.get("org_selection") === "true") {
      const token = initialParams.get("token") || "";
      let orgs: OrgChoice[] = [];
      try {
        orgs = JSON.parse(initialParams.get("orgs") || "[]");
      } catch {
        /* malformed — show empty picker */
      }
      setPendingToken(token);
      setOrgChoices(orgs);
      setView("org-picker");
      return;
    }

    (async () => {
      try {
        const { status, data } = await callApi<SessionResponse>(
          "GET",
          "/api/auth/session",
        );

        if (status === 200 && data.authenticated && data.user) {
          setUser(data.user);
          setOrgId(data.organizationId ?? null);
          setView("dashboard");
        } else {
          setView("login");
        }
      } catch {
        setView("login");
      }
    })();
  }, [callApi]);

  // ------ Shared handlers ------

  function handleOrgRequired(data: OrgRequiredResponse) {
    setPendingToken(data.pendingAuthenticationToken);
    setOrgChoices(data.organizations);
    setError("");
    setView("org-picker");
  }

  function handleSsoRequired(data: SsoRequiredResponse) {
    if (data.connectionIds.length > 0) {
      window.location.href = `/api/auth/sso?connection_id=${encodeURIComponent(data.connectionIds[0])}`;
    } else {
      setError("SSO is required for this domain but no connection was found.");
    }
  }

  function handleAuthSuccess(data: AuthResponse) {
    setUser(data.user);
    setOrgId(data.organizationId ?? null);
    setPendingToken("");
    setOrgChoices([]);
    setError("");
    setView("dashboard");
  }

  // ------ Email check (domain SSO detection) ------
  async function checkEmail(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { status, data } = await callApi<CheckEmailResponse>(
        "POST",
        "/api/auth/check-email",
        { email },
      );

      if (status >= 400) {
        setLoginStep("credentials");
        return;
      }

      if (data.method === "sso" && data.connectionId) {
        window.location.href = `/api/auth/sso?connection_id=${encodeURIComponent(data.connectionId)}`;
        return;
      }

      setLoginStep("credentials");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Network error");
      setLoginStep("credentials");
    } finally {
      setLoading(false);
    }
  }

  // ------ Password Login ------
  async function loginWithPassword(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { status, data } = await callApi<
        AuthResponse | OrgRequiredResponse | SsoRequiredResponse | ErrorResponse
      >("POST", "/api/auth/password", { email, password });

      if (status === 403 && "pendingAuthenticationToken" in data) {
        return handleOrgRequired(data as OrgRequiredResponse);
      }
      if (status === 403 && (data as SsoRequiredResponse).status === "sso_required") {
        return handleSsoRequired(data as SsoRequiredResponse);
      }
      if (status >= 400) {
        return setError((data as ErrorResponse).error || "Authentication failed");
      }
      handleAuthSuccess(data as AuthResponse);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  // ------ Magic Auth ------
  async function sendMagicCode(e?: FormEvent) {
    e?.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { status, data } = await callApi<{ status: string } | ErrorResponse>(
        "POST",
        "/api/auth/magic-auth/send",
        { email },
      );
      if (status >= 400) {
        return setError((data as ErrorResponse).error || "Failed to send code");
      }
      setView("magic-code");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  async function verifyMagicCode(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { status, data } = await callApi<
        AuthResponse | OrgRequiredResponse | SsoRequiredResponse | ErrorResponse
      >("POST", "/api/auth/magic-auth/verify", { email, code: magicCode });

      if (status === 403 && "pendingAuthenticationToken" in data) {
        return handleOrgRequired(data as OrgRequiredResponse);
      }
      if (status === 403 && (data as SsoRequiredResponse).status === "sso_required") {
        return handleSsoRequired(data as SsoRequiredResponse);
      }
      if (status >= 400) {
        return setError((data as ErrorResponse).error || "Verification failed");
      }
      handleAuthSuccess(data as AuthResponse);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  // ------ Org Selection ------
  async function selectOrg(selectedOrgId: string) {
    setError("");
    setLoading(true);
    try {
      const { status, data } = await callApi<AuthResponse | ErrorResponse>(
        "POST",
        "/api/auth/org-selection",
        {
          pendingAuthenticationToken: pendingToken,
          organizationId: selectedOrgId,
        },
      );

      if (status >= 400) {
        return setError((data as ErrorResponse).error || "Org selection failed");
      }
      handleAuthSuccess(data as AuthResponse);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  // ------ Logout ------
  async function logout() {
    try {
      await callApi("POST", "/api/auth/logout");
    } catch {
      // best-effort
    }
    setUser(null);
    setOrgId(null);
    setPendingToken("");
    setOrgChoices([]);
    setLoginStep("email");
    setView("login");
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  function renderError() {
    if (!error) return null;
    return <div style={styles.error}>{error}</div>;
  }

  function renderLogs() {
    if (logs.length === 0) return null;
    return (
      <div style={styles.logPanel}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#64748b", marginBottom: 8 }}>
          API Log
        </div>
        {logs.map((l, i) => (
          <div key={i} style={styles.logEntry}>
            <span style={{ color: "#6366f1" }}>
              {l.ts} {l.method}
            </span>{" "}
            <span style={{ color: "#94a3b8" }}>{l.url}</span>{" "}
            <span style={{ color: l.status >= 400 ? "#fca5a5" : "#4ade80" }}>
              {l.status}
            </span>
            <div style={{ color: "#64748b", marginTop: 4 }}>
              {JSON.stringify(l.body).slice(0, 200)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ------ Loading ------
  if (view === "loading") {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.heading}>Loading...</div>
        </div>
      </div>
    );
  }

  // ------ Login ------
  if (view === "login") {
    const isEmailStep = loginStep === "email";

    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.heading}>Sign In</div>
          {renderError()}

          {/* Email field is always visible */}
          <form onSubmit={isEmailStep ? checkEmail : loginWithPassword}>
            <label style={styles.label} htmlFor="login-email">Email</label>
            <input
              id="login-email"
              style={styles.input}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (!isEmailStep) {
                  setLoginStep("email");
                  setPassword("");
                  setError("");
                }
              }}
              placeholder="you@company.com"
            />

            {isEmailStep ? (
              <button
                type="submit"
                style={{ ...styles.button, ...styles.primaryBtn }}
                disabled={loading || !email}
              >
                {loading ? "Checking..." : "Continue"}
              </button>
            ) : (
              <>
                <label style={styles.label} htmlFor="login-password">Password</label>
                <input
                  id="login-password"
                  style={styles.input}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoFocus
                />

                <button
                  type="submit"
                  style={{ ...styles.button, ...styles.primaryBtn }}
                  disabled={loading}
                >
                  {loading ? "Signing in..." : "Sign in with Password"}
                </button>

                <button
                  type="button"
                  style={{ ...styles.button, ...styles.secondaryBtn }}
                  disabled={loading}
                  onClick={() => sendMagicCode()}
                >
                  {loading ? "Sending..." : "Send Magic Code Instead"}
                </button>
              </>
            )}
          </form>

          <div style={styles.divider}>
            <div style={styles.dividerLine} />
            <span>or</span>
            <div style={styles.dividerLine} />
          </div>

          <a href="/api/auth/google" style={{ ...styles.button, ...styles.googleBtn }}>
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.03 24.03 0 0 0 0 21.56l7.98-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            Sign in with Google
          </a>
        </div>
        {renderLogs()}
      </div>
    );
  }

  // ------ Magic Code Verification ------
  if (view === "magic-code") {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.heading}>Enter Code</div>
          <p style={{ color: "#94a3b8", fontSize: 14, marginBottom: 16 }}>
            We sent a 6-digit code to{" "}
            <strong style={{ color: "#e2e8f0" }}>{email}</strong>
          </p>
          {renderError()}

          <form onSubmit={verifyMagicCode}>
            <label style={styles.label} htmlFor="magic-code">Code</label>
            <input
              id="magic-code"
              style={{ ...styles.input, ...styles.codeInput }}
              inputMode="numeric"
              autoComplete="one-time-code"
              value={magicCode}
              onChange={(e) => setMagicCode(e.target.value)}
              placeholder="000000"
              maxLength={6}
            />

            <button
              type="submit"
              style={{ ...styles.button, ...styles.primaryBtn }}
              disabled={loading}
            >
              {loading ? "Verifying..." : "Verify Code"}
            </button>
          </form>

          <button
            type="button"
            style={{ ...styles.button, ...styles.secondaryBtn }}
            onClick={() => {
              setError("");
              setLoginStep("email");
              setView("login");
            }}
          >
            Back to Login
          </button>
        </div>
        {renderLogs()}
      </div>
    );
  }

  // ------ Org Picker ------
  if (view === "org-picker") {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.heading}>Select Organization</div>
          <p style={{ color: "#94a3b8", fontSize: 14, marginBottom: 20 }}>
            Your account belongs to multiple organizations. Choose one to
            continue.
          </p>
          {renderError()}

          {orgChoices.map((oc) => (
            <div
              key={oc.id}
              role="button"
              tabIndex={0}
              style={styles.orgCard}
              onClick={() => !loading && selectOrg(oc.id)}
              onKeyDown={(e) => e.key === "Enter" && !loading && selectOrg(oc.id)}
              onMouseEnter={(e) =>
                (e.currentTarget.style.borderColor = "#6366f1")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.borderColor = "#334155")
              }
            >
              <div>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>
                  {oc.name}
                </div>
                <div style={{ fontSize: 12, color: "#64748b" }}>
                  {oc.id}
                </div>
              </div>
              <span style={{ color: "#6366f1", fontSize: 20 }} aria-hidden="true">→</span>
            </div>
          ))}

          <button
            type="button"
            style={{ ...styles.button, ...styles.secondaryBtn, marginTop: 12 }}
            onClick={() => {
              setError("");
              setLoginStep("email");
              setView("login");
            }}
          >
            Back to Login
          </button>
        </div>
        {renderLogs()}
      </div>
    );
  }

  // ------ Dashboard ------
  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.heading}>Dashboard</div>

        {user && (
          <div style={styles.userInfo}>
            {user.profilePictureUrl ? (
              <img
                src={user.profilePictureUrl}
                alt={`${user.firstName ?? user.email} avatar`}
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  objectFit: "cover",
                }}
              />
            ) : (
              <div style={styles.avatar}>
                {(user.firstName?.[0] || user.email[0]).toUpperCase()}
              </div>
            )}
            <div>
              <div style={{ fontWeight: 600 }}>
                {[user.firstName, user.lastName].filter(Boolean).join(" ") ||
                  user.email}
              </div>
              <div style={{ fontSize: 13, color: "#64748b" }}>
                {user.email}
              </div>
            </div>
          </div>
        )}

        {orgId && <div style={styles.badge}>Org: {orgId}</div>}

        <div style={styles.mono}>
          <div style={{ color: "#64748b", marginBottom: 4 }}>User ID</div>
          <div>{user?.id}</div>
        </div>

        <button
          type="button"
          style={{ ...styles.button, ...styles.dangerBtn }}
          onClick={logout}
        >
          Sign Out
        </button>
      </div>
      {renderLogs()}
    </div>
  );
}
