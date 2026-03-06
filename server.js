const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const express = require("express");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 8787);
const SITE_URL = process.env.SITE_URL || `http://localhost:${PORT}`;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_CURRENCY = String(process.env.STRIPE_CURRENCY || "usd").toLowerCase();
const STRIPE_DEPOSIT_CENTS = Number(process.env.STRIPE_DEPOSIT_CENTS || 5000);
const GUN_RELAY_URL = process.env.GUN_RELAY_URL || "";
const GUN_RELAY_URLS = String(process.env.GUN_RELAY_URLS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const LEAD_FILE = path.resolve(process.env.LEAD_FILE || path.join(__dirname, "data", "leads.jsonl"));

const stripe = STRIPE_SECRET_KEY ? require("stripe")(STRIPE_SECRET_KEY) : null;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

const CLEAN_LIMITS = {
  name: 120,
  contact: 180,
  quantity: 40,
  colors: 40,
  garment: 120,
  locations: 160,
  notes: 2000,
};

function cleanText(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeLead(input = {}) {
  return {
    name: cleanText(input.name, CLEAN_LIMITS.name),
    contact: cleanText(input.contact, CLEAN_LIMITS.contact),
    quantity: cleanText(input.quantity, CLEAN_LIMITS.quantity),
    colors: cleanText(input.colors, CLEAN_LIMITS.colors),
    garment: cleanText(input.garment, CLEAN_LIMITS.garment),
    locations: cleanText(input.locations, CLEAN_LIMITS.locations),
    notes: cleanText(input.notes, CLEAN_LIMITS.notes),
  };
}

function appendLead(entry) {
  const dir = path.dirname(LEAD_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(LEAD_FILE, `${JSON.stringify(entry)}\n`, "utf8");
}

function minimalLeadValidation(lead) {
  return Boolean(lead.name) && Boolean(lead.contact);
}

app.get("/config.js", (_req, res) => {
  const resolvedRelayUrls = GUN_RELAY_URLS.length ? GUN_RELAY_URLS : (GUN_RELAY_URL ? [GUN_RELAY_URL] : []);
  const safeConfig = {
    gunRelayUrls: resolvedRelayUrls,
    gunRelayUrl: GUN_RELAY_URL,
    stripeDepositCents: STRIPE_DEPOSIT_CENTS,
    stripeCurrency: STRIPE_CURRENCY,
  };

  res.type("application/javascript");
  res.send(`window.THIRD_EYE_CONFIG = ${JSON.stringify(safeConfig)};`);
});

app.post("/api/lead", (req, res) => {
  try {
    const source = cleanText(String(req.body?.source || "quote"), 60) || "quote";
    const lead = normalizeLead(req.body?.lead || req.body || {});

    if (!minimalLeadValidation(lead)) {
      return res.status(400).json({ error: "Name and contact are required." });
    }

    const entry = {
      id: randomUUID(),
      source,
      createdAt: new Date().toISOString(),
      lead,
    };

    appendLead(entry);
    return res.json({ ok: true, id: entry.id });
  } catch (error) {
    console.error("Lead save failed", error);
    return res.status(500).json({ error: "Could not save lead" });
  }
});

app.post("/api/create-checkout-session", async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({
        error: "Stripe is not configured. Set STRIPE_SECRET_KEY in your .env file.",
      });
    }

    const lead = normalizeLead(req.body?.lead || req.body || {});

    if (!minimalLeadValidation(lead)) {
      return res.status(400).json({ error: "Name and contact are required before payment." });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: STRIPE_CURRENCY,
            unit_amount: STRIPE_DEPOSIT_CENTS,
            product_data: {
              name: "Third Eye Print Co. Order Deposit",
              description: "Deposit collected before final production invoice.",
            },
          },
        },
      ],
      success_url: `${SITE_URL}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/?payment=cancelled`,
      metadata: {
        name: lead.name || "",
        contact: lead.contact || "",
        quantity: lead.quantity || "",
        garment: lead.garment || "",
      },
    });

    appendLead({
      id: randomUUID(),
      source: "deposit_checkout",
      createdAt: new Date().toISOString(),
      sessionId: session.id,
      lead,
    });

    return res.json({ url: session.url });
  } catch (error) {
    console.error("Checkout session failed", error);
    return res.status(500).json({ error: "Could not create Stripe checkout session" });
  }
});

app.listen(PORT, () => {
  console.log(`Third Eye Print Co running at ${SITE_URL}`);
});
