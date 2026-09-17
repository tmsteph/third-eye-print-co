const path = require("node:path");
const { normalizeLead } = require("../lib/lead");
const { resolveCheckoutSelection } = require("../lib/runtime-config");

const MAX_ARTWORK_BYTES = 2_500_000;
const MAX_REQUEST_CHARS = 4_000_000;
const ALLOWED_ARTWORK_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);

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
        const error = new Error("Artwork upload is too large.");
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

function cleanFilename(value, index) {
  const basename = path.basename(String(value || `artwork-${index + 1}`));
  return basename.replace(/[\r\n\0]/g, "").slice(0, 160) || `artwork-${index + 1}`;
}

function decodeArtworkFiles(value) {
  if (!Array.isArray(value) || !value.length) return [];
  if (value.length > 2) {
    const error = new Error("Upload at most two artwork files.");
    error.statusCode = 400;
    throw error;
  }

  const files = value.map((entry, index) => {
    const type = String(entry?.type || "").trim().toLowerCase();
    if (!ALLOWED_ARTWORK_TYPES.has(type)) {
      const error = new Error("Artwork must be a PDF, JPG, or PNG file.");
      error.statusCode = 400;
      throw error;
    }
    const data = String(entry?.data || "").trim();
    if (!data || !/^[A-Za-z0-9+/=]+$/.test(data)) {
      const error = new Error("Artwork file could not be read.");
      error.statusCode = 400;
      throw error;
    }
    const content = Buffer.from(data, "base64");
    if (!content.length) {
      const error = new Error("Artwork file is empty.");
      error.statusCode = 400;
      throw error;
    }
    return { name: cleanFilename(entry?.name, index), type, content, size: content.length };
  });

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_ARTWORK_BYTES) {
    const error = new Error("Keep artwork under 2.5 MB total.");
    error.statusCode = 413;
    throw error;
  }
  return files;
}

function createOrderId() {
  return `TEPC-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

function createMailTransport(env) {
  if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) return null;
  const nodemailer = require("nodemailer");
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}

function createCheckoutSessionHandler(options = {}) {
  const { env = process.env, stripeFactory = require("stripe"), mailTransport: suppliedMailTransport = null } = options;

  return async function createCheckoutSessionHandler(req, res) {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return sendJson(res, 405, { error: "Method not allowed." });
    }

    const secretKey = String(env.STRIPE_SECRET_KEY || "").trim();
    if (!secretKey) return sendJson(res, 500, { error: "Secure checkout is not configured." });

    let session;
    try {
      const body = await readJsonBody(req);
      const lead = normalizeLead(body && body.lead ? body.lead : body || {});
      const checkoutSelection = resolveCheckoutSelection(lead, env);
      if (!checkoutSelection) {
        return sendJson(res, 400, { error: "Choose a valid business card pack, tent package, or bundle deal before checkout." });
      }

      const artwork = checkoutSelection.key === "businessCards" ? decodeArtworkFiles(body.artwork) : [];
      const hasArtwork = artwork.length > 0;
      const mailTransport = hasArtwork ? (suppliedMailTransport || createMailTransport(env)) : null;
      if (hasArtwork && !mailTransport) {
        return sendJson(res, 503, { error: "Artwork upload is temporarily unavailable. Remove the file and pay now, or try again shortly." });
      }

      const stripe = stripeFactory(secretKey);
      const siteUrl = resolveSiteUrl(req, env);
      const orderId = createOrderId();
      const artworkState = hasArtwork ? "received" : "later";
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
        artworkState,
        artworkFiles: artwork.map(file => file.name).join(", ").slice(0, 450),
      };

      session = await stripe.checkout.sessions.create({
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
          ? `${siteUrl}/business-cards/?payment=success&order=${encodeURIComponent(orderId)}&artwork=${artworkState}&session_id={CHECKOUT_SESSION_ID}`
          : `${siteUrl}/custom/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: checkoutSelection.key === "businessCards"
          ? `${siteUrl}/business-cards/?payment=cancelled&order=${encodeURIComponent(orderId)}&artwork=${artworkState}`
          : `${siteUrl}/custom/?payment=cancelled`,
        customer_email: lead.email || undefined,
        phone_number_collection: { enabled: checkoutSelection.key !== "businessCards" },
        metadata,
        payment_intent_data: { metadata },
      });

      if (hasArtwork) {
        const recipient = String(env.BUSINESS_CARD_ORDER_EMAIL || env.QUOTE_EMAIL_TO || env.GMAIL_USER || "").trim();
        await mailTransport.sendMail({
          from: `"Third Eye Print Co." <${env.GMAIL_USER}>`,
          to: recipient,
          replyTo: env.GMAIL_USER,
          subject: `Third Eye card artwork ${orderId} — ${checkoutSelection.option.label}`,
          text: [
            "Business card artwork was submitted before checkout.", "",
            `Order: ${orderId}`,
            `Stripe session: ${session.id}`,
            `Quantity: ${checkoutSelection.option.label}`,
            `Price: $${(checkoutSelection.amountCents / 100).toFixed(2)}`,
            `Checkout: ${session.url}`, "",
            "Artwork is attached. Payment is not confirmed by this email; match the order ID in Stripe before production.",
          ].join("\n"),
          attachments: artwork.map((file, index) => ({
            filename: `${index + 1}-${file.name}`,
            content: file.content,
            contentType: file.type,
          })),
          headers: { "X-Third-Eye-Order-Id": orderId, "X-Third-Eye-Stripe-Session": session.id },
        });
      }

      return sendJson(res, 200, { id: session.id, url: session.url, orderId, artworkState });
    } catch (error) {
      if (session?.id) {
        try {
          const stripe = stripeFactory(secretKey);
          if (stripe.checkout?.sessions?.expire) await stripe.checkout.sessions.expire(session.id);
        } catch {}
      }
      console.error("Checkout session failed", error);
      return sendJson(res, Number(error.statusCode) || 500, { error: error.statusCode ? error.message : "Could not create secure checkout. Please try again." });
    }
  };
}

module.exports = createCheckoutSessionHandler();
module.exports.createCheckoutSessionHandler = createCheckoutSessionHandler;
module.exports.decodeArtworkFiles = decodeArtworkFiles;
module.exports.MAX_ARTWORK_BYTES = MAX_ARTWORK_BYTES;
