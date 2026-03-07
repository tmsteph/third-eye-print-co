const { createPublicRuntimeConfig } = require("../lib/runtime-config");

module.exports = function configHandler(_req, res) {
  const payload = `window.THIRD_EYE_CONFIG = ${JSON.stringify(createPublicRuntimeConfig(process.env))};`;
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300");
  res.end(payload);
};
