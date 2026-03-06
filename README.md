# third-eye-print-co

Third Eye Print Co site with:
- Stripe Checkout deposit flow
- API lead capture (`/api/lead`)
- Optional GunJS relay sync for quote data

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

4. Run the site:

```bash
npm start
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

- `POST /api/lead`: Saves quote lead to `LEAD_FILE` (`./data/leads.jsonl` by default).
- `POST /api/create-checkout-session`: Creates a Stripe Checkout session for the configured deposit amount.
- `GET /config.js`: Exposes safe public runtime config to the frontend (`gunRelayUrls`, deposit amount/currency).
