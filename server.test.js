// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// Set env before importing server (it validates on load)
process.env.NODE_ENV = "test";
process.env.WORKOS_API_KEY = "sk_test_fake";
process.env.WORKOS_CLIENT_ID = "client_fake";
process.env.WORKOS_COOKIE_PASSWORD = "a]Ek+5S;2/gm,Ry3(cKsia^Gzxpj|O>b";

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
    constructor() {
      this.userManagement = {
        authenticateWithPassword: mockAuthenticateWithPassword,
        createMagicAuth: mockCreateMagicAuth,
        authenticateWithMagicAuth: mockAuthenticateWithMagicAuth,
        authenticateWithCode: mockAuthenticateWithCode,
        authenticateWithOrganizationSelection: mockAuthenticateWithOrganizationSelection,
        getAuthorizationUrl: mockGetAuthorizationUrl,
        loadSealedSession: mockLoadSealedSession,
      };
      this.sso = {
        listConnections: mockListConnections,
      };
    }
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

// --------------------------------------------------------------------------
// Unit tests for exported helper functions
// --------------------------------------------------------------------------

describe("isOrgSelectionRequired", () => {
  let isOrgSelectionRequired;

  beforeAll(async () => {
    const mod = await import("./server.js");
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
  let isSsoRequired;

  beforeAll(async () => {
    const mod = await import("./server.js");
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

describe("requireBody", () => {
  let requireBody;

  beforeAll(async () => {
    const mod = await import("./server.js");
    requireBody = mod.requireBody;
  });

  it("returns true when all required fields are present", () => {
    const req = { body: { email: "a@b.com", password: "secret" } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    expect(requireBody(req, res, ["email", "password"])).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns false and sends 400 when a field is missing", () => {
    const req = { body: { email: "a@b.com" } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    expect(requireBody(req, res, ["email", "password"])).toBe(false);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      status: "error",
      error: "Missing required field: password",
    });
  });

  it("returns false when body is undefined", () => {
    const req = {};
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    expect(requireBody(req, res, ["email"])).toBe(false);
  });

  it("returns false when field is empty string", () => {
    const req = { body: { email: "" } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    expect(requireBody(req, res, ["email"])).toBe(false);
  });
});

// --------------------------------------------------------------------------
// Integration tests via supertest
// --------------------------------------------------------------------------

describe("API routes", () => {
  let request;
  let app;

  beforeAll(async () => {
    const supertest = await import("supertest");
    request = supertest.default;
    const mod = await import("./server.js");
    app = mod.app;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/auth/csrf-token", () => {
    it("returns a csrfToken string", async () => {
      const res = await request(app).get("/api/auth/csrf-token");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("csrfToken");
      expect(typeof res.body.csrfToken).toBe("string");
      expect(res.body.csrfToken.length).toBeGreaterThan(0);
    });
  });

  describe("POST /api/auth/password", () => {
    it("rejects missing email", async () => {
      const res = await request(app)
        .post("/api/auth/password")
        .send({ password: "secret" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/email/i);
    });

    it("rejects missing password", async () => {
      const res = await request(app)
        .post("/api/auth/password")
        .send({ email: "a@b.com" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/password/i);
    });
  });

  describe("POST /api/auth/magic-auth/send", () => {
    it("rejects missing email", async () => {
      const res = await request(app)
        .post("/api/auth/magic-auth/send")
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/email/i);
    });
  });

  describe("POST /api/auth/magic-auth/verify", () => {
    it("rejects missing code", async () => {
      const res = await request(app)
        .post("/api/auth/magic-auth/verify")
        .send({ email: "a@b.com" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/code/i);
    });
  });

  describe("POST /api/auth/org-selection", () => {
    it("rejects missing pendingAuthenticationToken", async () => {
      const res = await request(app)
        .post("/api/auth/org-selection")
        .send({ organizationId: "org_123" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/pendingAuthenticationToken/i);
    });

    it("rejects missing organizationId", async () => {
      const res = await request(app)
        .post("/api/auth/org-selection")
        .send({ pendingAuthenticationToken: "tok_123" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/organizationId/i);
    });
  });

  describe("POST /api/auth/check-email", () => {
    it("rejects missing email", async () => {
      const res = await request(app)
        .post("/api/auth/check-email")
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/email/i);
    });
  });

  describe("GET /api/auth/session", () => {
    it("returns 401 with no session cookie", async () => {
      const res = await request(app).get("/api/auth/session");
      expect(res.status).toBe(401);
      expect(res.body.authenticated).toBe(false);
      expect(res.body.reason).toBe("no_session_cookie");
    });

    it("returns 401 with invalid session cookie", async () => {
      const res = await request(app)
        .get("/api/auth/session")
        .set("Cookie", "wos-session=garbage");
      expect(res.status).toBe(401);
      expect(res.body.authenticated).toBe(false);
    });
  });

  describe("GET /api/auth/callback", () => {
    it("redirects to frontend with error when no code provided", async () => {
      const res = await request(app).get("/api/auth/callback");
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain("error=");
    });

    it("includes error_description in redirect when provided", async () => {
      const res = await request(app).get(
        "/api/auth/callback?error=access_denied&error_description=User+cancelled",
      );
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain("User%20cancelled");
    });
  });

  describe("GET /api/auth/sso", () => {
    it("redirects with error when no connection_id provided", async () => {
      const res = await request(app).get("/api/auth/sso");
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain("error=");
      expect(res.headers.location).toContain("Missing%20connection%20ID");
    });
  });

  describe("POST /api/auth/logout", () => {
    it("returns logged_out with valid CSRF token and no session", async () => {
      const csrfRes = await request(app).get("/api/auth/csrf-token");
      const { csrfToken } = csrfRes.body;
      const cookies = csrfRes.headers["set-cookie"];

      const res = await request(app)
        .post("/api/auth/logout")
        .set("Cookie", cookies)
        .set("x-csrf-token", csrfToken);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("logged_out");
    });

    it("rejects without CSRF token", async () => {
      const res = await request(app).post("/api/auth/logout");
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

      const res = await request(app)
        .post("/api/auth/password")
        .send({ email: "test@example.com", password: "correct-password" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("authenticated");
      expect(res.body.user.id).toBe("user_01ABC");
      expect(res.body.organizationId).toBe("org_01XYZ");

      const setCookie = res.headers["set-cookie"];
      expect(setCookie).toBeDefined();
      expect(setCookie.some((c) => c.startsWith("wos-session="))).toBe(true);
    });
  });

  describe("POST /api/auth/password — org selection required", () => {
    it("returns 403 with org list when user has multiple orgs", async () => {
      const orgErr = new Error("Organization selection required");
      orgErr.rawData = {
        code: "organization_selection_required",
        pending_authentication_token: "pat_123",
        organizations: [
          { id: "org_A", name: "Acme" },
          { id: "org_B", name: "Globex" },
        ],
      };
      mockAuthenticateWithPassword.mockRejectedValueOnce(orgErr);

      const res = await request(app)
        .post("/api/auth/password")
        .send({ email: "multi@example.com", password: "secret" });

      expect(res.status).toBe(403);
      expect(res.body.status).toBe("org_selection_required");
      expect(res.body.pendingAuthenticationToken).toBe("pat_123");
      expect(res.body.organizations).toHaveLength(2);
    });
  });

  describe("POST /api/auth/password — SSO required", () => {
    it("returns 403 with sso_required when domain enforces SSO", async () => {
      const ssoErr = new Error("SSO required");
      ssoErr.rawData = {
        error: "sso_required",
        connection_ids: ["conn_abc"],
        email: "user@sso-domain.com",
      };
      mockAuthenticateWithPassword.mockRejectedValueOnce(ssoErr);

      const res = await request(app)
        .post("/api/auth/password")
        .send({ email: "user@sso-domain.com", password: "secret" });

      expect(res.status).toBe(403);
      expect(res.body.status).toBe("sso_required");
      expect(res.body.connectionIds).toEqual(["conn_abc"]);
    });
  });

  describe("POST /api/auth/magic-auth/send — success", () => {
    it("returns sent status", async () => {
      mockCreateMagicAuth.mockResolvedValueOnce({ id: "magic_123" });

      const res = await request(app)
        .post("/api/auth/magic-auth/send")
        .send({ email: "test@example.com" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("sent");
      expect(mockCreateMagicAuth).toHaveBeenCalledWith({ email: "test@example.com" });
    });
  });

  describe("POST /api/auth/magic-auth/verify — success", () => {
    it("returns authenticated with session cookie", async () => {
      mockAuthenticateWithMagicAuth.mockResolvedValueOnce({
        user: FAKE_USER,
        sealedSession: FAKE_SEALED_SESSION,
        organizationId: null,
      });

      const res = await request(app)
        .post("/api/auth/magic-auth/verify")
        .send({ email: "test@example.com", code: "123456" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("authenticated");
      expect(res.body.user.email).toBe("test@example.com");
    });
  });

  describe("POST /api/auth/org-selection — success", () => {
    it("completes authentication with chosen org", async () => {
      mockAuthenticateWithOrganizationSelection.mockResolvedValueOnce({
        user: FAKE_USER,
        sealedSession: FAKE_SEALED_SESSION,
        organizationId: "org_chosen",
      });

      const res = await request(app)
        .post("/api/auth/org-selection")
        .send({ pendingAuthenticationToken: "pat_123", organizationId: "org_chosen" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("authenticated");
      expect(res.body.organizationId).toBe("org_chosen");
    });
  });

  describe("POST /api/auth/check-email — SSO domain", () => {
    it("returns ssoUrl for domain with active SSO connection", async () => {
      mockListConnections.mockResolvedValueOnce({
        data: [
          { id: "conn_abc", state: "active", connectionType: "OktaSAML", organizationId: "org_X" },
        ],
      });

      const res = await request(app)
        .post("/api/auth/check-email")
        .send({ email: "user@sso-corp.com" });

      expect(res.status).toBe(200);
      expect(res.body.method).toBe("sso");
      expect(res.body.ssoUrl).toBe("/api/auth/sso?connection_id=conn_abc");
      expect(res.body).not.toHaveProperty("connectionId");
      expect(res.body).not.toHaveProperty("organizationId");
    });

    it("returns credentials for domain with no SSO connections", async () => {
      mockListConnections.mockResolvedValueOnce({ data: [] });

      const res = await request(app)
        .post("/api/auth/check-email")
        .send({ email: "user@no-sso.com" });

      expect(res.status).toBe(200);
      expect(res.body.method).toBe("credentials");
    });

    it("returns credentials for domain with only inactive connections", async () => {
      mockListConnections.mockResolvedValueOnce({
        data: [
          { id: "conn_old", state: "inactive", connectionType: "OktaSAML", organizationId: "org_Y" },
        ],
      });

      const res = await request(app)
        .post("/api/auth/check-email")
        .send({ email: "user@old-sso.com" });

      expect(res.status).toBe(200);
      expect(res.body.method).toBe("credentials");
    });

    it("falls back to credentials if listConnections throws", async () => {
      mockListConnections.mockRejectedValueOnce(new Error("API down"));

      const res = await request(app)
        .post("/api/auth/check-email")
        .send({ email: "user@error-domain.com" });

      expect(res.status).toBe(200);
      expect(res.body.method).toBe("credentials");
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

      const res = await request(app)
        .get("/api/auth/session")
        .set("Cookie", "wos-session=valid_sealed_data");

      expect(res.status).toBe(200);
      expect(res.body.authenticated).toBe(true);
      expect(res.body.user.id).toBe("user_01ABC");
      expect(res.body.organizationId).toBe("org_01XYZ");
      expect(res.body.role).toBe("admin");
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

      const res = await request(app)
        .get("/api/auth/session")
        .set("Cookie", "wos-session=expired_sealed_data");

      expect(res.status).toBe(200);
      expect(res.body.authenticated).toBe(true);
      expect(res.body.user.email).toBe("test@example.com");

      const setCookie = res.headers["set-cookie"];
      expect(setCookie.some((c) => c.includes("refreshed_sealed"))).toBe(true);
    });
  });

  describe("GET /api/auth/callback — success", () => {
    it("sets session cookie and redirects to frontend on valid code", async () => {
      mockAuthenticateWithCode.mockResolvedValueOnce({
        user: FAKE_USER,
        sealedSession: FAKE_SEALED_SESSION,
      });

      const res = await request(app).get("/api/auth/callback?code=auth_code_123");

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("http://localhost:5176");
      const setCookie = res.headers["set-cookie"];
      expect(setCookie.some((c) => c.startsWith("wos-session="))).toBe(true);
    });
  });
});
