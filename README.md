# third-eye-print-co

Third Eye Print Co site with:
- Stripe Checkout flow for business cards, tent packages, and bundle deals
- GunJS relay as the lead database
- Gun/SEA admin auth with pub-key allowlisting + local admin graph (`/auth/`, `/admin/`)
- Vercel serverless functions for public config, Stripe checkout, and Stripe webhook confirmation

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
- `STRIPE_WEBHOOK_SECRET` (the Stripe signing secret for your deployed webhook endpoint)
- `STRIPE_BUSINESS_CARDS_50_CENTS` / `STRIPE_BUSINESS_CARDS_100_CENTS` / `STRIPE_BUSINESS_CARDS_200_CENTS` / `STRIPE_BUSINESS_CARDS_500_CENTS` (optional business card tier overrides)
- `STRIPE_EVENT_TENT_1_CENTS` / `STRIPE_EVENT_TENT_3_CENTS` / `STRIPE_EVENT_TENT_5_CENTS` (optional event tent package overrides)
- `STRIPE_BUNDLE_1_TENT_100_CARDS_CENTS` / `STRIPE_BUNDLE_3_TENTS_200_CARDS_CENTS` / `STRIPE_BUNDLE_5_TENTS_500_CARDS_CENTS` (optional bundle overrides)
- `SITE_URL` (for local dev: `http://localhost:8787`, production example: `https://www.thirdeyeprintco.com`)
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

- `GET /config.js`: Rewritten to `/api/config` and exposes safe public runtime config (`gunRelayUrls`, `adminPubs`, and the live checkout tiers for cards, tents, and bundles).
- `POST /api/create-checkout-session`: Creates a Stripe Checkout session for a valid card pack, tent package, or bundle deal.
- `POST /api/webhooks/stripe`: Verifies Stripe webhook signatures and writes confirmed payment events back into `third-eye-print-co/leads` in Gun.

## Stripe webhook setup

Point Stripe to your deployed webhook endpoint:

```text
https://your-site.example/api/webhooks/stripe
```

Recommended event subscriptions:
- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`

## Admin auth

- Gun aliases sign in via SEA on `/auth/`.
- Anyone can create a portal account on `/auth/`; accounts are recorded in `third-eye-print-co/portalAccounts`.
- Admin access is granted when the authenticated user `pub` appears in `ADMIN_PUBS` or their alias/pub is present in `third-eye-print-co/admins`.
- The admin dashboard can promote portal accounts to admin and issue fresh credentials when someone loses access.
- `tmsteph@3dvr` is the only 3DVR admin identity that bootstraps into Third Eye by default, and it seeds a local `third-eye-print-co/admins` record after a successful sign-in.
- Lead data is read live from `third-eye-print-co/leads` in Gun; quote requests, checkout starts, checkout session creation events, and confirmed Stripe payments all land in the same Gun feed.
