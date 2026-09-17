const { persistLeadRecord } = require("../../lib/server-gun");

const HANDLED_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
]);

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function safeText(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) {
    return req.body;
  }

  if (typeof req.body === "string") {
    return Buffer.from(req.body);
  }

  if (!req || typeof req.on !== "function") {
    return Buffer.from("");
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      const normalizedChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk || ""));
      size += normalizedChunk.length;

      if (size > 1024 * 1024) {
        reject(new Error("Webhook body too large."));
        return;
      }

      chunks.push(normalizedChunk);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    req.on("error", reject);
  });
}

function resolveCreatedAt(event) {
  const eventTimestamp = Number(event && event.created);
  if (!Number.isFinite(eventTimestamp) || eventTimestamp <= 0) {
    return new Date().toISOString();
  }

  return new Date(eventTimestamp * 1000).toISOString();
}

function formatAmountNote(amountCents, currencyCode) {
  const normalizedCents = Number(amountCents);
  const normalizedCurrency = String(currencyCode || "usd").toUpperCase();

  if (!Number.isFinite(normalizedCents) || normalizedCents <= 0) {
    return "Stripe confirmed payment.";
  }

  try {
    const formattedAmount = (normalizedCents / 100).toLocaleString(undefined, {
      style: "currency",
      currency: normalizedCurrency,
    });
    return `Stripe confirmed payment of ${formattedAmount}.`;
  } catch (_error) {
    return `Stripe confirmed payment of ${(normalizedCents / 100).toFixed(2)} ${normalizedCurrency}.`;
  }
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

async function notifyPaidCheckout({ stripe, session, record, env, mailTransport }) {
  const transport = mailTransport || createMailTransport(env);
  if (!transport) throw new Error("Paid checkout email is not configured.");
  const current = stripe.checkout?.sessions?.retrieve ? await stripe.checkout.sessions.retrieve(session.id) : session;
  const metadata = current?.metadata || session.metadata || {};
  if (metadata.checkoutEmailSent === "yes") return { sent: false, duplicate: true };
  const recipient = String(env.CHECKOUT_ORDER_EMAIL || env.BUSINESS_CARD_ORDER_EMAIL || env.QUOTE_EMAIL_TO || env.GMAIL_USER || "").trim();
  if (!recipient) throw new Error("Paid checkout recipient is not configured.");
  const orderId = safeText(metadata.orderId || "", 80);
  const service = safeText(metadata.serviceType || record.serviceType || "Order", 120);
  const option = safeText(metadata.checkoutOptionLabel || record.checkoutOptionLabel || record.quantity || "", 120);
  const amount = formatAmountNote(record.checkoutAmountCents, record.checkoutCurrency).replace(/^Stripe confirmed payment of /, "").replace(/\.$/, "");
  const artworkState = safeText(metadata.artworkState || "", 80);
  const artworkLine = artworkState === "selected_pending_payment"
    ? "Artwork: selected before payment; delivery should follow automatically."
    : artworkState === "received" ? "Artwork: received." : "Artwork: not selected yet.";
  await transport.sendMail({
    from: `"Third Eye Print Co." <${env.GMAIL_USER}>`,
    to: recipient,
    replyTo: record.email || env.GMAIL_USER,
    subject: `PAID Third Eye order ${orderId || session.id} — ${option || service}`,
    text: [
      "A Third Eye Print Co. checkout was paid.", "",
      `Order: ${orderId || "(no order id)"}`,
      `Stripe session: ${session.id}`,
      `Product: ${service}`,
      option ? `Option: ${option}` : "",
      `Amount: ${amount}`,
      record.email ? `Customer email: ${record.email}` : "",
      record.name ? `Customer: ${record.name}` : "",
      artworkLine,
    ].filter(Boolean).join("\n"),
    headers: { "X-Third-Eye-Stripe-Session": session.id, "X-Third-Eye-Order-Id": orderId },
  });
  if (stripe.checkout?.sessions?.update) {
    await stripe.checkout.sessions.update(session.id, {
      metadata: { ...metadata, checkoutEmailSent: "yes", checkoutEmailSentAt: new Date().toISOString() },
    });
  }
  return { sent: true };
}

function buildStripeLeadRecord(event) {
  if (!event || !HANDLED_EVENT_TYPES.has(event.type)) {
    return null;
  }

  const session = event.data && event.data.object;
  if (!session || session.object !== "checkout.session") {
    return null;
  }

  const paymentStatus = safeText(session.payment_status || "", 40).toLowerCase();
  const isPaid = event.type === "checkout.session.async_payment_succeeded" || paymentStatus === "paid";
  if (!isPaid) {
    return null;
  }

  const metadata = session.metadata || {};
  const customerDetails = session.customer_details || {};
  const amountCents = Number.isFinite(Number(session.amount_total))
    ? Number(session.amount_total)
    : Number(metadata.checkoutAmountCents || 0);
  const currency = safeText(session.currency || metadata.checkoutCurrency || "usd", 12).toLowerCase();
  const checkoutOptionLabel = safeText(metadata.checkoutOptionLabel || "", 120);
  const quantity = safeText(
    metadata.quantity || checkoutOptionLabel || "",
    120
  );
  const email = safeText(
    metadata.email || customerDetails.email || "",
    180
  );
  const phone = safeText(
    metadata.phone || customerDetails.phone || "",
    80
  );
  const contact = safeText(
    metadata.contact || [email, phone].filter(Boolean).join(" / "),
    180
  );

  return {
    id: `stripe-${safeText(event.id, 120)}`,
    quoteId: safeText(metadata.quoteId || "", 120),
    source: "payment_succeeded",
    createdAt: resolveCreatedAt(event),
    name: safeText(metadata.name || customerDetails.name || "", 120),
    company: "",
    email,
    phone,
    contact,
    serviceType: safeText(metadata.serviceType || "", 120),
    checkoutOptionLabel,
    quantity,
    garment: safeText(metadata.garment || "", 160),
    artStatus: "",
    needBy: safeText(metadata.needBy || "", 80),
    notes: safeText(
      `${formatAmountNote(amountCents, currency)} Webhook event: ${event.type}.`,
      2000
    ),
    checkoutSessionId: safeText(session.id || "", 120),
    checkoutAmountCents: amountCents > 0 ? String(amountCents) : safeText(metadata.checkoutAmountCents || "", 32),
    checkoutCurrency: currency,
    paymentStatus: paymentStatus || "paid",
    stripeEventId: safeText(event.id || "", 120),
    paymentIntentId: safeText(session.payment_intent || "", 120),
    customerEmail: safeText(customerDetails.email || "", 180),
    customerPhone: safeText(customerDetails.phone || "", 80),
  };
}

function createStripeWebhookHandler(options = {}) {
  const {
    env = process.env,
    persistRecord = persistLeadRecord,
    stripeFactory = require("stripe"),
    mailTransport = null,
  } = options;

  return async function stripeWebhookHandler(req, res) {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      sendJson(res, 405, { error: "Method not allowed." });
      return;
    }

    const secretKey = safeText(env.STRIPE_SECRET_KEY || "", 256);
    const webhookSecret = safeText(env.STRIPE_WEBHOOK_SECRET || "", 256);
    const signature = safeText(req.headers["stripe-signature"] || "", 512);

    if (!webhookSecret) {
      sendJson(res, 500, {
        error: "Stripe webhook is not configured. Set STRIPE_WEBHOOK_SECRET in your project environment.",
      });
      return;
    }

    if (!secretKey) {
      sendJson(res, 500, {
        error: "Stripe is not configured. Set STRIPE_SECRET_KEY in your project environment.",
      });
      return;
    }

    if (!signature) {
      sendJson(res, 400, { error: "Missing Stripe signature header." });
      return;
    }

    try {
      const stripe = stripeFactory(secretKey);
      const rawBody = await readRawBody(req);
      const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
      const record = buildStripeLeadRecord(event);

      if (!record) {
        sendJson(res, 200, {
          received: true,
          ignored: true,
          type: event.type,
        });
        return;
      }

      await persistRecord(record, { env });
      await notifyPaidCheckout({ stripe, session: event.data.object, record, env, mailTransport });

      sendJson(res, 200, {
        received: true,
        type: event.type,
        recordId: record.id,
      });
    } catch (error) {
      if (error && error.type === "StripeSignatureVerificationError") {
        sendJson(res, 400, { error: "Stripe signature verification failed." });
        return;
      }

      console.error("Stripe webhook failed", error);
      sendJson(res, 500, { error: "Could not process Stripe webhook." });
    }
  };
}

module.exports = createStripeWebhookHandler();
module.exports.config = {
  api: {
    bodyParser: false,
  },
};
module.exports.buildStripeLeadRecord = buildStripeLeadRecord;
module.exports.createStripeWebhookHandler = createStripeWebhookHandler;
module.exports.notifyPaidCheckout = notifyPaidCheckout;
module.exports.readRawBody = readRawBody;
