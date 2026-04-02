// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// Set env before importing server (it validates on load)
process.env.NODE_ENV = "test";
process.env.WORKOS_API_KEY = "sk_test_fake";
process.env.WORKOS_CLIENT_ID = "client_fake";
process.env.WORKOS_COOKIE_PASSWORD = "a]Ek+5S;2/gm,Ry3(cKsia^Gzxpj|O>b";
process.env.FRONTEND_URL = "http://localhost:5176";

// ---------------------------------------------------------------------------
// Mock WorkOS SDK — intercept authenticateWithPassword, etc.
// ---------------------------------------------------------------------------

const mockAuthenticateWithPassword = vi.fn();
const mockCreateMagicAuth = vi.fn();
const mockAuthenticateWithMagicAuth = vi.fn();
const mockAuthenticateWithCode = vi.fn();
const mockAuthenticateWithOrganizationSelection = vi.fn();
const mockGetAuthorizationUrl = vi.fn();
const mockLoadSealedSession = vi.fn();
const mockListConnections = vi.fn();

vi.mock("@workos-inc/node", () => {
  class MockWorkOS {
    userManagement = {
      authenticateWithPassword: mockAuthenticateWithPassword,
      createMagicAuth: mockCreateMagicAuth,
      authenticateWithMagicAuth: mockAuthenticateWithMagicAuth,
      authenticateWithCode: mockAuthenticateWithCode,
      authenticateWithOrganizationSelection:
        mockAuthenticateWithOrganizationSelection,
      getAuthorizationUrl: mockGetAuthorizationUrl,
      loadSealedSession: mockLoadSealedSession,
    };
    sso = {
      listConnections: mockListConnections,
    };
  }
  return { WorkOS: MockWorkOS };
});

const FAKE_USER = {
  id: "user_01ABC",
  email: "test@example.com",
  firstName: "Test",
  lastName: "User",
  profilePictureUrl: null,
};

const FAKE_SEALED_SESSION = "sealed_session_data_here";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractCookies(res: Response): string {
  return (res.headers.getSetCookie?.() ?? [])
    .map((c: string) => c.split(";")[0])
    .join("; ");
}

type App = Awaited<typeof import("./server")>["app"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(res: Response): Promise<Record<string, any>> {
  return (await res.json()) as Record<string, any>;
}

async function post(
  app: App,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return await app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

// --------------------------------------------------------------------------
// Unit tests for exported helper functions
// --------------------------------------------------------------------------

describe("isOrgSelectionRequired", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let isOrgSelectionRequired: (err: any) => boolean;

  beforeAll(async () => {
    const mod = await import("./server");
    isOrgSelectionRequired = mod.isOrgSelectionRequired;
  });

  it("returns true when rawData.code matches and token present", () => {
    const err = {
      rawData: {
        code: "organization_selection_required",
        pending_authentication_token: "tok_abc",
      },
    };
    expect(isOrgSelectionRequired(err)).toBe(true);
  });

  it("returns true when err.code matches and token present", () => {
    const err = {
      code: "organization_selection_required",
      rawData: { pending_authentication_token: "tok_abc" },
    };
    expect(isOrgSelectionRequired(err)).toBe(true);
  });

  it("returns true when err.error matches and token present", () => {
    const err = {
      error: "organization_selection_required",
      rawData: { pending_authentication_token: "tok_abc" },
    };
    expect(isOrgSelectionRequired(err)).toBe(true);
  });

  it("returns false when code matches but no token", () => {
    const err = {
      rawData: { code: "organization_selection_required" },
    };
    expect(isOrgSelectionRequired(err)).toBe(false);
  });

  it("returns false for unrelated errors", () => {
    const err = {
      rawData: { code: "invalid_credentials" },
    };
    expect(isOrgSelectionRequired(err)).toBe(false);
  });

  it("returns false when rawData is missing entirely", () => {
    const err = { message: "Something broke" };
    expect(isOrgSelectionRequired(err)).toBe(false);
  });
});

describe("isSsoRequired", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let isSsoRequired: (err: any) => boolean;

  beforeAll(async () => {
    const mod = await import("./server");
    isSsoRequired = mod.isSsoRequired;
  });

  it("returns true when rawData.error is sso_required", () => {
    const err = { rawData: { error: "sso_required" } };
    expect(isSsoRequired(err)).toBe(true);
  });

  it("returns true when err.error is sso_required", () => {
    const err = { error: "sso_required", rawData: {} };
    expect(isSsoRequired(err)).toBe(true);
  });

  it("returns true when err.code is sso_required", () => {
    const err = { code: "sso_required", rawData: {} };
    expect(isSsoRequired(err)).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    const err = { rawData: { error: "invalid_credentials" } };
    expect(isSsoRequired(err)).toBe(false);
  });

  it("returns false when rawData is missing", () => {
    const err = { message: "Something broke" };
    expect(isSsoRequired(err)).toBe(false);
  });
});

describe("findMissingField", () => {
  let findMissingField: (
    body: Record<string, unknown>,
    fields: string[],
  ) => string | null;

  beforeAll(async () => {
    const mod = await import("./server");
    findMissingField = mod.findMissingField;
  });

  it("returns null when all required fields are present", () => {
    expect(
      findMissingField({ email: "a@b.com", password: "secret" }, [
        "email",
        "password",
      ]),
    ).toBeNull();
  });

  it("returns missing field name when a field is missing", () => {
    expect(
      findMissingField({ email: "a@b.com" }, ["email", "password"]),
    ).toBe("password");
  });

  it("returns first missing field when body is empty", () => {
    expect(findMissingField({}, ["email"])).toBe("email");
  });

  it("returns field name when field is empty string", () => {
    expect(findMissingField({ email: "" }, ["email"])).toBe("email");
  });
});

// --------------------------------------------------------------------------
// Integration tests via app.request()
// --------------------------------------------------------------------------

describe("API routes", () => {
  let app: App;

  beforeAll(async () => {
    const mod = await import("./server");
    app = mod.app;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/auth/csrf-token", () => {
    it("returns a csrfToken string", async () => {
      const res = await app.request("/api/auth/csrf-token");
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body).toHaveProperty("csrfToken");
      expect(typeof body.csrfToken).toBe("string");
      expect(body.csrfToken.length).toBeGreaterThan(0);
    });
  });

  describe("POST /api/auth/password", () => {
    it("rejects missing email", async () => {
      const res = await post(app, "/api/auth/password", { password: "secret" });
      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toMatch(/email/i);
    });

    it("rejects missing password", async () => {
      const res = await post(app, "/api/auth/password", {
        email: "a@b.com",
      });
      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toMatch(/password/i);
    });
  });

  describe("POST /api/auth/magic-auth/send", () => {
    it("rejects missing email", async () => {
      const res = await post(app, "/api/auth/magic-auth/send", {});
      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toMatch(/email/i);
    });
  });

  describe("POST /api/auth/magic-auth/verify", () => {
    it("rejects missing code", async () => {
      const res = await post(app, "/api/auth/magic-auth/verify", {
        email: "a@b.com",
      });
      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toMatch(/code/i);
    });
  });

  describe("POST /api/auth/org-selection", () => {
    it("rejects missing pendingAuthenticationToken", async () => {
      const res = await post(app, "/api/auth/org-selection", {
        organizationId: "org_123",
      });
      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toMatch(/pendingAuthenticationToken/i);
    });

    it("rejects missing organizationId", async () => {
      const res = await post(app, "/api/auth/org-selection", {
        pendingAuthenticationToken: "tok_123",
      });
      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toMatch(/organizationId/i);
    });
  });

  describe("POST /api/auth/check-email", () => {
    it("rejects missing email", async () => {
      const res = await post(app, "/api/auth/check-email", {});
      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toMatch(/email/i);
    });
  });

  describe("GET /api/auth/session", () => {
    it("returns 401 with no session cookie", async () => {
      const res = await app.request("/api/auth/session");
      expect(res.status).toBe(401);
      const body = await json(res);
      expect(body.authenticated).toBe(false);
      expect(body.reason).toBe("no_session_cookie");
    });

    it("returns 401 with invalid session cookie", async () => {
      const res = await app.request("/api/auth/session", {
        headers: { Cookie: "wos-session=garbage" },
      });
      expect(res.status).toBe(401);
      const body = await json(res);
      expect(body.authenticated).toBe(false);
    });
  });

  describe("GET /api/auth/callback", () => {
    it("redirects to frontend with error when no code provided", async () => {
      const res = await app.request("/api/auth/callback");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toContain("error=");
    });

    it("includes error_description in redirect when provided", async () => {
      const res = await app.request(
        "/api/auth/callback?error=access_denied&error_description=User+cancelled",
      );
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toContain("User%20cancelled");
    });
  });

  describe("GET /api/auth/sso", () => {
    it("redirects with error when no connection_id provided", async () => {
      const res = await app.request("/api/auth/sso");
      expect(res.status).toBe(302);
      const location = res.headers.get("location")!;
      expect(location).toContain("error=");
      expect(location).toContain("Missing%20connection%20ID");
    });
  });

  describe("POST /api/auth/logout", () => {
    it("returns logged_out with valid CSRF token and no session", async () => {
      const csrfRes = await app.request("/api/auth/csrf-token");
      const { csrfToken } = await json(csrfRes);
      const cookies = extractCookies(csrfRes);

      const res = await app.request("/api/auth/logout", {
        method: "POST",
        headers: {
          Cookie: cookies,
          "x-csrf-token": csrfToken as string,
        },
      });

      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.status).toBe("logged_out");
    });

    it("rejects without CSRF token", async () => {
      const res = await app.request("/api/auth/logout", { method: "POST" });
      expect(res.status).toBe(403);
    });
  });

  // -----------------------------------------------------------------------
  // Happy-path tests (mocked WorkOS SDK)
  // -----------------------------------------------------------------------

  describe("POST /api/auth/password — success", () => {
    it("returns authenticated with session cookie on valid credentials", async () => {
      mockAuthenticateWithPassword.mockResolvedValueOnce({
        user: FAKE_USER,
        sealedSession: FAKE_SEALED_SESSION,
        organizationId: "org_01XYZ",
      });

      const res = await post(app, "/api/auth/password", {
        email: "test@example.com",
        password: "correct-password",
      });

      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.status).toBe("authenticated");
      expect(body.user.id).toBe("user_01ABC");
      expect(body.organizationId).toBe("org_01XYZ");

      const setCookies = res.headers.getSetCookie?.() ?? [];
      expect(setCookies.some((c: string) => c.startsWith("wos-session="))).toBe(
        true,
      );
    });
  });

  describe("POST /api/auth/password — org selection required", () => {
    it("returns 403 with org list when user has multiple orgs", async () => {
      const orgErr = new Error("Organization selection required");
      Object.assign(orgErr, {
        rawData: {
          code: "organization_selection_required",
          pending_authentication_token: "pat_123",
          organizations: [
            { id: "org_A", name: "Acme" },
            { id: "org_B", name: "Globex" },
          ],
        },
      });
      mockAuthenticateWithPassword.mockRejectedValueOnce(orgErr);

      const res = await post(app, "/api/auth/password", {
        email: "multi@example.com",
        password: "secret",
      });

      expect(res.status).toBe(403);
      const body = await json(res);
      expect(body.status).toBe("org_selection_required");
      expect(body.pendingAuthenticationToken).toBe("pat_123");
      expect(body.organizations).toHaveLength(2);
    });
  });

  describe("POST /api/auth/password — SSO required", () => {
    it("returns 403 with sso_required when domain enforces SSO", async () => {
      const ssoErr = new Error("SSO required");
      Object.assign(ssoErr, {
        rawData: {
          error: "sso_required",
          connection_ids: ["conn_abc"],
          email: "user@sso-domain.com",
        },
      });
      mockAuthenticateWithPassword.mockRejectedValueOnce(ssoErr);

      const res = await post(app, "/api/auth/password", {
        email: "user@sso-domain.com",
        password: "secret",
      });

      expect(res.status).toBe(403);
      const body = await json(res);
      expect(body.status).toBe("sso_required");
      expect(body.connectionIds).toEqual(["conn_abc"]);
    });
  });

  describe("POST /api/auth/magic-auth/send — success", () => {
    it("returns sent status", async () => {
      mockCreateMagicAuth.mockResolvedValueOnce({ id: "magic_123" });

      const res = await post(app, "/api/auth/magic-auth/send", {
        email: "test@example.com",
      });

      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.status).toBe("sent");
      expect(mockCreateMagicAuth).toHaveBeenCalledWith({
        email: "test@example.com",
      });
    });
  });

  describe("POST /api/auth/magic-auth/verify — success", () => {
    it("returns authenticated with session cookie", async () => {
      mockAuthenticateWithMagicAuth.mockResolvedValueOnce({
        user: FAKE_USER,
        sealedSession: FAKE_SEALED_SESSION,
        organizationId: null,
      });

      const res = await post(app, "/api/auth/magic-auth/verify", {
        email: "test@example.com",
        code: "123456",
      });

      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.status).toBe("authenticated");
      expect(body.user.email).toBe("test@example.com");
    });
  });

  describe("POST /api/auth/org-selection — success", () => {
    it("completes authentication with chosen org", async () => {
      mockAuthenticateWithOrganizationSelection.mockResolvedValueOnce({
        user: FAKE_USER,
        sealedSession: FAKE_SEALED_SESSION,
        organizationId: "org_chosen",
      });

      const res = await post(app, "/api/auth/org-selection", {
        pendingAuthenticationToken: "pat_123",
        organizationId: "org_chosen",
      });

      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.status).toBe("authenticated");
      expect(body.organizationId).toBe("org_chosen");
    });
  });

  describe("POST /api/auth/check-email — SSO domain", () => {
    it("returns ssoUrl for domain with active SSO connection", async () => {
      mockListConnections.mockResolvedValueOnce({
        data: [
          {
            id: "conn_abc",
            state: "active",
            connectionType: "OktaSAML",
            organizationId: "org_X",
          },
        ],
      });

      const res = await post(app, "/api/auth/check-email", {
        email: "user@sso-corp.com",
      });

      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.method).toBe("sso");
      expect(body.ssoUrl).toBe("/api/auth/sso?connection_id=conn_abc");
      expect(body).not.toHaveProperty("connectionId");
      expect(body).not.toHaveProperty("organizationId");
    });

    it("returns credentials for domain with no SSO connections", async () => {
      mockListConnections.mockResolvedValueOnce({ data: [] });

      const res = await post(app, "/api/auth/check-email", {
        email: "user@no-sso.com",
      });

      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.method).toBe("credentials");
    });

    it("returns credentials for domain with only inactive connections", async () => {
      mockListConnections.mockResolvedValueOnce({
        data: [
          {
            id: "conn_old",
            state: "inactive",
            connectionType: "OktaSAML",
            organizationId: "org_Y",
          },
        ],
      });

      const res = await post(app, "/api/auth/check-email", {
        email: "user@old-sso.com",
      });

      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.method).toBe("credentials");
    });

    it("falls back to credentials if listConnections throws", async () => {
      mockListConnections.mockRejectedValueOnce(new Error("API down"));

      const res = await post(app, "/api/auth/check-email", {
        email: "user@error-domain.com",
      });

      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.method).toBe("credentials");
    });
  });

  describe("GET /api/auth/session — with valid sealed session", () => {
    it("returns user data when session authenticates", async () => {
      const mockSession = {
        authenticate: vi.fn().mockResolvedValue({
          authenticated: true,
          user: FAKE_USER,
          organizationId: "org_01XYZ",
          role: "admin",
          permissions: ["read", "write"],
        }),
      };
      mockLoadSealedSession.mockReturnValueOnce(mockSession);

      const res = await app.request("/api/auth/session", {
        headers: { Cookie: "wos-session=valid_sealed_data" },
      });

      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.authenticated).toBe(true);
      expect(body.user.id).toBe("user_01ABC");
      expect(body.organizationId).toBe("org_01XYZ");
      expect(body.role).toBe("admin");
    });

    it("refreshes expired session and returns user data", async () => {
      const mockSession = {
        authenticate: vi.fn().mockResolvedValue({
          authenticated: false,
          reason: "session_expired",
        }),
        refresh: vi.fn().mockResolvedValue({
          authenticated: true,
          sealedSession: "refreshed_sealed",
          user: FAKE_USER,
          organizationId: "org_01XYZ",
          role: "member",
          permissions: ["read"],
        }),
      };
      mockLoadSealedSession.mockReturnValueOnce(mockSession);

      const res = await app.request("/api/auth/session", {
        headers: { Cookie: "wos-session=expired_sealed_data" },
      });

      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.authenticated).toBe(true);
      expect(body.user.email).toBe("test@example.com");

      const setCookies = res.headers.getSetCookie?.() ?? [];
      expect(
        setCookies.some((c: string) => c.includes("refreshed_sealed")),
      ).toBe(true);
    });
  });

  describe("GET /api/auth/callback — success", () => {
    it("sets session cookie and redirects to frontend on valid code", async () => {
      mockAuthenticateWithCode.mockResolvedValueOnce({
        user: FAKE_USER,
        sealedSession: FAKE_SEALED_SESSION,
      });

      const res = await app.request(
        "/api/auth/callback?code=auth_code_123",
      );

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("http://localhost:5176");
      const setCookies = res.headers.getSetCookie?.() ?? [];
      expect(
        setCookies.some((c: string) => c.startsWith("wos-session=")),
      ).toBe(true);
    });
  });
});
