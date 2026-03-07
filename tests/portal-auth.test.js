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

test("resolveAdminAccess only bootstraps tmsteph from the 3dvr portal admin graph", async () => {
  const portalAuth = loadPortalAuth();
  const gun = createGunGraph({
    "3dvr-portal": {
      admins: {
        "tmsteph@3dvr": { alias: "tmsteph@3dvr" },
        "other@3dvr": { alias: "other@3dvr" },
      },
    },
    "third-eye-print-co": {
      admins: {},
    },
  });

  const tmstephAccess = await portalAuth.resolveAdminAccess({
    gun,
    user: { is: { pub: "pub-tmsteph" } },
    alias: "tmsteph@3dvr",
    adminPubs: [],
    namespace: "third-eye-print-co",
  });
  const otherAccess = await portalAuth.resolveAdminAccess({
    gun,
    user: { is: { pub: "pub-other" } },
    alias: "other@3dvr",
    adminPubs: [],
    namespace: "third-eye-print-co",
  });

  assert.equal(tmstephAccess.ok, true);
  assert.equal(tmstephAccess.mode, "bootstrap_portal_alias");
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
