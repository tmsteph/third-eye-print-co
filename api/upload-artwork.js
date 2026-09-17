const path = require("node:path");
const Stripe = require("stripe");
const nodemailer = require("nodemailer");

const MAX_ARTWORK_BYTES = 2_500_000;
const MAX_REQUEST_CHARS = 4_000_000;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  if (typeof req.body === "string") return Promise.resolve(req.body.trim() ? JSON.parse(req.body) : {});
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += String(chunk || "");
      if (raw.length > MAX_REQUEST_CHARS) {
        const error = new Error("Artwork upload is too large.");
        error.statusCode = 413;
        reject(error);
      }
    });
    req.on("end", () => {
      try { resolve(raw.trim() ? JSON.parse(raw) : {}); } catch (error) { reject(error); }
    });
    req.on("error", reject);
  });
}

function cleanFilename(value, index) {
  const basename = path.basename(String(value || `artwork-${index + 1}`));
  return basename.replace(/[\r\n\0]/g, "").slice(0, 160) || `artwork-${index + 1}`;
}

function decodeArtworkFiles(value) {
  if (!Array.isArray(value) || !value.length) {
    const error = new Error("Choose at least one artwork file.");
    error.statusCode = 400;
    throw error;
  }
  if (value.length > 2) {
    const error = new Error("Upload at most two artwork files.");
    error.statusCode = 400;
    throw error;
  }
  const files = value.map((entry, index) => {
    const type = String(entry?.type || "").trim().toLowerCase();
    if (!ALLOWED_TYPES.has(type)) {
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
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_ARTWORK_BYTES) {
    const error = new Error("Keep artwork under 2.5 MB total.");
    error.statusCode = 413;
    throw error;
  }
  return files;
}

function cleanOrderId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
}

function createArtworkUploadHandler(options = {}) {
  const env = options.env || process.env;
  const stripeFactory = options.stripeFactory || (key => new Stripe(key));
  const mailTransport = options.mailTransport || null;
  return async function uploadArtwork(req, res) {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return sendJson(res, 405, { error: "Method not allowed." });
    }
    const secretKey = String(env.STRIPE_SECRET_KEY || "").trim();
    const gmailUser = String(env.GMAIL_USER || "").trim();
    const gmailPass = String(env.GMAIL_APP_PASSWORD || "").trim();
    if (!secretKey) return sendJson(res, 503, { error: "Payment verification is unavailable." });
    if (!mailTransport && (!gmailUser || !gmailPass)) return sendJson(res, 503, { error: "Artwork upload is temporarily unavailable." });

    try {
      const body = await readJsonBody(req);
      const sessionId = String(body.sessionId || "").trim();
      const orderId = cleanOrderId(body.orderId);
      if (!sessionId || !orderId) return sendJson(res, 400, { error: "Missing paid order information." });

      const stripe = stripeFactory(secretKey);
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const metadata = session?.metadata || {};
      if (session?.payment_status !== "paid") return sendJson(res, 402, { error: "Payment must be completed before artwork can be sent." });
      if (metadata.checkoutService !== "businessCards" || metadata.orderId !== orderId) {
        return sendJson(res, 403, { error: "This artwork does not match the paid business card order." });
      }
      if (metadata.artworkState === "received") {
        return sendJson(res, 200, { ok: true, alreadyReceived: true, orderId });
      }

      const files = decodeArtworkFiles(body.artwork);
      const transport = mailTransport || nodemailer.createTransport({
        service: "gmail",
        auth: { user: gmailUser, pass: gmailPass },
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      const recipient = String(env.BUSINESS_CARD_ORDER_EMAIL || env.QUOTE_EMAIL_TO || gmailUser).trim();
      await transport.sendMail({
        from: `"Third Eye Print Co." <${gmailUser}>`,
        to: recipient,
        replyTo: gmailUser,
        subject: `Paid Third Eye card artwork ${orderId} — ${metadata.checkoutOptionLabel || "business cards"}`,
        text: [
          "Artwork for a paid Third Eye Print Co. business card order.", "",
          `Order: ${orderId}`,
          `Stripe session: ${session.id}`,
          `Quantity: ${metadata.checkoutOptionLabel || metadata.quantity || ""}`,
          "Payment status: paid", "",
          "Artwork is attached and ready for review.",
        ].join("\n"),
        attachments: files.map((file, index) => ({
          filename: `${index + 1}-${file.name}`,
          content: file.content,
          contentType: file.type,
        })),
        headers: { "X-Third-Eye-Order-Id": orderId, "X-Third-Eye-Stripe-Session": session.id },
      });

      if (stripe.checkout.sessions.update) {
        await stripe.checkout.sessions.update(session.id, {
          metadata: {
            ...metadata,
            artworkState: "received",
            artworkFiles: files.map(file => file.name).join(", ").slice(0, 450),
            artworkDeliveredAt: new Date().toISOString(),
          },
        });
      }
      return sendJson(res, 200, { ok: true, orderId });
    } catch (error) {
      console.error("Artwork upload failed", error);
      return sendJson(res, Number(error.statusCode) || 500, { error: error.statusCode ? error.message : "Could not send artwork. Please try again." });
    }
  };
}

module.exports = createArtworkUploadHandler();
module.exports.createArtworkUploadHandler = createArtworkUploadHandler;
module.exports.decodeArtworkFiles = decodeArtworkFiles;
