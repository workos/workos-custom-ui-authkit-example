let csrfToken: string | null = null;

async function fetchCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  try {
    const res = await fetch("/api/auth/csrf-token", { credentials: "include" });
    if (!res.ok) throw new Error(`CSRF token request failed: ${res.status}`);
    const data = await res.json();
    if (!data.csrfToken) throw new Error("No csrfToken in response");
    csrfToken = data.csrfToken as string;
    return csrfToken;
  } catch (err) {
    csrfToken = null;
    throw new Error(
      `Failed to fetch CSRF token: ${err instanceof Error ? err.message : "unknown error"}`,
    );
  }
}

function parseJsonResponse<T>(text: string, status: number): T {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(text.slice(0, 200) || `HTTP ${status}`);
  }
}

export async function api<T = unknown>(
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
        const retryText = await retry.text();
        return { status: retry.status, data: parseJsonResponse<T>(retryText, retry.status) };
      }
    } catch {
      // not JSON or CSRF refetch failed — fall through to parse original
    }
  }

  const text = await res.text();
  return { status: res.status, data: parseJsonResponse<T>(text, res.status) };
}

/** Reset cached CSRF token (useful after logout). */
export function clearCsrfCache(): void {
  csrfToken = null;
}
