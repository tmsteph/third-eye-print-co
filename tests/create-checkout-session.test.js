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
      STRIPE_BUSINESS_CARDS_CENTS: "10000",
      STRIPE_EVENT_TENT_CENTS: "100000",
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
          serviceType: "Business cards",
        },
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(calls.secretKey, "sk_test_secret");
  assert.equal(calls.payload.line_items[0].price_data.unit_amount, 10000);
  assert.equal(calls.payload.line_items[0].price_data.product_data.name, "Third Eye Print Co. Business Cards");
  assert.equal(calls.payload.metadata.checkoutService, "businessCards");
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
      STRIPE_BUSINESS_CARDS_CENTS: "10000",
      STRIPE_EVENT_TENT_CENTS: "100000",
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
        },
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(calls.payload.line_items[0].price_data.unit_amount, 100000);
  assert.equal(calls.payload.line_items[0].price_data.product_data.name, "Third Eye Print Co. Event Tent");
  assert.equal(calls.payload.metadata.checkoutService, "eventTent");
});

test("create-checkout-session rejects unsupported services for online checkout", async () => {
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
  assert.equal(res.body.error, "Online checkout is currently available for business cards and event tents only.");
});
