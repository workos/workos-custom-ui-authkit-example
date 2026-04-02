import { useState, useEffect, useCallback, useRef, type FormEvent } from "react";
import {
  Avatar,
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Code,
  Flex,
  Heading,
  Separator,
  Spinner,
  Text,
  TextField,
} from "@radix-ui/themes";
import { api, clearCsrfCache } from "./api";
import type {
  AuthResponse,
  CheckEmailResponse,
  ErrorResponse,
  LogEntry,
  LoginStep,
  OrgChoice,
  OrgRequiredResponse,
  SessionResponse,
  SsoRequiredResponse,
  User,
  View,
} from "./types";
import "./app.css";

// Capture URL params immediately (survives React StrictMode double-mount)
const initialParams = new URLSearchParams(window.location.search);
if (initialParams.toString()) {
  window.history.replaceState({}, "", "/");
}

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
  const [loading, setLoading] = useState<string | false>(false);
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
    setLoading("check-email");
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

      if (data.method === "sso" && data.ssoUrl) {
        window.location.href = data.ssoUrl;
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
    setLoading("password");
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
    setLoading("magic-send");
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
    setLoading("magic-verify");
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
    setLoading("org-select");
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
    clearCsrfCache();
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
    return (
      <Callout.Root color="red" size="1" mb="4">
        <Callout.Text>{error}</Callout.Text>
      </Callout.Root>
    );
  }

  function renderLogs() {
    if (logs.length === 0) return null;
    return (
      <Box className="log-panel">
        <Text size="1" weight="medium" color="gray" mb="2" asChild>
          <div>API Log</div>
        </Text>
        <Flex direction="column" gap="1">
          {logs.map((l, i) => (
            <Card key={i} size="1" className="log-entry">
              <Text size="1" color="iris">{l.ts} {l.method}</Text>{" "}
              <Text size="1" color="gray">{l.url}</Text>{" "}
              <Text size="1" color={l.status >= 400 ? "red" : "green"}>
                {l.status}
              </Text>
              <Text size="1" color="gray" asChild>
                <div style={{ marginTop: 2 }}>
                  {JSON.stringify(l.body).slice(0, 200)}
                </div>
              </Text>
            </Card>
          ))}
        </Flex>
      </Box>
    );
  }

  // ------ Loading ------
  if (view === "loading") {
    return (
      <Flex className="page" align="center" justify="center">
        <Card size="3" className="auth-card">
          <Flex align="center" justify="center" gap="3" py="6">
            <Spinner size="3" />
            <Heading size="4">Loading...</Heading>
          </Flex>
        </Card>
      </Flex>
    );
  }

  // ------ Login ------
  if (view === "login") {
    const isEmailStep = loginStep === "email";

    return (
      <div className="page">
        <Card size="3" className="auth-card">
          <Heading size="5" align="center" mb="5">Sign In</Heading>
          {renderError()}

          <form onSubmit={isEmailStep ? checkEmail : loginWithPassword}>
            <Flex direction="column" gap="3">
              <Box>
                <Text as="label" size="2" weight="medium" color="gray" htmlFor="login-email">
                  Email
                </Text>
                <TextField.Root
                  id="login-email"
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
                  size="3"
                  mt="1"
                />
              </Box>

              {isEmailStep ? (
                <Button type="submit" size="3" disabled={!!loading || !email}>
                  {loading === "check-email" ? <Spinner size="2" /> : "Continue"}
                </Button>
              ) : (
                <>
                  <Box>
                    <Text as="label" size="2" weight="medium" color="gray" htmlFor="login-password">
                      Password
                    </Text>
                    <TextField.Root
                      id="login-password"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      size="3"
                      mt="1"
                      autoFocus
                    />
                  </Box>

                  <Button type="submit" size="3" disabled={!!loading}>
                    {loading === "password" ? <Spinner size="2" /> : "Sign in with Password"}
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    size="3"
                    disabled={!!loading}
                    onClick={() => sendMagicCode()}
                  >
                    {loading === "magic-send" ? <Spinner size="2" /> : "Send Magic Code Instead"}
                  </Button>
                </>
              )}
            </Flex>
          </form>

          <Flex align="center" gap="3" my="4">
            <Separator size="4" />
            <Text size="2" color="gray">or</Text>
            <Separator size="4" />
          </Flex>

          <a href="/api/auth/google" className="google-btn">
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.03 24.03 0 0 0 0 21.56l7.98-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            Sign in with Google
          </a>
        </Card>
        {renderLogs()}
      </div>
    );
  }

  // ------ Magic Code Verification ------
  if (view === "magic-code") {
    return (
      <div className="page">
        <Card size="3" className="auth-card">
          <Heading size="5" align="center" mb="2">Enter Code</Heading>
          <Text size="2" color="gray" align="center" mb="4" asChild>
            <p>
              We sent a 6-digit code to{" "}
              <Text weight="bold" color="gray" highContrast>{email}</Text>
            </p>
          </Text>
          {renderError()}

          <form onSubmit={verifyMagicCode}>
            <Flex direction="column" gap="3">
              <Box>
                <Text as="label" size="2" weight="medium" color="gray" htmlFor="magic-code">
                  Code
                </Text>
                <TextField.Root
                  id="magic-code"
                  className="code-input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={magicCode}
                  onChange={(e) => setMagicCode(e.target.value)}
                  placeholder="000000"
                  maxLength={6}
                  size="3"
                  mt="1"
                />
              </Box>

              <Button type="submit" size="3" disabled={!!loading}>
                {loading === "magic-verify" ? <Spinner size="2" /> : "Verify Code"}
              </Button>
            </Flex>
          </form>

          <Button
            variant="outline"
            size="3"
            mt="3"
            className="full-width"
            onClick={() => {
              setError("");
              setLoginStep("email");
              setView("login");
            }}
          >
            Back to Login
          </Button>
        </Card>
        {renderLogs()}
      </div>
    );
  }

  // ------ Org Picker ------
  if (view === "org-picker") {
    return (
      <div className="page">
        <Card size="3" className="auth-card">
          <Heading size="5" align="center" mb="2">Select Organization</Heading>
          <Text size="2" color="gray" align="center" mb="4" asChild>
            <p>Your account belongs to multiple organizations. Choose one to continue.</p>
          </Text>
          {renderError()}

          <Flex direction="column" gap="2">
            {orgChoices.map((oc) => (
              <Card
                key={oc.id}
                size="2"
                className="org-card"
                role="button"
                tabIndex={0}
                aria-label={`Select ${oc.name}`}
                onClick={() => !loading && selectOrg(oc.id)}
                onKeyDown={(e) => e.key === "Enter" && !loading && selectOrg(oc.id)}
                style={{ opacity: loading ? 0.6 : 1 }}
                asChild
              >
                <div>
                  <Flex justify="between" align="center">
                    <Box>
                      <Text size="2" weight="bold">{oc.name}</Text>
                      <Text size="1" color="gray" asChild>
                        <div>{oc.id}</div>
                      </Text>
                    </Box>
                    <Text size="4" color="iris" aria-hidden="true">→</Text>
                  </Flex>
                </div>
              </Card>
            ))}
          </Flex>

          <Button
            variant="outline"
            size="3"
            mt="4"
            className="full-width"
            onClick={() => {
              setError("");
              setLoginStep("email");
              setView("login");
            }}
          >
            Back to Login
          </Button>
        </Card>
        {renderLogs()}
      </div>
    );
  }

  // ------ Dashboard ------
  return (
    <div className="page">
      <Card size="3" className="auth-card">
        <Heading size="5" align="center" mb="5">Dashboard</Heading>

        {user && (
          <Flex align="center" gap="4" mb="5">
            <Avatar
              size="4"
              src={user.profilePictureUrl ?? undefined}
              fallback={(user.firstName?.[0] || user.email[0]).toUpperCase()}
              radius="full"
            />
            <Box>
              <Text size="3" weight="bold">
                {[user.firstName, user.lastName].filter(Boolean).join(" ") || user.email}
              </Text>
              <Text size="2" color="gray" asChild>
                <div>{user.email}</div>
              </Text>
            </Box>
          </Flex>
        )}

        {orgId && (
          <Box mb="4">
            <Badge color="iris" size="2">Org: {orgId}</Badge>
          </Box>
        )}

        <Card size="2" mb="4">
          <Flex direction="column" gap="1">
            <Text size="1" color="gray">User ID</Text>
            <Code size="2" variant="ghost">{user?.id}</Code>
          </Flex>
        </Card>

        <Button color="red" size="3" className="full-width" onClick={logout}>
          Sign Out
        </Button>
      </Card>
      {renderLogs()}
    </div>
  );
}
