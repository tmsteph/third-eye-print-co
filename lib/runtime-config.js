const DEFAULT_GUN_RELAY_URLS = [
  "wss://relay.3dvr.tech/gun",
  "wss://gun-relay-3dvr.fly.dev/gun",
];

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

function parseDepositCents(env = process.env) {
  const value = Number(env.STRIPE_DEPOSIT_CENTS || 5000);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 5000;
}

function createPublicRuntimeConfig(env = process.env) {
  const relayUrls = parseGunRelayUrls(env);
  const currency = String(env.STRIPE_CURRENCY || "usd").toLowerCase();
  const quoteEmailTo = String(env.QUOTE_EMAIL_TO || "gamboaesai@gmail.com").trim();

  return {
    gunNamespace: "third-eye-print-co",
    gunRelayUrls: relayUrls,
    gunRelayUrl: relayUrls[0] || "",
    stripeEnabled: Boolean(env.STRIPE_SECRET_KEY),
    stripeDepositCents: parseDepositCents(env),
    stripeCurrency: currency,
    adminPubs: parseAdminPubs(env),
    quoteEmailTo,
  };
}

module.exports = {
  DEFAULT_GUN_RELAY_URLS,
  createPublicRuntimeConfig,
  parseAdminPubs,
  parseDepositCents,
  parseGunRelayUrls,
  splitCsv,
};
