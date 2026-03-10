const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_BUSINESS_CARDS_CENTS,
  DEFAULT_EVENT_TENT_CENTS,
  DEFAULT_GUN_RELAY_URLS,
  createPublicRuntimeConfig,
  createStripeCatalog,
  normalizeCheckoutServiceKey,
  parseAdminPubs,
  parseGunRelayUrls,
} = require("../lib/runtime-config");

test("parseGunRelayUrls prefers the comma-separated list", () => {
  const relayUrls = parseGunRelayUrls({
    GUN_RELAY_URLS: " wss://relay-one.example/gun , wss://relay-two.example/gun ",
    GUN_RELAY_URL: "wss://fallback.example/gun",
  });

  assert.deepEqual(relayUrls, [
    "wss://relay-one.example/gun",
    "wss://relay-two.example/gun",
  ]);
});

test("parseAdminPubs returns unique trimmed pub keys", () => {
  const adminPubs = parseAdminPubs({
    ADMIN_PUBS: " pub-1 , pub-2 , pub-1 ",
  });

  assert.deepEqual(adminPubs, ["pub-1", "pub-2"]);
});

test("parseGunRelayUrls falls back to the shared 3dvr relays", () => {
  const relayUrls = parseGunRelayUrls({});

  assert.deepEqual(relayUrls, DEFAULT_GUN_RELAY_URLS);
});

test("createPublicRuntimeConfig exposes only safe client config", () => {
  const config = createPublicRuntimeConfig({
    GUN_RELAY_URL: "wss://relay.example/gun",
    STRIPE_SECRET_KEY: "sk_test_secret",
    STRIPE_CURRENCY: "usd",
    STRIPE_BUSINESS_CARDS_CENTS: "10000",
    STRIPE_EVENT_TENT_CENTS: "100000",
    ADMIN_PUBS: "pub-a,pub-b",
    QUOTE_EMAIL_TO: "quotes@example.com",
  });

  assert.deepEqual(config, {
    gunNamespace: "third-eye-print-co",
    gunRelayUrls: ["wss://relay.example/gun"],
    gunRelayUrl: "wss://relay.example/gun",
    stripeEnabled: true,
    stripeDepositCents: 10000,
    stripeCurrency: "usd",
    stripeCatalog: {
      businessCards: {
        key: "businessCards",
        label: "Business cards",
        buttonLabel: "Checkout business cards",
        amountCents: 10000,
        currency: "usd",
        productName: "Third Eye Print Co. Business Cards",
        description: "Fast checkout for standard business card orders.",
      },
      eventTent: {
        key: "eventTent",
        label: "Event tents",
        buttonLabel: "Checkout event tent",
        amountCents: 100000,
        currency: "usd",
        productName: "Third Eye Print Co. Event Tent",
        description: "Fast checkout for branded event tent orders.",
      },
    },
    adminPubs: ["pub-a", "pub-b"],
    quoteEmailTo: "quotes@example.com",
  });
});

test("normalizeCheckoutServiceKey maps supported storefront services", () => {
  assert.equal(normalizeCheckoutServiceKey("Business cards"), "businessCards");
  assert.equal(normalizeCheckoutServiceKey("Business cards / handouts"), "businessCards");
  assert.equal(normalizeCheckoutServiceKey("Event tent"), "eventTent");
  assert.equal(normalizeCheckoutServiceKey("Event tents"), "eventTent");
  assert.equal(normalizeCheckoutServiceKey("Embroidery"), "");
});

test("createStripeCatalog uses defaults when env values are missing", () => {
  const catalog = createStripeCatalog({ STRIPE_CURRENCY: "usd" });

  assert.equal(catalog.businessCards.amountCents, DEFAULT_BUSINESS_CARDS_CENTS);
  assert.equal(catalog.eventTent.amountCents, DEFAULT_EVENT_TENT_CENTS);
});
