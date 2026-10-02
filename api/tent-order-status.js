function createTentOrderStatusHandler({ env = process.env, stripeFactory = require("stripe") } = {}) {
  return async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    const send = (code, data) => { res.statusCode = code; res.end(JSON.stringify(data)); };
    if (req.method !== "GET") { res.setHeader("Allow", "GET"); return send(405, {error: "Method not allowed."}); }
    const id = String(req.query?.session_id || "");
    if (!/^cs_(test_|live_)?[A-Za-z0-9_]{8,250}$/.test(id)) return send(400, {error: "Invalid checkout reference."});
    if (!env.STRIPE_SECRET_KEY) return send(503, {error: "Payment verification is unavailable."});
    try {
      const session = await stripeFactory(env.STRIPE_SECRET_KEY).checkout.sessions.retrieve(id);
      if (session.metadata?.checkoutService !== "eventTent") return send(404, {error: "Tent order not found."});
      return send(200, {paid: session.payment_status === "paid", orderId: session.metadata.orderId || ""});
    } catch (_error) { return send(502, {error: "We could not verify your payment yet."}); }
  };
}
module.exports = createTentOrderStatusHandler();
module.exports.createTentOrderStatusHandler = createTentOrderStatusHandler;
