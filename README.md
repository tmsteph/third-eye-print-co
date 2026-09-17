# third-eye-print-co

Third Eye Print Co site with:
- Stripe Checkout flow for business cards, tent packages, and bundle deals
- Order request lead capture for ice cream cart graphics and other reviewed jobs
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
- `STRIPE_BUSINESS_CARDS_50_CENTS` / `STRIPE_BUSINESS_CARDS_100_CENTS` / `STRIPE_BUSINESS_CARDS_250_CENTS` / `STRIPE_BUSINESS_CARDS_500_CENTS` (optional business card tier overrides)
- `STRIPE_EVENT_TENT_1_CENTS` / `STRIPE_EVENT_TENT_3_CENTS` / `STRIPE_EVENT_TENT_5_CENTS` (optional event tent package overrides)
- `STRIPE_BUNDLE_1_TENT_100_CARDS_CENTS` / `STRIPE_BUNDLE_3_TENTS_250_CARDS_CENTS` / `STRIPE_BUNDLE_5_TENTS_500_CARDS_CENTS` (optional bundle overrides)
- `SITE_URL` (for local dev: `http://localhost:8787`, production example: `https://www.thirdeyeprintco.com`)
- `GUN_RELAY_URLS` (comma-separated relay peers, recommended)
- `GUN_RELAY_URL` (single relay fallback, optional)
- `ADMIN_PUBS` (comma-separated Gun public keys allowed into `/admin/`, optional if you manage admins in Gun)
- `QUOTE_EMAIL_TO` (public quote mailto target)
- `GMAIL_USER` + `GMAIL_APP_PASSWORD` (server-side Gmail sender for post-payment business-card artwork)
- `BUSINESS_CARD_ORDER_EMAIL` (one or more comma-separated recipients for paid artwork; can include both Esai and the 3DVR inbox; falls back to `QUOTE_EMAIL_TO`/`GMAIL_USER`)
- `CHECKOUT_ORDER_EMAIL` (recipient list for paid-checkout notifications; falls back to `BUSINESS_CARD_ORDER_EMAIL`)

4. Run the Vercel dev server:

```bash
vercel dev --listen 127.0.0.1:8787
```

5. Open:

```text
http://localhost:8787
```


## Public app routes

- `/business-cards/`: focused quantity → optional artwork → payment flow. The upload control is only exposed when server-side Gmail delivery is configured.
- `/t-shirts/`: compact apparel request flow.
- `/custom/`: compact request flow for signs, tents, decals, menus, banners, and other jobs.
- The previous long-form storefront is retired from the public flow; Git history remains the source of truth if anything needs to be recovered.

## Visual smoke checks

Run the local screenshot smoke test:

```bash
npm run test:visual
```

This writes screenshots and a small report to `artifacts/screenshots/`.

## Fulfillment

- 4over is the current production partner, but there is no direct 4over API integration yet. Fulfillment is manual after the customer request/payment reaches Third Eye.
- The public business-card checkout intentionally uses production-friendly quantities: 50, 100, 250, and 500 cards.
- Premium stocks, special finishes, apparel, signs, tents, and unusual quantities stay on the quote path until their production specs are standardized.
- Legacy `200`-card environment variable names are still accepted as fallbacks so existing deployments do not break while moving to the 250-card tier.

## API routes

- `GET /config.js`: Rewritten to `/api/config` and exposes safe public runtime config (`gunRelayUrls`, `adminPubs`, and the live checkout tiers for cards, tents, and bundles).
- `POST /api/create-checkout-session`: Creates the Stripe Checkout session. It deliberately does not accept or email business-card artwork before payment.
- `POST /api/upload-artwork`: Accepts optional PDF/JPG/PNG artwork only after checking the Stripe session is paid and matches the business-card order ID; then emails the attachments to the configured order inbox.
- `POST /api/webhooks/stripe`: Verifies Stripe webhook signatures, writes confirmed payments into Gun, and emails the order inbox for every successful checkout.

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
