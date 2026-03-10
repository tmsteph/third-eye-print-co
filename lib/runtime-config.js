const DEFAULT_GUN_RELAY_URLS = [
  "wss://relay.3dvr.tech/gun",
  "wss://gun-relay-3dvr.fly.dev/gun",
];
const DEFAULT_STRIPE_CURRENCY = "usd";
const DEFAULT_BUSINESS_CARDS_CENTS = 10000;
const DEFAULT_EVENT_TENT_CENTS = 100000;
const CHECKOUT_SERVICE_ALIASES = new Map([
  ["business card", "businessCards"],
  ["business cards", "businessCards"],
  ["business cards / handouts", "businessCards"],
  ["cards", "businessCards"],
  ["event tent", "eventTent"],
  ["event tents", "eventTent"],
  ["tent", "eventTent"],
  ["tents", "eventTent"],
]);

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseGunRelayUrls(env = process.env) {
  const configured = splitCsv(env.GUN_RELAY_URLS);
  const fallback = String(env.GUN_RELAY_URL || "").trim();

  if (configured.length) {
    return Array.from(new Set(configured));
  }

  if (fallback) {
    return [fallback];
  }

  return [...DEFAULT_GUN_RELAY_URLS];
}

function parseAdminPubs(env = process.env) {
  return Array.from(new Set(splitCsv(env.ADMIN_PUBS || env.THIRD_EYE_ADMIN_PUBS)));
}

function parsePositiveCents(value, fallback) {
  const cents = Number(value);
  return Number.isFinite(cents) && cents > 0 ? Math.round(cents) : fallback;
}

function parseDepositCents(env = process.env) {
  return parsePositiveCents(
    env.STRIPE_BUSINESS_CARDS_CENTS || env.STRIPE_DEPOSIT_CENTS,
    DEFAULT_BUSINESS_CARDS_CENTS
  );
}

function normalizeCheckoutServiceKey(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return CHECKOUT_SERVICE_ALIASES.get(normalized) || "";
}

function createStripeCatalog(env = process.env) {
  const currency = String(env.STRIPE_CURRENCY || DEFAULT_STRIPE_CURRENCY).toLowerCase();

  return {
    businessCards: {
      key: "businessCards",
      label: "Business cards",
      buttonLabel: "Checkout business cards",
      amountCents: parseDepositCents(env),
      currency,
      productName: "Third Eye Print Co. Business Cards",
      description: "Fast checkout for standard business card orders.",
    },
    eventTent: {
      key: "eventTent",
      label: "Event tents",
      buttonLabel: "Checkout event tent",
      amountCents: parsePositiveCents(env.STRIPE_EVENT_TENT_CENTS, DEFAULT_EVENT_TENT_CENTS),
      currency,
      productName: "Third Eye Print Co. Event Tent",
      description: "Fast checkout for branded event tent orders.",
    },
  };
}

function resolveCheckoutProduct(serviceType, env = process.env) {
  const key = normalizeCheckoutServiceKey(serviceType);
  if (!key) {
    return null;
  }

  return createStripeCatalog(env)[key] || null;
}

function createPublicRuntimeConfig(env = process.env) {
  const relayUrls = parseGunRelayUrls(env);
  const currency = String(env.STRIPE_CURRENCY || DEFAULT_STRIPE_CURRENCY).toLowerCase();
  const quoteEmailTo = String(env.QUOTE_EMAIL_TO || "gamboaesai@gmail.com").trim();
  const stripeCatalog = createStripeCatalog(env);

  return {
    gunNamespace: "third-eye-print-co",
    gunRelayUrls: relayUrls,
    gunRelayUrl: relayUrls[0] || "",
    stripeEnabled: Boolean(env.STRIPE_SECRET_KEY),
    stripeDepositCents: stripeCatalog.businessCards.amountCents,
    stripeCurrency: currency,
    stripeCatalog,
    adminPubs: parseAdminPubs(env),
    quoteEmailTo,
  };
}

module.exports = {
  CHECKOUT_SERVICE_ALIASES,
  DEFAULT_GUN_RELAY_URLS,
  DEFAULT_BUSINESS_CARDS_CENTS,
  DEFAULT_EVENT_TENT_CENTS,
  createPublicRuntimeConfig,
  createStripeCatalog,
  normalizeCheckoutServiceKey,
  parseAdminPubs,
  parseDepositCents,
  parseGunRelayUrls,
  resolveCheckoutProduct,
  splitCsv,
};
