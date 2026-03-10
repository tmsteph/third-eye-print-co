const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_BUNDLE_CENTS,
  DEFAULT_BUSINESS_CARDS_CENTS,
  DEFAULT_EVENT_TENT_CENTS,
  DEFAULT_GUN_RELAY_URLS,
  createPublicRuntimeConfig,
  createStripeCatalog,
  normalizeCheckoutServiceKey,
  resolveCheckoutSelection,
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
    STRIPE_BUSINESS_CARDS_500_CENTS: "10000",
    STRIPE_EVENT_TENT_1_CENTS: "100000",
    ADMIN_PUBS: "pub-a,pub-b",
    QUOTE_EMAIL_TO: "quotes@example.com",
  });

  assert.deepEqual(config.gunRelayUrls, ["wss://relay.example/gun"]);
  assert.equal(config.gunRelayUrl, "wss://relay.example/gun");
  assert.equal(config.stripeEnabled, true);
  assert.equal(config.stripeDepositCents, 3500);
  assert.equal(config.stripeCurrency, "usd");
  assert.deepEqual(config.adminPubs, ["pub-a", "pub-b"]);
  assert.equal(config.quoteEmailTo, "quotes@example.com");
  assert.equal(config.stripeCatalog.businessCards.defaultOptionId, "cards-100");
  assert.equal(config.stripeCatalog.businessCards.startingAtCents, 3500);
  assert.equal(config.stripeCatalog.businessCards.options[3].amountCents, 10000);
  assert.equal(config.stripeCatalog.eventTent.defaultOptionId, "tent-1");
  assert.equal(config.stripeCatalog.eventTent.options[0].amountCents, 100000);
  assert.equal(config.stripeCatalog.bundleDeal.defaultOptionId, "bundle-1-100");
  assert.equal(config.stripeCatalog.bundleDeal.options[0].amountCents, DEFAULT_BUNDLE_CENTS);
});

test("normalizeCheckoutServiceKey maps supported storefront services", () => {
  assert.equal(normalizeCheckoutServiceKey("Business cards"), "businessCards");
  assert.equal(normalizeCheckoutServiceKey("Business cards / handouts"), "businessCards");
  assert.equal(normalizeCheckoutServiceKey("Event tent"), "eventTent");
  assert.equal(normalizeCheckoutServiceKey("Event tents"), "eventTent");
  assert.equal(normalizeCheckoutServiceKey("Tent and card bundles"), "bundleDeal");
  assert.equal(normalizeCheckoutServiceKey("Embroidery"), "");
});

test("createStripeCatalog uses defaults when env values are missing", () => {
  const catalog = createStripeCatalog({ STRIPE_CURRENCY: "usd" });

  assert.equal(catalog.businessCards.options[3].amountCents, DEFAULT_BUSINESS_CARDS_CENTS);
  assert.equal(catalog.eventTent.options[0].amountCents, DEFAULT_EVENT_TENT_CENTS);
  assert.equal(catalog.bundleDeal.options[0].amountCents, DEFAULT_BUNDLE_CENTS);
});

test("resolveCheckoutSelection returns the selected option details", () => {
  const selection = resolveCheckoutSelection({
    serviceType: "Tent and card bundles",
    checkoutOptionId: "bundle-3-200",
  });

  assert.equal(selection.key, "bundleDeal");
  assert.equal(selection.option.id, "bundle-3-200");
  assert.equal(selection.option.label, "3 tents + 200 cards");
  assert.equal(selection.amountCents, 275000);
});
