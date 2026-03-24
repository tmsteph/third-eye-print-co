const test = require("node:test");
const assert = require("node:assert/strict");

const { buildStripeLeadRecord, createStripeWebhookHandler } = require("../api/webhooks/stripe");

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

function createStripeFactory(result) {
  return function stripeFactory(secretKey) {
    result.secretKey = secretKey;

    return {
      webhooks: {
        constructEvent(rawBody, signature, webhookSecret) {
          result.rawBody = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody || "");
          result.signature = signature;
          result.webhookSecret = webhookSecret;

          if (result.error) {
            throw result.error;
          }

          return result.event;
        },
      },
    };
  };
}

test("buildStripeLeadRecord maps paid checkout events into Gun lead records", () => {
  const record = buildStripeLeadRecord({
    id: "evt_123",
    type: "checkout.session.completed",
    created: 1773176400,
    data: {
      object: {
        object: "checkout.session",
        id: "cs_live_123",
        payment_status: "paid",
        amount_total: 102500,
        currency: "usd",
        payment_intent: "pi_123",
        metadata: {
          quoteId: "quote-123",
          name: "Jane Doe",
          email: "jane@example.com",
          phone: "+16195551212",
          serviceType: "Tent and card bundles",
          checkoutOptionLabel: "1 tent + 100 cards",
          quantity: "1 tent + 100 cards",
        },
        customer_details: {
          email: "jane@example.com",
          phone: "+16195551212",
        },
      },
    },
  });

  assert.equal(record.id, "stripe-evt_123");
  assert.equal(record.source, "payment_succeeded");
  assert.equal(record.quoteId, "quote-123");
  assert.equal(record.checkoutSessionId, "cs_live_123");
  assert.equal(record.checkoutAmountCents, "102500");
  assert.equal(record.checkoutCurrency, "usd");
  assert.equal(record.paymentIntentId, "pi_123");
  assert.equal(record.email, "jane@example.com");
  assert.equal(record.phone, "+16195551212");
  assert.equal(record.contact, "jane@example.com / +16195551212");
});

test("buildStripeLeadRecord falls back to Stripe customer details when lead metadata is blank", () => {
  const record = buildStripeLeadRecord({
    id: "evt_456",
    type: "checkout.session.completed",
    created: 1773176400,
    data: {
      object: {
        object: "checkout.session",
        id: "cs_live_456",
        payment_status: "paid",
        amount_total: 2000,
        currency: "usd",
        metadata: {
          serviceType: "Business cards",
          checkoutOptionLabel: "50 cards",
        },
        customer_details: {
          name: "Stripe Buyer",
          email: "buyer@example.com",
          phone: "+16195550000",
        },
      },
    },
  });

  assert.equal(record.name, "Stripe Buyer");
  assert.equal(record.email, "buyer@example.com");
  assert.equal(record.phone, "+16195550000");
  assert.equal(record.contact, "buyer@example.com / +16195550000");
  assert.equal(record.customerPhone, "+16195550000");
});

test("stripe webhook persists paid checkout sessions", async () => {
  const stripeCalls = {
    event: {
      id: "evt_test_paid",
      type: "checkout.session.completed",
      created: 1773176400,
      data: {
        object: {
          object: "checkout.session",
          id: "cs_test_paid",
          payment_status: "paid",
          amount_total: 2900,
          currency: "usd",
          metadata: {
            quoteId: "quote-abc",
            name: "Jane Doe",
            email: "jane@example.com",
            phone: "+16195551212",
            serviceType: "Business cards",
            checkoutOptionLabel: "100 cards",
            quantity: "100 cards",
          },
          customer_details: {
            email: "jane@example.com",
          },
        },
      },
    },
  };
  const persisted = [];
  const handler = createStripeWebhookHandler({
    env: {
      STRIPE_SECRET_KEY: "sk_test_secret",
      STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
    },
    stripeFactory: createStripeFactory(stripeCalls),
    persistRecord: async (record) => {
      persisted.push(record);
      return record;
    },
  });
  const res = createMockRes();

  await handler(
    {
      method: "POST",
      headers: {
        "stripe-signature": "t=123,v1=test",
      },
      body: JSON.stringify({ id: "evt_test_paid" }),
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(stripeCalls.secretKey, "sk_test_secret");
  assert.equal(stripeCalls.signature, "t=123,v1=test");
  assert.equal(stripeCalls.webhookSecret, "whsec_test_secret");
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].quoteId, "quote-abc");
  assert.equal(persisted[0].email, "jane@example.com");
  assert.equal(persisted[0].phone, "+16195551212");
  assert.equal(persisted[0].checkoutSessionId, "cs_test_paid");
  assert.equal(res.body.recordId, "stripe-evt_test_paid");
});

test("stripe webhook ignores unrelated events", async () => {
  const stripeCalls = {
    event: {
      id: "evt_ignored",
      type: "payment_intent.created",
      data: {
        object: {
          object: "payment_intent",
        },
      },
    },
  };
  let persisted = false;
  const handler = createStripeWebhookHandler({
    env: {
      STRIPE_SECRET_KEY: "sk_test_secret",
      STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
    },
    stripeFactory: createStripeFactory(stripeCalls),
    persistRecord: async () => {
      persisted = true;
    },
  });
  const res = createMockRes();

  await handler(
    {
      method: "POST",
      headers: {
        "stripe-signature": "t=123,v1=test",
      },
      body: "{}",
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ignored, true);
  assert.equal(persisted, false);
});

test("stripe webhook rejects invalid signatures", async () => {
  const signatureError = new Error("No signatures found matching the expected signature for payload.");
  signatureError.type = "StripeSignatureVerificationError";

  const handler = createStripeWebhookHandler({
    env: {
      STRIPE_SECRET_KEY: "sk_test_secret",
      STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
    },
    stripeFactory: createStripeFactory({ error: signatureError }),
    persistRecord: async () => {
      throw new Error("should not persist");
    },
  });
  const res = createMockRes();

  await handler(
    {
      method: "POST",
      headers: {
        "stripe-signature": "t=123,v1=bad",
      },
      body: "{}",
    },
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "Stripe signature verification failed.");
});
