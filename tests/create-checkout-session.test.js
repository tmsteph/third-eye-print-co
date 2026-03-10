const test = require("node:test");
const assert = require("node:assert/strict");

const { createCheckoutSessionHandler } = require("../api/create-checkout-session");

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null;
    },
  };
}

function createStripeFactory(calls) {
  return function stripeFactory(secretKey) {
    calls.secretKey = secretKey;

    return {
      checkout: {
        sessions: {
          async create(payload) {
            calls.payload = payload;
            return {
              id: "cs_test_123",
              url: "https://checkout.stripe.test/session",
            };
          },
        },
      },
    };
  };
}

test("create-checkout-session creates a business card checkout", async () => {
  const calls = {};
  const handler = createCheckoutSessionHandler({
    env: {
      STRIPE_SECRET_KEY: "sk_test_secret",
      SITE_URL: "https://third-eye.example",
      STRIPE_BUSINESS_CARDS_50_CENTS: "3500",
      STRIPE_BUSINESS_CARDS_100_CENTS: "5500",
      STRIPE_BUSINESS_CARDS_200_CENTS: "8000",
      STRIPE_BUSINESS_CARDS_500_CENTS: "10000",
      STRIPE_EVENT_TENT_1_CENTS: "100000",
      STRIPE_EVENT_TENT_3_CENTS: "270000",
      STRIPE_EVENT_TENT_5_CENTS: "425000",
      STRIPE_BUNDLE_1_TENT_100_CARDS_CENTS: "102500",
      STRIPE_BUNDLE_3_TENTS_200_CARDS_CENTS: "275000",
      STRIPE_BUNDLE_5_TENTS_500_CARDS_CENTS: "430000",
      STRIPE_CURRENCY: "usd",
    },
    stripeFactory: createStripeFactory(calls),
  });
  const res = createMockRes();

  await handler(
    {
      method: "POST",
      headers: {},
      body: {
        lead: {
          name: "Jane Doe",
          contact: "jane@example.com",
          quoteId: "quote-123",
          serviceType: "Business cards",
          checkoutOptionId: "cards-100",
          quantity: "100 cards",
        },
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(calls.secretKey, "sk_test_secret");
  assert.equal(calls.payload.line_items[0].price_data.unit_amount, 5500);
  assert.equal(calls.payload.line_items[0].price_data.product_data.name, "Third Eye Print Co. Business Cards - 100 cards");
  assert.equal(calls.payload.metadata.checkoutService, "businessCards");
  assert.equal(calls.payload.metadata.quoteId, "quote-123");
  assert.equal(calls.payload.metadata.checkoutOptionId, "cards-100");
  assert.equal(calls.payload.metadata.checkoutOptionLabel, "100 cards");
  assert.equal(calls.payload.success_url, "https://third-eye.example/?payment=success&session_id={CHECKOUT_SESSION_ID}");
  assert.deepEqual(res.body, {
    id: "cs_test_123",
    url: "https://checkout.stripe.test/session",
  });
});

test("create-checkout-session creates an event tent checkout", async () => {
  const calls = {};
  const handler = createCheckoutSessionHandler({
    env: {
      STRIPE_SECRET_KEY: "sk_test_secret",
      SITE_URL: "https://third-eye.example",
      STRIPE_BUSINESS_CARDS_50_CENTS: "3500",
      STRIPE_BUSINESS_CARDS_100_CENTS: "5500",
      STRIPE_BUSINESS_CARDS_200_CENTS: "8000",
      STRIPE_BUSINESS_CARDS_500_CENTS: "10000",
      STRIPE_EVENT_TENT_1_CENTS: "100000",
      STRIPE_EVENT_TENT_3_CENTS: "270000",
      STRIPE_EVENT_TENT_5_CENTS: "425000",
      STRIPE_CURRENCY: "usd",
    },
    stripeFactory: createStripeFactory(calls),
  });
  const res = createMockRes();

  await handler(
    {
      method: "POST",
      headers: {},
      body: {
        lead: {
          name: "Jane Doe",
          contact: "jane@example.com",
          serviceType: "Event tent",
          checkoutOptionId: "tent-3",
          quantity: "3 tents",
        },
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(calls.payload.line_items[0].price_data.unit_amount, 270000);
  assert.equal(calls.payload.line_items[0].price_data.product_data.name, "Third Eye Print Co. Event Tents - 3 tents");
  assert.equal(calls.payload.metadata.checkoutService, "eventTent");
});

test("create-checkout-session creates a tent and card bundle checkout", async () => {
  const calls = {};
  const handler = createCheckoutSessionHandler({
    env: {
      STRIPE_SECRET_KEY: "sk_test_secret",
      SITE_URL: "https://third-eye.example",
      STRIPE_CURRENCY: "usd",
    },
    stripeFactory: createStripeFactory(calls),
  });
  const res = createMockRes();

  await handler(
    {
      method: "POST",
      headers: {},
      body: {
        lead: {
          name: "Jane Doe",
          contact: "jane@example.com",
          serviceType: "Tent and card bundles",
          checkoutOptionId: "bundle-5-500",
          quantity: "5 tents + 500 cards",
        },
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(calls.payload.line_items[0].price_data.unit_amount, 430000);
  assert.equal(calls.payload.metadata.checkoutService, "bundleDeal");
  assert.equal(calls.payload.metadata.checkoutOptionLabel, "5 tents + 500 cards");
});

test("create-checkout-session rejects unsupported services or missing package selection", async () => {
  const handler = createCheckoutSessionHandler({
    env: {
      STRIPE_SECRET_KEY: "sk_test_secret",
    },
    stripeFactory: createStripeFactory({}),
  });
  const res = createMockRes();

  await handler(
    {
      method: "POST",
      headers: {},
      body: {
        lead: {
          name: "Jane Doe",
          contact: "jane@example.com",
          serviceType: "Embroidery",
        },
      },
    },
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "Choose a valid business card pack, tent package, or bundle deal before checkout.");
});
