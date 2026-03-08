# third-eye-print-co

Third Eye Print Co site with:
- Stripe Checkout deposit flow
- GunJS relay as the lead database
- Gun/SEA admin auth with pub-key allowlisting + local admin graph (`/auth/`, `/admin/`)
- Vercel serverless functions for public config + Stripe checkout

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create your local env file:

```bash
cp .env.example .env
```

3. Set required values in `.env`:
- `STRIPE_SECRET_KEY` (your Stripe secret key)
- `SITE_URL` (for local dev: `http://localhost:8787`, production example: `https://third-eye.3dvr.tech`)
- `GUN_RELAY_URLS` (comma-separated relay peers, recommended)
- `GUN_RELAY_URL` (single relay fallback, optional)
- `ADMIN_PUBS` (comma-separated Gun public keys allowed into `/admin/`, optional if you manage admins in Gun)
- `QUOTE_EMAIL_TO` (public quote mailto target)

4. Run the Vercel dev server:

```bash
vercel dev --listen 127.0.0.1:8787
```

5. Open:

```text
http://localhost:8787
```

## Visual smoke checks

Run the local screenshot smoke test:

```bash
npm run test:visual
```

This writes screenshots and a small report to `artifacts/screenshots/`.

## API routes

- `GET /config.js`: Rewritten to `/api/config` and exposes safe public runtime config (`gunRelayUrls`, `adminPubs`, deposit amount/currency).
- `POST /api/create-checkout-session`: Creates a Stripe Checkout session for the configured deposit amount.

## Admin auth

- Gun aliases sign in via SEA on `/auth/`.
- Admin access is granted when the authenticated user `pub` appears in `ADMIN_PUBS` or their alias/pub is present in `third-eye-print-co/admins`.
- `tmsteph@3dvr` is the only 3DVR admin identity that bootstraps into Third Eye by default, and it seeds a local `third-eye-print-co/admins` record after a successful sign-in.
- Lead data is read live from `third-eye-print-co/leads` in Gun; there is no server-owned lead database in production.
