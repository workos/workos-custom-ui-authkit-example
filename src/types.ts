export interface User {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  profilePictureUrl: string | null;
}

export interface OrgChoice {
  id: string;
  name: string;
}

export interface AuthResponse {
  status: "authenticated";
  user: User;
  organizationId?: string;
}

export interface OrgRequiredResponse {
  status: "org_selection_required";
  pendingAuthenticationToken: string;
  organizations: OrgChoice[];
}

export interface SsoRequiredResponse {
  status: "sso_required";
  connectionIds: string[];
  email?: string;
}

export interface CheckEmailResponse {
  method: "sso" | "credentials";
  ssoUrl?: string;
}

export interface SessionResponse {
  authenticated: boolean;
  user?: User;
  organizationId?: string;
  reason?: string;
}

export interface ErrorResponse {
  status: "error";
  error: string;
}

export type View =
  | "loading"
  | "login"
  | "magic-code"
  | "org-picker"
  | "dashboard";

export type LoginStep = "email" | "credentials";

export interface LogEntry {
  ts: string;
  method: string;
  url: string;
  status: number;
  body: unknown;
}

export function isOrgRequired(d: unknown): d is OrgRequiredResponse {
  return (d as OrgRequiredResponse)?.status === "org_selection_required";
}

export function isSsoRequired(d: unknown): d is SsoRequiredResponse {
  return (d as SsoRequiredResponse)?.status === "sso_required";
}
