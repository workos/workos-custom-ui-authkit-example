# WorkOS Custom Auth Example

A complete example of building a custom authentication UI with [WorkOS](https://workos.com) — React frontend + Node.js/Express backend.

This example does **not** use Hosted AuthKit. Instead, it implements a fully custom login flow using the WorkOS Node SDK (`@workos-inc/node` v8+) directly.

## What's included

- **Email-first login flow** — enter email, check for SSO, then show password/magic code
- **Password authentication** — `authenticateWithPassword`
- **Magic link authentication** — `createMagicAuth` + `authenticateWithMagicAuth`
- **Google OAuth** — social login via `getAuthorizationUrl({ provider: 'GoogleOAuth' })`
- **Enterprise SSO** — domain-based detection via `listConnections({ domain })`, redirect to IdP
- **Multi-org handling** — catches `organization_selection_required`, shows org picker, completes with `authenticateWithOrganizationSelection`
- **Sealed sessions** — `loadSealedSession`, `authenticate`, `refresh`, `getLogOutUrl`
- **CSRF protection** — `csrf-csrf` on logout and org switching
- **Session refresh** — transparent token refresh via `withAuth` middleware

## Prerequisites

- Node.js 18+
- A [WorkOS account](https://dashboard.workos.com) with:
  - An API key and Client ID
  - A redirect URI configured: `http://localhost:5176/api/auth/callback`
  - (Optional) Google OAuth enabled under Social Login
  - (Optional) An SSO connection configured for a domain

## Setup

```bash
npm install
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
# Terminal 1 — backend
npm run dev:server

# Terminal 2 — frontend
npm run dev:client
```

Or run both at once:

```bash
npm run dev
```

Open [http://localhost:5176](http://localhost:5176).

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
- `session.getLogOutUrl()` — get the WorkOS logout URL

The `withAuth` middleware handles the full lifecycle: authenticate → check reason → refresh if expired → update cookie.

### Error handling

The app handles these WorkOS authentication errors:

- `organization_selection_required` — user belongs to multiple orgs, show picker
- `sso_required` — domain requires SSO, redirect to IdP (fallback if domain check missed it)

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
├── server.js          # Express backend — all auth endpoints
├── server.test.js     # Backend tests (vitest + supertest)
├── src/
│   ├── App.tsx        # React frontend — login, org picker, dashboard
│   ├── api.ts         # Fetch wrapper with CSRF handling
│   ├── types.ts       # Shared TypeScript interfaces
│   ├── app.css        # Page layout + Radix theme overrides
│   └── main.tsx       # React entry point (Radix Theme provider)
├── vitest.config.ts   # Test configuration
├── index.html         # Vite HTML shell
├── vite.config.ts     # Vite config with proxy to backend
├── .env.example       # Environment variable template
└── package.json
```

## Relevant docs

- [AuthKit with Vanilla Node.js](https://workos.com/docs/authkit/vanilla/nodejs)
- [Authentication API Reference](https://workos.com/docs/reference/authkit/authentication)
- [Authentication Errors](https://workos.com/docs/reference/authkit/authentication-errors)
- [Session Helpers](https://workos.com/docs/reference/authkit/session-helpers)
- [SSO Sign-In UX Guide](https://workos.com/docs/sso/sign-in-ux)
- [List Connections API](https://workos.com/docs/reference/sso/connection/list)
