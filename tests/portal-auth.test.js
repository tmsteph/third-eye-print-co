const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadPortalAuth() {
  const source = fs.readFileSync(path.join(__dirname, "..", "portal-auth.js"), "utf8");
  const storage = new Map();
  const localStorage = {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    },
  };
  const sandbox = {
    console,
    localStorage,
    setTimeout,
    clearTimeout,
  };

  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: "portal-auth.js" });
  return sandbox.ThirdEyePortalAuth;
}

function createGunGraph(tree) {
  function read(pathParts) {
    return pathParts.reduce((value, key) => {
      if (!value || typeof value !== "object") {
        return null;
      }

      return key in value ? value[key] : null;
    }, tree);
  }

  function createNode(pathParts = []) {
    return {
      get(key) {
        return createNode([...pathParts, key]);
      },
      once(callback) {
        callback(read(pathParts));
      },
    };
  }

  return createNode();
}

test("authenticateUser prefers canonical suffixed aliases before bare aliases", async () => {
  const portalAuth = loadPortalAuth();
  const attempts = [];
  const user = {
    is: {},
    auth(alias, password, callback) {
      attempts.push({ alias, password });
      if (alias === "tmsteph@3dvr" && password === "secret") {
        this.is = { pub: "pub-tmsteph" };
        callback({});
        return;
      }

      callback({ err: "wrong user" });
    },
    leave() {
      this.is = {};
    },
  };

  const result = await portalAuth.authenticateUser(user, "tmsteph", "secret");

  assert.equal(result.ok, true);
  assert.equal(result.alias, "tmsteph@3dvr");
  assert.equal(result.pub, "pub-tmsteph");
  assert.deepEqual(
    attempts.map((entry) => entry.alias),
    ["tmsteph@thirdeye", "tmsteph@3dvr"]
  );
});

test("resolveAdminAccess rejects bootstrap access when the authenticated pub does not match", async () => {
  const portalAuth = loadPortalAuth();
  const gun = createGunGraph({
    "third-eye-print-co": {
      admins: {},
    },
  });

  const otherAccess = await portalAuth.resolveAdminAccess({
    gun,
    user: {
      is: {
        pub: "Cg-NVNIbxWPDBqX7OmllJQqjxy2t3KA_U2DqQBjcPQ8.1fppECqamDOHh2tKt1G5t8Yd21NjBCZ3C6qunST3lvg",
      },
    },
    alias: "other@3dvr",
    adminPubs: [],
    namespace: "third-eye-print-co",
  });
  const wrongPubAccess = await portalAuth.resolveAdminAccess({
    gun,
    user: { is: { pub: "pub-not-tmsteph" } },
    alias: "tmsteph@3dvr",
    adminPubs: [],
    namespace: "third-eye-print-co",
  });

  assert.equal(otherAccess.ok, false);
  assert.equal(wrongPubAccess.ok, false);
});

test("resolveAdminAccess bootstraps tmsteph from the configured SEA pub", async () => {
  const portalAuth = loadPortalAuth();
  const gun = createGunGraph({
    "third-eye-print-co": {
      admins: {},
    },
  });

  const access = await portalAuth.resolveAdminAccess({
    gun,
    user: {
      is: {
        pub: "Cg-NVNIbxWPDBqX7OmllJQqjxy2t3KA_U2DqQBjcPQ8.1fppECqamDOHh2tKt1G5t8Yd21NjBCZ3C6qunST3lvg",
      },
    },
    alias: "tmsteph@3dvr",
    adminPubs: [],
    namespace: "third-eye-print-co",
  });

  assert.equal(access.ok, true);
  assert.equal(access.mode, "bootstrap_identity");
});

test("ensureBootstrapAdminAccess seeds the local admin graph for tmsteph", async () => {
  const portalAuth = loadPortalAuth();
  const writes = [];
  const gun = {
    get(key) {
      return createWritableNode([key]);
    },
  };

  function createWritableNode(pathParts) {
    return {
      get(key) {
        return createWritableNode([...pathParts, key]);
      },
      put(value, callback) {
        writes.push({ path: pathParts.join("/"), value });
        callback({});
      },
    };
  }

  const result = await portalAuth.ensureBootstrapAdminAccess({
    gun,
    alias: "tmsteph@3dvr",
    pub: "Cg-NVNIbxWPDBqX7OmllJQqjxy2t3KA_U2DqQBjcPQ8.1fppECqamDOHh2tKt1G5t8Yd21NjBCZ3C6qunST3lvg",
    namespace: "third-eye-print-co",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    writes.map((entry) => entry.path),
    [
      "third-eye-print-co/admins/tmsteph@3dvr",
      "third-eye-print-co/admins/Cg-NVNIbxWPDBqX7OmllJQqjxy2t3KA_U2DqQBjcPQ8.1fppECqamDOHh2tKt1G5t8Yd21NjBCZ3C6qunST3lvg",
    ]
  );
});

test("resolveAdminAccess denies unrelated 3dvr aliases", async () => {
  const portalAuth = loadPortalAuth();
  const gun = createGunGraph({
    "third-eye-print-co": {
      admins: {},
    },
  });

  const otherAccess = await portalAuth.resolveAdminAccess({
    gun,
    user: {
      is: {
        pub: "Cg-NVNIbxWPDBqX7OmllJQqjxy2t3KA_U2DqQBjcPQ8.1fppECqamDOHh2tKt1G5t8Yd21NjBCZ3C6qunST3lvg",
      },
    },
    alias: "other@3dvr",
    adminPubs: [],
    namespace: "third-eye-print-co",
  });

  assert.equal(otherAccess.ok, false);
});

test("resolveAdminAccess allows site-local admin aliases without ADMIN_PUBS", async () => {
  const portalAuth = loadPortalAuth();
  const gun = createGunGraph({
    "third-eye-print-co": {
      admins: {
        "owner@thirdeye": { alias: "owner@thirdeye" },
      },
    },
  });

  const access = await portalAuth.resolveAdminAccess({
    gun,
    user: { is: { pub: "pub-owner" } },
    alias: "owner@thirdeye",
    adminPubs: [],
    namespace: "third-eye-print-co",
  });

  assert.equal(access.ok, true);
  assert.equal(access.mode, "site_alias");
});
