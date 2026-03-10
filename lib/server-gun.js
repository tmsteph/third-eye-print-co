const { parseGunRelayUrls } = require("./runtime-config");

const DEFAULT_NAMESPACE = "third-eye-print-co";
const DEFAULT_WRITE_TIMEOUT_MS = 1800;

let cachedContext = null;
let cachedContextKey = "";

function resolveNamespace(env = process.env) {
  return String(env.GUN_NAMESPACE || DEFAULT_NAMESPACE).trim() || DEFAULT_NAMESPACE;
}

function createServerGunContext(options = {}) {
  const {
    env = process.env,
    GunFactory = require("gun"),
  } = options;
  const peers = parseGunRelayUrls(env);
  const namespace = resolveNamespace(env);
  const contextKey = `${namespace}|${peers.join(",")}`;

  if (cachedContext && cachedContextKey === contextKey) {
    return cachedContext;
  }

  const gunOptions = {
    localStorage: false,
    radisk: false,
    file: false,
    multicast: false,
  };

  if (peers.length) {
    gunOptions.peers = peers;
  }

  const gun = GunFactory(gunOptions);
  const root = gun && typeof gun.get === "function"
    ? gun.get(namespace)
    : null;

  cachedContext = {
    gun,
    root,
    peers,
    namespace,
  };
  cachedContextKey = contextKey;

  return cachedContext;
}

function writeGunRecord(node, record, options = {}) {
  const timeoutMs = Number(options.timeoutMs) > 0
    ? Number(options.timeoutMs)
    : DEFAULT_WRITE_TIMEOUT_MS;

  if (!node || typeof node.get !== "function" || !record || !record.id) {
    return Promise.reject(new Error("Gun lead node is unavailable."));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("Timed out while writing the Gun record."));
      }
    }, timeoutMs);

    node.get(record.id).put(record, (ack) => {
      if (settled) {
        return;
      }

      clearTimeout(timeoutId);
      settled = true;

      if (ack && ack.err) {
        reject(new Error(String(ack.err)));
        return;
      }

      resolve(ack || {});
    });
  });
}

async function persistLeadRecord(record, options = {}) {
  const context = options.context || createServerGunContext(options);

  if (!context.root || typeof context.root.get !== "function") {
    throw new Error("Gun root node is unavailable.");
  }

  const leadsNode = context.root.get("leads");
  await writeGunRecord(leadsNode, record, options);
  return record;
}

module.exports = {
  DEFAULT_NAMESPACE,
  DEFAULT_WRITE_TIMEOUT_MS,
  createServerGunContext,
  persistLeadRecord,
  resolveNamespace,
  writeGunRecord,
};
