import { useState, useEffect, useCallback, useRef, type FormEvent } from "react";
import { api, clearCsrfCache } from "../api";
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
} from "../types";
import { isOrgRequired, isSsoRequired } from "../types";

const MAX_LOG_ENTRIES = 20;

// Capture URL params at module level — survives React StrictMode double-mount
const initialParams = new URLSearchParams(window.location.search);

export function useAuth() {
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

  // ------ Shared response handlers ------

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

  // ------ Init: check URL params then session ------

  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    if (initialParams.toString()) {
      window.history.replaceState({}, "", "/");
    }

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

  // ------ Auth actions ------

  // Changing the email field resets to the email step
  function onEmailChange(value: string) {
    setEmail(value);
    if (loginStep !== "email") {
      setLoginStep("email");
      setPassword("");
      setError("");
    }
  }

  function goToLogin() {
    setError("");
    setLoginStep("email");
    setView("login");
  }

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

  async function loginWithPassword(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading("password");
    try {
      const { status, data } = await callApi<
        AuthResponse | OrgRequiredResponse | SsoRequiredResponse | ErrorResponse
      >("POST", "/api/auth/password", { email, password });

      if (isOrgRequired(data)) return handleOrgRequired(data);
      if (isSsoRequired(data)) return handleSsoRequired(data);
      if (status >= 400) return setError((data as ErrorResponse).error || "Authentication failed");
      handleAuthSuccess(data as AuthResponse);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

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

      if (isOrgRequired(data)) return handleOrgRequired(data);
      if (isSsoRequired(data)) return handleSsoRequired(data);
      if (status >= 400) return setError((data as ErrorResponse).error || "Verification failed");
      handleAuthSuccess(data as AuthResponse);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

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

  async function logout() {
    function reset() {
      clearCsrfCache();
      setUser(null);
      setOrgId(null);
      setPendingToken("");
      setOrgChoices([]);
      setLoginStep("email");
      setView("login");
    }

    try {
      const { data } = await callApi<{ status: string; logOutUrl?: string }>(
        "POST",
        "/api/auth/logout",
      );
      reset();
      if (data?.logOutUrl) {
        window.location.href = data.logOutUrl;
      }
    } catch {
      reset();
    }
  }

  return {
    view,
    loginStep,
    user,
    orgId,
    email,
    password,
    magicCode,
    orgChoices,
    error,
    loading,
    logs,
    onEmailChange,
    setPassword,
    setMagicCode,
    checkEmail,
    loginWithPassword,
    sendMagicCode,
    verifyMagicCode,
    selectOrg,
    logout,
    goToLogin,
  };
}
