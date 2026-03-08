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

function createGunHarness({ graph = {}, users = {} } = {}) {
  const tree = JSON.parse(JSON.stringify(graph));
  const userStore = { ...users };
  let userSequence = Object.keys(userStore).length;

  function readPath(pathParts) {
    return pathParts.reduce((value, key) => {
      if (!value || typeof value !== "object") {
        return null;
      }

      return key in value ? value[key] : null;
    }, tree);
  }

  function writePath(pathParts, value) {
    let node = tree;
    for (let index = 0; index < pathParts.length - 1; index += 1) {
      const key = pathParts[index];
      if (!node[key] || typeof node[key] !== "object") {
        node[key] = {};
      }
      node = node[key];
    }

    node[pathParts[pathParts.length - 1]] = value;
  }

  function createNode(pathParts = []) {
    return {
      get(key) {
        return createNode([...pathParts, key]);
      },
      once(callback) {
        callback(readPath(pathParts));
      },
      put(value, callback) {
        writePath(pathParts, value);
        if (callback) {
          callback({});
        }
      },
    };
  }

  function createUserInstance() {
    return {
      is: {},
      auth(alias, password, callback) {
        const record = userStore[alias];
        if (!record || record.password !== password) {
          callback({ err: "wrong user" });
          return;
        }

        this.is = { pub: record.pub };
        callback({});
      },
      create(alias, password, callback) {
        if (userStore[alias]) {
          callback({ err: "User already created" });
          return;
        }

        userSequence += 1;
        userStore[alias] = {
          password,
          pub: `pub-${userSequence}`,
        };
        callback({});
      },
      leave() {
        this.is = {};
      },
    };
  }

  return {
    gun: {
      get(key) {
        return createNode([key]);
      },
      user() {
        return createUserInstance();
      },
    },
    tree,
    userStore,
    read(pathString) {
      return readPath(pathString.split("/").filter(Boolean));
    },
  };
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

test("resolveAdminAccess rejects revoked admin records", async () => {
  const portalAuth = loadPortalAuth();
  const harness = createGunHarness({
    graph: {
      "third-eye-print-co": {
        admins: {
          "owner@thirdeye": {
            alias: "owner@thirdeye",
            active: false,
            archived: true,
            revoked: true,
          },
        },
      },
    },
  });

  const access = await portalAuth.resolveAdminAccess({
    gun: harness.gun,
    user: { is: { pub: "pub-owner" } },
    alias: "owner@thirdeye",
    adminPubs: [],
    namespace: "third-eye-print-co",
  });

  assert.equal(access.ok, false);
});

test("resolveAdminAccess bootstraps tmsteph from the configured SEA pub", async () => {
  const portalAuth = loadPortalAuth();
  const harness = createGunHarness({
    graph: {
      "third-eye-print-co": {
        admins: {},
      },
    },
  });

  const access = await portalAuth.resolveAdminAccess({
    gun: harness.gun,
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

test("syncPortalAccount creates a member record for a new portal user", async () => {
  const portalAuth = loadPortalAuth();
  const harness = createGunHarness({
    graph: {
      "third-eye-print-co": {},
    },
  });

  const result = await portalAuth.syncPortalAccount({
    gun: harness.gun,
    namespace: "third-eye-print-co",
    alias: "alex",
    pub: "pub-alex",
    source: "portal_signup",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.read("third-eye-print-co/portalAccounts/alex@thirdeye"))), {
    alias: "alex@thirdeye",
    username: "alex",
    pub: "pub-alex",
    role: "member",
    status: "active",
    createdAt: result.record.createdAt,
    updatedAt: result.record.updatedAt,
    lastLogin: result.record.lastLogin,
    source: "portal_signup",
    archived: false,
    revoked: false,
  });
});

test("promotePortalAdmin upgrades a portal account and writes admin access nodes", async () => {
  const portalAuth = loadPortalAuth();
  const harness = createGunHarness({
    graph: {
      "third-eye-print-co": {
        portalAccounts: {
          "alex@thirdeye": {
            alias: "alex@thirdeye",
            username: "alex",
            pub: "pub-alex",
            role: "member",
            status: "active",
            createdAt: "2026-03-08T00:00:00.000Z",
            updatedAt: "2026-03-08T00:00:00.000Z",
            lastLogin: "2026-03-08T00:00:00.000Z",
            source: "portal_signup",
          },
        },
      },
    },
  });

  const result = await portalAuth.promotePortalAdmin({
    gun: harness.gun,
    namespace: "third-eye-print-co",
    actorAlias: "owner@thirdeye",
    targetIdentity: "alex",
  });

  assert.equal(result.ok, true);
  assert.equal(harness.read("third-eye-print-co/portalAccounts/alex@thirdeye").role, "admin");
  assert.equal(harness.read("third-eye-print-co/admins/alex@thirdeye").alias, "alex@thirdeye");
  assert.equal(harness.read("third-eye-print-co/admins/pub-alex").pub, "pub-alex");
});

test("resetPortalCredentials issues a new alias and archives the old account", async () => {
  const portalAuth = loadPortalAuth();
  const harness = createGunHarness({
    graph: {
      "third-eye-print-co": {
        portalAccounts: {
          "alex@thirdeye": {
            alias: "alex@thirdeye",
            username: "alex",
            pub: "pub-alex",
            role: "admin",
            status: "active",
            createdAt: "2026-03-08T00:00:00.000Z",
            updatedAt: "2026-03-08T00:00:00.000Z",
            lastLogin: "2026-03-08T00:00:00.000Z",
            source: "portal_signup",
          },
        },
        admins: {
          "alex@thirdeye": {
            alias: "alex@thirdeye",
            pub: "pub-alex",
            active: true,
          },
          "pub-alex": {
            alias: "alex@thirdeye",
            pub: "pub-alex",
            active: true,
          },
        },
      },
    },
    users: {
      "alex@thirdeye": {
        password: "old-password",
        pub: "pub-alex",
      },
    },
  });

  const result = await portalAuth.resetPortalCredentials({
    gun: harness.gun,
    namespace: "third-eye-print-co",
    actorAlias: "owner@thirdeye",
    currentIdentity: "alex",
    nextIdentity: "alex-new",
    tempPassword: "temp-pass-123",
  });

  assert.equal(result.ok, true);
  assert.equal(result.nextAlias, "alex-new@thirdeye");
  assert.equal(harness.userStore["alex-new@thirdeye"].password, "temp-pass-123");
  assert.equal(harness.read("third-eye-print-co/portalAccounts/alex@thirdeye").archived, true);
  assert.equal(harness.read("third-eye-print-co/portalAccounts/alex@thirdeye").recoveredTo, "alex-new@thirdeye");
  assert.equal(harness.read("third-eye-print-co/portalAccounts/alex-new@thirdeye").recoveredFrom, "alex@thirdeye");
  assert.equal(harness.read("third-eye-print-co/admins/alex@thirdeye").revoked, true);
  assert.equal(harness.read("third-eye-print-co/admins/alex-new@thirdeye").active, true);
});
