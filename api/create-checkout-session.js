const { normalizeLead, minimalLeadValidation } = require("../lib/lead");
const { resolveCheckoutSelection } = require("../lib/runtime-config");

function readJsonBody(req) {
  if (typeof req.body === "string") {
    return Promise.resolve(req.body.trim() ? JSON.parse(req.body) : {});
  }

  if (req.body && typeof req.body === "object") {
    return Promise.resolve(req.body);
  }

  if (!req || typeof req.on !== "function") {
    return Promise.resolve({});
  }

  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", (chunk) => {
      raw += String(chunk || "");
      if (raw.length > 1024 * 1024) {
        reject(new Error("Request body too large."));
      }
    });

    req.on("end", () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

function resolveSiteUrl(req, env = process.env) {
  const configured = String(env.SITE_URL || "").trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const forwardedHost = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  if (forwardedHost) {
    return `${forwardedProto || "https"}://${forwardedHost}`;
  }

  return "http://127.0.0.1:8787";
}

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function createCheckoutSessionHandler(options = {}) {
  const {
    env = process.env,
    stripeFactory = require("stripe"),
  } = options;

  return async function createCheckoutSessionHandler(req, res) {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      sendJson(res, 405, { error: "Method not allowed." });
      return;
    }

    const secretKey = String(env.STRIPE_SECRET_KEY || "").trim();
    if (!secretKey) {
      sendJson(res, 500, {
        error: "Stripe is not configured. Set STRIPE_SECRET_KEY in your project environment.",
      });
      return;
    }

    try {
      const body = await readJsonBody(req);
      const lead = normalizeLead(body && body.lead ? body.lead : body || {});
      if (!minimalLeadValidation(lead)) {
        sendJson(res, 400, { error: "Name and contact are required before payment." });
        return;
      }

      const checkoutSelection = resolveCheckoutSelection(lead, env);
      if (!checkoutSelection) {
        sendJson(res, 400, {
          error: "Choose a valid business card pack, tent package, or bundle deal before checkout.",
        });
        return;
      }

      const stripe = stripeFactory(secretKey);
      const siteUrl = resolveSiteUrl(req, env);

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: checkoutSelection.currency,
              unit_amount: checkoutSelection.amountCents,
              product_data: {
                name: checkoutSelection.productName,
                description: checkoutSelection.description,
              },
            },
          },
        ],
        success_url: `${siteUrl}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${siteUrl}/?payment=cancelled`,
        metadata: {
          name: lead.name || "",
          contact: lead.contact || "",
          quoteId: lead.quoteId || "",
          serviceType: lead.serviceType || checkoutSelection.label,
          checkoutService: checkoutSelection.key,
          checkoutOptionId: checkoutSelection.option.id,
          checkoutOptionLabel: checkoutSelection.option.label,
          checkoutAmountCents: String(checkoutSelection.amountCents),
          quantity: lead.quantity || checkoutSelection.option.quantityLabel || "",
          garment: lead.garment || "",
          needBy: lead.needBy || "",
        },
      });

      sendJson(res, 200, {
        id: session.id,
        url: session.url,
      });
    } catch (error) {
      console.error("Checkout session failed", error);
      sendJson(res, 500, { error: "Could not create Stripe checkout session" });
    }
  };
}

module.exports = createCheckoutSessionHandler();
module.exports.createCheckoutSessionHandler = createCheckoutSessionHandler;
