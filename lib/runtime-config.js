const DEFAULT_GUN_RELAY_URLS = [
  "wss://relay.3dvr.tech/gun",
  "wss://gun-relay-3dvr.fly.dev/gun",
];
const DEFAULT_STRIPE_CURRENCY = "usd";
const DEFAULT_BUSINESS_CARDS_CENTS = 10000;
const DEFAULT_EVENT_TENT_CENTS = 100000;
const DEFAULT_BUNDLE_CENTS = 102500;
const CHECKOUT_SERVICE_ALIASES = new Map([
  ["business card", "businessCards"],
  ["business cards", "businessCards"],
  ["business cards / handouts", "businessCards"],
  ["cards", "businessCards"],
  ["event tent", "eventTent"],
  ["event tents", "eventTent"],
  ["tent", "eventTent"],
  ["tents", "eventTent"],
  ["bundle", "bundleDeal"],
  ["bundles", "bundleDeal"],
  ["bundle deals", "bundleDeal"],
  ["tent and card bundle", "bundleDeal"],
  ["tent and card bundles", "bundleDeal"],
  ["tents and cards", "bundleDeal"],
]);

const BUSINESS_CARD_TIER_DEFAULTS = Object.freeze([
  {
    id: "cards-50",
    label: "50 cards",
    quantityLabel: "50 cards",
    amountCents: 3500,
    description: "Starter business card pack.",
  },
  {
    id: "cards-100",
    label: "100 cards",
    quantityLabel: "100 cards",
    amountCents: 5500,
    description: "Popular business card pack.",
  },
  {
    id: "cards-200",
    label: "200 cards",
    quantityLabel: "200 cards",
    amountCents: 8000,
    description: "Larger business card run.",
  },
  {
    id: "cards-500",
    label: "500 cards",
    quantityLabel: "500 cards",
    amountCents: DEFAULT_BUSINESS_CARDS_CENTS,
    description: "Best-value bulk business card pack.",
  },
]);

const EVENT_TENT_TIER_DEFAULTS = Object.freeze([
  {
    id: "tent-1",
    label: "1 tent",
    quantityLabel: "1 tent",
    amountCents: DEFAULT_EVENT_TENT_CENTS,
    description: "Single branded event tent.",
  },
  {
    id: "tent-3",
    label: "3 tents",
    quantityLabel: "3 tents",
    amountCents: 270000,
    description: "Three event tents with bundle pricing.",
  },
  {
    id: "tent-5",
    label: "5 tents",
    quantityLabel: "5 tents",
    amountCents: 425000,
    description: "Five event tents with the strongest tent discount.",
  },
]);

const BUNDLE_TIER_DEFAULTS = Object.freeze([
  {
    id: "bundle-1-100",
    label: "1 tent + 100 cards",
    quantityLabel: "1 tent + 100 cards",
    amountCents: DEFAULT_BUNDLE_CENTS,
    description: "Starter event bundle with tent and cards.",
  },
  {
    id: "bundle-3-200",
    label: "3 tents + 200 cards",
    quantityLabel: "3 tents + 200 cards",
    amountCents: 275000,
    description: "Mid-size event bundle with tent discount and added cards.",
  },
  {
    id: "bundle-5-500",
    label: "5 tents + 500 cards",
    quantityLabel: "5 tents + 500 cards",
    amountCents: 430000,
    description: "Largest event bundle for teams, events, and activations.",
  },
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

function createTierOption(defaultOption, envValue) {
  return {
    ...defaultOption,
    amountCents: parsePositiveCents(envValue, defaultOption.amountCents),
  };
}

function createServiceOptions(env, options) {
  return options.map(({ envKey, ...defaultOption }) => createTierOption(defaultOption, env[envKey]));
}

function findLowestAmountCents(options) {
  return options.reduce((lowest, option) => (
    option.amountCents < lowest ? option.amountCents : lowest
  ), options[0] ? options[0].amountCents : 0);
}

function normalizeCheckoutServiceKey(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return CHECKOUT_SERVICE_ALIASES.get(normalized) || "";
}

function normalizeCheckoutOptionKey(value) {
  return String(value || "").trim().toLowerCase();
}

function createStripeCatalog(env = process.env) {
  const currency = String(env.STRIPE_CURRENCY || DEFAULT_STRIPE_CURRENCY).toLowerCase();
  const businessCardOptions = createServiceOptions(env, [
    { ...BUSINESS_CARD_TIER_DEFAULTS[0], envKey: "STRIPE_BUSINESS_CARDS_50_CENTS" },
    { ...BUSINESS_CARD_TIER_DEFAULTS[1], envKey: "STRIPE_BUSINESS_CARDS_100_CENTS" },
    { ...BUSINESS_CARD_TIER_DEFAULTS[2], envKey: "STRIPE_BUSINESS_CARDS_200_CENTS" },
    {
      ...BUSINESS_CARD_TIER_DEFAULTS[3],
      envKey: "STRIPE_BUSINESS_CARDS_500_CENTS",
      amountCents: parseDepositCents(env),
    },
  ]);
  const eventTentOptions = createServiceOptions(env, [
    {
      ...EVENT_TENT_TIER_DEFAULTS[0],
      envKey: "STRIPE_EVENT_TENT_1_CENTS",
      amountCents: parsePositiveCents(env.STRIPE_EVENT_TENT_CENTS, DEFAULT_EVENT_TENT_CENTS),
    },
    { ...EVENT_TENT_TIER_DEFAULTS[1], envKey: "STRIPE_EVENT_TENT_3_CENTS" },
    { ...EVENT_TENT_TIER_DEFAULTS[2], envKey: "STRIPE_EVENT_TENT_5_CENTS" },
  ]);
  const bundleOptions = createServiceOptions(env, [
    { ...BUNDLE_TIER_DEFAULTS[0], envKey: "STRIPE_BUNDLE_1_TENT_100_CARDS_CENTS" },
    { ...BUNDLE_TIER_DEFAULTS[1], envKey: "STRIPE_BUNDLE_3_TENTS_200_CARDS_CENTS" },
    { ...BUNDLE_TIER_DEFAULTS[2], envKey: "STRIPE_BUNDLE_5_TENTS_500_CARDS_CENTS" },
  ]);

  return {
    businessCards: {
      key: "businessCards",
      label: "Business cards",
      buttonLabel: "Checkout business cards",
      currency,
      productName: "Third Eye Print Co. Business Cards",
      description: "Fast checkout for business card packs.",
      defaultOptionId: "cards-100",
      startingAtCents: findLowestAmountCents(businessCardOptions),
      options: businessCardOptions,
    },
    eventTent: {
      key: "eventTent",
      label: "Event tents",
      buttonLabel: "Checkout event tent",
      currency,
      productName: "Third Eye Print Co. Event Tents",
      description: "Fast checkout for event tent packages.",
      defaultOptionId: "tent-1",
      startingAtCents: findLowestAmountCents(eventTentOptions),
      options: eventTentOptions,
    },
    bundleDeal: {
      key: "bundleDeal",
      label: "Tent and card bundles",
      buttonLabel: "Checkout bundle deal",
      currency,
      productName: "Third Eye Print Co. Tent and Card Bundle",
      description: "Fast checkout for tent and business card bundle deals.",
      defaultOptionId: "bundle-1-100",
      startingAtCents: findLowestAmountCents(bundleOptions),
      options: bundleOptions,
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

function resolveCheckoutOption(serviceType, optionValue, env = process.env) {
  const service = typeof serviceType === "object" && serviceType
    ? serviceType
    : resolveCheckoutProduct(serviceType, env);
  if (!service) {
    return null;
  }

  const normalizedValue = normalizeCheckoutOptionKey(optionValue);
  if (!normalizedValue) {
    return null;
  }

  return (service.options || []).find((option) => {
    const candidates = [
      option.id,
      option.label,
      option.quantityLabel,
    ];

    return candidates.some((candidate) => normalizeCheckoutOptionKey(candidate) === normalizedValue);
  }) || null;
}

function resolveCheckoutSelection(input = {}, env = process.env) {
  const service = resolveCheckoutProduct(input.serviceType, env);
  if (!service) {
    return null;
  }

  const option = resolveCheckoutOption(
    service,
    input.checkoutOptionId || input.checkoutOptionLabel || input.quantity,
    env
  );
  if (!option) {
    return null;
  }

  return {
    ...service,
    amountCents: option.amountCents,
    option,
    productName: `${service.productName} - ${option.label}`,
    description: option.description || service.description,
  };
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
    stripeDepositCents: stripeCatalog.businessCards.startingAtCents,
    stripeCurrency: currency,
    stripeCatalog,
    adminPubs: parseAdminPubs(env),
    quoteEmailTo,
  };
}

module.exports = {
  CHECKOUT_SERVICE_ALIASES,
  BUNDLE_TIER_DEFAULTS,
  BUSINESS_CARD_TIER_DEFAULTS,
  DEFAULT_GUN_RELAY_URLS,
  DEFAULT_BUNDLE_CENTS,
  DEFAULT_BUSINESS_CARDS_CENTS,
  DEFAULT_EVENT_TENT_CENTS,
  EVENT_TENT_TIER_DEFAULTS,
  createPublicRuntimeConfig,
  createStripeCatalog,
  normalizeCheckoutServiceKey,
  normalizeCheckoutOptionKey,
  parseAdminPubs,
  parseDepositCents,
  parseGunRelayUrls,
  resolveCheckoutOption,
  resolveCheckoutSelection,
  resolveCheckoutProduct,
  splitCsv,
};
