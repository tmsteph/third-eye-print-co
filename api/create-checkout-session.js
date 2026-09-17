const { normalizeLead } = require("../lib/lead");
const { resolveCheckoutSelection } = require("../lib/runtime-config");

const MAX_REQUEST_CHARS = 4_000_000;

function readJsonBody(req) {
  if (typeof req.body === "string") {
    return Promise.resolve(req.body.trim() ? JSON.parse(req.body) : {});
  }
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  if (!req || typeof req.on !== "function") return Promise.resolve({});

  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += String(chunk || "");
      if (raw.length > MAX_REQUEST_CHARS) {
        const error = new Error("Request body is too large.");
        error.statusCode = 413;
        reject(error);
      }
    });
    req.on("end", () => {
      if (!raw.trim()) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (error) { reject(error); }
    });
    req.on("error", reject);
  });
}

function resolveSiteUrl(req, env = process.env) {
  const configured = String(env.SITE_URL || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const forwardedHost = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  if (forwardedHost) return `${forwardedProto || "https"}://${forwardedHost}`;
  return "http://127.0.0.1:8787";
}

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function createOrderId() {
  return `TEPC-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

function createCheckoutSessionHandler(options = {}) {
  const { env = process.env, stripeFactory = require("stripe") } = options;

  return async function createCheckoutSessionHandler(req, res) {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return sendJson(res, 405, { error: "Method not allowed." });
    }

    const secretKey = String(env.STRIPE_SECRET_KEY || "").trim();
    if (!secretKey) return sendJson(res, 500, { error: "Secure checkout is not configured." });

    try {
      const body = await readJsonBody(req);
      if (Array.isArray(body.artwork) && body.artwork.length) {
        return sendJson(res, 400, { error: "Artwork files are delivered only after payment." });
      }
      const artworkExpected = Boolean(body && body.artworkExpected);
      const lead = normalizeLead(body && body.lead ? body.lead : body || {});
      const checkoutSelection = resolveCheckoutSelection(lead, env);
      if (!checkoutSelection) {
        return sendJson(res, 400, { error: "Choose a valid business card pack, tent package, or bundle deal before checkout." });
      }

      const stripe = stripeFactory(secretKey);
      const siteUrl = resolveSiteUrl(req, env);
      const orderId = createOrderId();
      const metadata = {
        name: lead.name || "",
        email: lead.email || "",
        phone: lead.phone || "",
        contact: lead.contact || "",
        quoteId: lead.quoteId || "",
        orderId,
        serviceType: lead.serviceType || checkoutSelection.label,
        checkoutService: checkoutSelection.key,
        checkoutOptionId: checkoutSelection.option.id,
        checkoutOptionLabel: checkoutSelection.option.label,
        checkoutAmountCents: String(checkoutSelection.amountCents),
        quantity: lead.quantity || checkoutSelection.option.quantityLabel || "",
        garment: lead.garment || "",
        needBy: lead.needBy || "",
        artworkState: artworkExpected ? "selected_pending_payment" : "not_selected",
        artworkExpected: artworkExpected ? "yes" : "no",
        artworkFiles: "",
      };

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_creation: checkoutSelection.key === "businessCards" ? "always" : undefined,
        line_items: [{
          quantity: 1,
          price_data: {
            currency: checkoutSelection.currency,
            unit_amount: checkoutSelection.amountCents,
            product_data: { name: checkoutSelection.productName, description: checkoutSelection.description },
          },
        }],
        success_url: checkoutSelection.key === "businessCards"
          ? `${siteUrl}/business-cards/?payment=success&order=${encodeURIComponent(orderId)}&session_id={CHECKOUT_SESSION_ID}`
          : `${siteUrl}/custom/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: checkoutSelection.key === "businessCards"
          ? `${siteUrl}/business-cards/?payment=cancelled&order=${encodeURIComponent(orderId)}`
          : `${siteUrl}/custom/?payment=cancelled`,
        customer_email: lead.email || undefined,
        phone_number_collection: { enabled: checkoutSelection.key !== "businessCards" },
        metadata,
        payment_intent_data: { metadata },
      });

      return sendJson(res, 200, { id: session.id, url: session.url, orderId });
    } catch (error) {
      console.error("Checkout session failed", error);
      return sendJson(res, Number(error.statusCode) || 500, { error: error.statusCode ? error.message : "Could not create secure checkout. Please try again." });
    }
  };
}

module.exports = createCheckoutSessionHandler();
module.exports.createCheckoutSessionHandler = createCheckoutSessionHandler;
