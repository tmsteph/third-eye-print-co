const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_GUN_RELAY_URLS,
  createPublicRuntimeConfig,
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
    STRIPE_DEPOSIT_CENTS: "7500",
    ADMIN_PUBS: "pub-a,pub-b",
    QUOTE_EMAIL_TO: "quotes@example.com",
  });

  assert.deepEqual(config, {
    gunNamespace: "third-eye-print-co",
    gunRelayUrls: ["wss://relay.example/gun"],
    gunRelayUrl: "wss://relay.example/gun",
    stripeEnabled: true,
    stripeDepositCents: 7500,
    stripeCurrency: "usd",
    adminPubs: ["pub-a", "pub-b"],
    quoteEmailTo: "quotes@example.com",
  });
});
