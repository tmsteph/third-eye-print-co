const test = require("node:test");
const assert = require("node:assert/strict");
const { createCheckoutSessionHandler, decodeArtworkFiles } = require("../api/create-checkout-session");

function createMockRes() {
  return { statusCode: 200, headers: {}, body: null, setHeader(name, value) { this.headers[name] = value; }, end(payload) { this.body = payload ? JSON.parse(payload) : null; } };
}

function createStripeFactory(calls) {
  return function stripeFactory(secretKey) {
    calls.secretKey = secretKey;
    return { checkout: { sessions: {
      async create(payload) { calls.payload = payload; return { id: "cs_test_123", url: "https://checkout.stripe.test/session" }; },
      async expire(id) { calls.expired = id; },
    } } };
  };
}

const baseEnv = { STRIPE_SECRET_KEY: "sk_test_secret", SITE_URL: "https://third-eye.example", STRIPE_CURRENCY: "usd" };

async function invoke(handler, body) {
  const res = createMockRes();
  await handler({ method: "POST", headers: {}, body }, res);
  return res;
}

test("business card checkout works without artwork or Gmail", async () => {
  const calls = {};
  const handler = createCheckoutSessionHandler({ env: baseEnv, stripeFactory: createStripeFactory(calls) });
  const res = await invoke(handler, { lead: { name: "Jane Doe", email: "jane@example.com", serviceType: "Business cards", checkoutOptionId: "cards-100", quantity: "100 cards" } });
  assert.equal(res.statusCode, 200);
  assert.equal(calls.payload.line_items[0].price_data.unit_amount, 2900);
  assert.equal(calls.payload.metadata.checkoutService, "businessCards");
  assert.equal(calls.payload.metadata.artworkState, "later");
  assert.equal(calls.payload.phone_number_collection.enabled, false);
  assert.match(calls.payload.success_url, /\/business-cards\/\?payment=success&order=TEPC-[^&]+&artwork=later/);
  assert.equal(res.body.artworkState, "later");
});

test("business card artwork is emailed before Stripe redirect", async () => {
  const calls = {}, sent = [];
  const mailTransport = { async sendMail(payload) { sent.push(payload); return { accepted: ["orders@example.com"] }; } };
  const handler = createCheckoutSessionHandler({
    env: { ...baseEnv, GMAIL_USER: "3dvr@example.com", GMAIL_APP_PASSWORD: "app-pass", BUSINESS_CARD_ORDER_EMAIL: "esai@example.com,3dvr@example.com" },
    stripeFactory: createStripeFactory(calls), mailTransport,
  });
  const res = await invoke(handler, {
    lead: { serviceType: "Business cards", checkoutOptionId: "cards-250", quantity: "250 cards" },
    artwork: [{ name: "front.pdf", type: "application/pdf", data: Buffer.from("pdf bytes").toString("base64") }],
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.artworkState, "received");
  assert.equal(calls.payload.metadata.checkoutOptionId, "cards-250");
  assert.equal(calls.payload.metadata.artworkState, "received");
  assert.match(calls.payload.success_url, /artwork=received/);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "esai@example.com,3dvr@example.com");
  assert.equal(sent[0].attachments.length, 1);
  assert.equal(sent[0].attachments[0].content.toString(), "pdf bytes");
  assert.match(sent[0].subject, /250 cards/);
});

test("artwork upload is rejected when mail delivery is not configured", async () => {
  const calls = {};
  const handler = createCheckoutSessionHandler({ env: baseEnv, stripeFactory: createStripeFactory(calls) });
  const res = await invoke(handler, {
    lead: { serviceType: "Business cards", checkoutOptionId: "cards-50" },
    artwork: [{ name: "front.png", type: "image/png", data: Buffer.from("png").toString("base64") }],
  });
  assert.equal(res.statusCode, 503);
  assert.match(res.body.error, /temporarily unavailable/i);
  assert.equal(calls.payload, undefined);
});

test("artwork validation rejects unsupported file types", () => {
  assert.throws(() => decodeArtworkFiles([{ name: "bad.svg", type: "image/svg+xml", data: Buffer.from("x").toString("base64") }]), /PDF, JPG, or PNG/);
});

test("create-checkout-session still supports event tent checkout", async () => {
  const calls = {};
  const handler = createCheckoutSessionHandler({ env: baseEnv, stripeFactory: createStripeFactory(calls) });
  const res = await invoke(handler, { lead: { serviceType: "Event tent", checkoutOptionId: "tent-3", quantity: "3 tents" } });
  assert.equal(res.statusCode, 200);
  assert.equal(calls.payload.line_items[0].price_data.unit_amount, 270000);
  assert.equal(calls.payload.metadata.checkoutService, "eventTent");
});

test("create-checkout-session still supports bundle checkout", async () => {
  const calls = {};
  const handler = createCheckoutSessionHandler({ env: baseEnv, stripeFactory: createStripeFactory(calls) });
  const res = await invoke(handler, { lead: { serviceType: "Tent and card bundles", checkoutOptionId: "bundle-5-500" } });
  assert.equal(res.statusCode, 200);
  assert.equal(calls.payload.line_items[0].price_data.unit_amount, 430000);
  assert.equal(calls.payload.metadata.checkoutService, "bundleDeal");
});

test("create-checkout-session rejects unsupported services", async () => {
  const handler = createCheckoutSessionHandler({ env: baseEnv, stripeFactory: createStripeFactory({}) });
  const res = await invoke(handler, { lead: { serviceType: "Embroidery" } });
  assert.equal(res.statusCode, 400);
});
