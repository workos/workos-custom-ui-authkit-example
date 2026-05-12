# WorkOS Custom Auth Example

A complete example of building a custom authentication UI with [WorkOS](https://workos.com) — React frontend + Hono backend, fully typed with strict TypeScript.

This example does **not** use Hosted AuthKit. Instead, it implements a fully custom login flow using the WorkOS Node SDK (`@workos-inc/node` v8+) directly.

## What's included

- **Email-first login flow** — enter email, check for SSO, then show password/magic code
- **Password authentication** — `authenticateWithPassword`
- **Magic link authentication** — `createMagicAuth` + `authenticateWithMagicAuth`
- **Google OAuth** — social login via `getAuthorizationUrl({ provider: 'GoogleOAuth' })`
- **Enterprise SSO** — domain-based detection via `listConnections({ domain })`, redirect to IdP
- **Multi-org handling** — catches `organization_selection_required`, shows org picker, completes with `authenticateWithOrganizationSelection`
- **Sealed sessions** — `loadSealedSession`, `authenticate`, `refresh`, `getLogoutUrl`
- **CSRF protection** — double-submit cookie pattern on logout and org switching
- **Session refresh** — transparent token refresh via `withAuth` middleware
- **User impersonation** — dashboard-initiated impersonation works against this custom UI without exposing the hosted AuthKit page; the impersonator's email and reason surface in a banner on the dashboard view

## Prerequisites

- Node.js 22+
- [pnpm](https://pnpm.io/)
- A [WorkOS account](https://dashboard.workos.com) with:
  - An API key and Client ID
  - A redirect URI configured: `http://localhost:5176/api/auth/callback`
  - (Optional, required for impersonation) A Sign-in endpoint configured: `http://localhost:5176/api/auth/initiate`
  - (Optional, required for impersonation) Impersonation enabled under Authentication → Features → User Impersonation
  - (Optional) Google OAuth enabled under Social Login
  - (Optional) An SSO connection configured for a domain

## Setup

```bash
pnpm install
cp .env.example .env
```

Fill in your `.env`:

```
WORKOS_API_KEY=sk_test_...
WORKOS_CLIENT_ID=client_...
WORKOS_COOKIE_PASSWORD=<32+ character secret>
```

Generate a cookie password:

```bash
openssl rand -base64 32
```

## Run

Start both the backend (port 3001) and frontend (port 5176):

```bash
pnpm dev
```

Or run them separately:

```bash
# Terminal 1 — backend
pnpm dev:server

# Terminal 2 — frontend
pnpm dev:client
```

Open [http://localhost:5176](http://localhost:5176).

## Scripts

| Script            | Description                                 |
| ----------------- | ------------------------------------------- |
| `pnpm dev`        | Start backend + frontend concurrently       |
| `pnpm dev:server` | Start Hono backend with tsx watch           |
| `pnpm dev:client` | Start Vite dev server                       |
| `pnpm build`      | Production build (frontend)                 |
| `pnpm check`      | Run typecheck + lint + format check + tests |
| `pnpm typecheck`  | Type-check frontend and server              |
| `pnpm test`       | Run tests                                   |
| `pnpm lint`       | Lint with oxlint                            |
| `pnpm format`     | Format with oxfmt                           |

## How it works

### Login flow

1. User enters their email and clicks **Continue**
2. Backend checks the email domain against WorkOS SSO connections (`POST /api/auth/check-email`)
3. If an active SSO connection exists → redirect to the identity provider
4. Otherwise → reveal password field and magic code option
5. On successful auth, a sealed session cookie is set

### Session management

The backend uses WorkOS [session helpers](https://workos.com/docs/reference/authkit/session-helpers):

- `loadSealedSession` — decrypt the session cookie
- `session.authenticate()` — validate the access token
- `session.refresh()` — get a new access token using the refresh token
- `session.getLogoutUrl()` — get the WorkOS logout URL

The `withAuth` middleware handles the full lifecycle: authenticate → check reason → refresh if expired → update cookie.

### Error handling

The app handles these WorkOS authentication errors:

- `organization_selection_required` — user belongs to multiple orgs, show picker
- `sso_required` — domain requires SSO, redirect to IdP (fallback if domain check missed it)

### Impersonation

Dashboard-initiated user impersonation works against this custom UI without ever showing a hosted AuthKit page to your users. The key is the **Sign-in endpoint** configured on your application — set it to the server-only route `/api/auth/initiate`. This route is never linked from the custom UI, so organic traffic doesn't reach it; the only thing that hits it is the WorkOS dashboard's impersonation 302.

The flow when an admin clicks **Impersonate user** in the WorkOS dashboard:

1. WorkOS mints an `impersonation_token`, stores it in a cookie on `api.workos.com`, and 302s the browser to your Sign-in endpoint (`/api/auth/initiate`)
2. The endpoint immediately redirects to `https://api.workos.com/user_management/authorize?...&provider=authkit`
3. WorkOS reads the cookie, redeems the token, mints an authorization code, and 302s the browser to your redirect URI (`/api/auth/callback?code=…`)
4. The callback handler exchanges the code via `authenticateWithCode`. The response includes an `impersonator` object (`{ email, reason }`) which is propagated through the sealed session and surfaced on `GET /api/auth/session`
5. The frontend's dashboard view renders an orange "Impersonating X" banner with the impersonator's email, the reason, and a "Stop impersonating" button (logs out)

The resulting access token is a normal WorkOS-signed JWT with an `act` claim — downstream services that validate via JWKS need no special handling.

**Required dashboard configuration for impersonation:**

| Setting            | Value                                                    |
| ------------------ | -------------------------------------------------------- |
| Redirect URI       | `http://localhost:5176/api/auth/callback`                |
| Sign-in endpoint   | `http://localhost:5176/api/auth/initiate`                |
| User Impersonation | Enabled (Authentication → Features → User Impersonation) |

Without the Sign-in endpoint set, the dashboard takes a different code path that lands `?code=` directly on the redirect URI — that works for impersonation in isolation but is not the pattern most production apps end up wanting, since it can collide with PKCE-based browser SDK flows.

## UI

The frontend is built with [Radix Themes](https://www.radix-ui.com/themes) — a set of accessible, themeable components that handle dark mode, spacing, typography, and interactive states out of the box. The app uses `appearance="dark"` with the `iris` accent color, configured in `main.tsx`:

```tsx
<Theme appearance="dark" accentColor="iris" radius="medium" scaling="100%">
  <App />
</Theme>
```

Components like `Card`, `Button`, `TextField`, `Callout`, `Badge`, `Spinner`, and `Separator` come directly from `@radix-ui/themes`. A small `app.css` file handles page layout and a few custom elements (Google OAuth button, org picker cards) using Radix CSS variables for theme consistency.

## Project structure

```
├── server.ts              # Hono backend — all auth endpoints
├── server.test.ts         # Backend tests (vitest + Hono app.request())
├── src/
│   ├── App.tsx            # React frontend — login, org picker, dashboard
│   ├── api.ts             # Fetch wrapper with CSRF handling
│   ├── types.ts           # Shared TypeScript interfaces
│   ├── hooks/useAuth.ts   # Auth state management hook
│   ├── components/        # Shared UI components
│   ├── views/             # View components (Login, MagicCode, OrgPicker, Dashboard)
│   ├── vite-env.d.ts      # Vite client type declarations
│   ├── app.css            # Page layout + Radix theme overrides
│   └── main.tsx           # React entry point (Radix Theme provider)
├── tsconfig.json          # Solution root (references app + server)
├── tsconfig.base.json     # Shared TypeScript options
├── tsconfig.app.json      # Frontend config (DOM, JSX)
├── tsconfig.server.json   # Backend config (Node types, no DOM)
├── vite.config.ts         # Vite + Vitest config with proxy to backend
├── index.html             # Vite HTML shell
├── .env.example           # Environment variable template
└── package.json
```

## Relevant docs

- [AuthKit with Vanilla Node.js](https://workos.com/docs/authkit/vanilla/nodejs)
- [Authentication API Reference](https://workos.com/docs/reference/authkit/authentication)
- [Authentication Errors](https://workos.com/docs/reference/authkit/authentication-errors)
- [Session Helpers](https://workos.com/docs/reference/authkit/session-helpers)
- [SSO Sign-In UX Guide](https://workos.com/docs/sso/sign-in-ux)
- [List Connections API](https://workos.com/docs/reference/sso/connection/list)
