(function initThirdEyePortalAuth(global) {
  const STORAGE_KEYS = {
    alias: "thirdEyeAdminAlias",
    password: "thirdEyeAdminPassword",
    pub: "thirdEyeAdminPub",
  };
  const BOOTSTRAP_ADMIN_ALIASES = [
    "tmsteph",
    "tmsteph@3dvr",
  ];

  function normalizeIdentity(value) {
    return String(value || "").trim();
  }

  function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
  }

  function isBootstrapAdminAlias(alias) {
    return BOOTSTRAP_ADMIN_ALIASES.includes(normalizeIdentity(alias).toLowerCase());
  }

  function buildAliasCandidates(identity) {
    const normalized = normalizeIdentity(identity);
    if (!normalized) {
      return [];
    }

    if (normalized.includes("@")) {
      return [normalized];
    }

    // Prefer canonical site aliases before falling back to a legacy bare alias.
    return unique([
      `${normalized}@thirdeye`,
      `${normalized}@3dvr`,
      normalized,
    ]);
  }

  function readStoredCredentials() {
    return {
      alias: global.localStorage.getItem(STORAGE_KEYS.alias) || "",
      password: global.localStorage.getItem(STORAGE_KEYS.password) || "",
      pub: global.localStorage.getItem(STORAGE_KEYS.pub) || "",
    };
  }

  function writeStoredCredentials(alias, password, pub) {
    global.localStorage.setItem(STORAGE_KEYS.alias, alias);
    global.localStorage.setItem(STORAGE_KEYS.password, password);
    if (pub) {
      global.localStorage.setItem(STORAGE_KEYS.pub, pub);
    }
  }

  function clearStoredCredentials() {
    Object.values(STORAGE_KEYS).forEach((key) => global.localStorage.removeItem(key));
  }

  function leaveUser(user) {
    if (user && typeof user.leave === "function") {
      user.leave();
    }
  }

  function authOnce(user, alias, password) {
    return new Promise((resolve) => {
      user.auth(alias, password, (ack) => resolve(ack || {}));
    });
  }

  async function authenticateUser(user, identity, password) {
    const candidates = buildAliasCandidates(identity);
    if (!user || typeof user.auth !== "function" || !candidates.length) {
      return {
        ok: false,
        error: "Enter a valid username or Gun alias.",
        alias: "",
        pub: "",
      };
    }

    let lastError = "Authentication failed.";
    for (const candidate of candidates) {
      leaveUser(user);
      const ack = await authOnce(user, candidate, password);
      if (!ack.err) {
        return {
          ok: true,
          alias: candidate,
          pub: user && user.is ? user.is.pub || "" : "",
          ack,
        };
      }

      lastError = String(ack.err || lastError);
    }

    return {
      ok: false,
      error: lastError,
      alias: candidates[0] || "",
      pub: "",
    };
  }

  function createUser(user, identity, password) {
    const normalized = normalizeIdentity(identity);
    const alias = normalized.includes("@") ? normalized : `${normalized}@thirdeye`;
    if (!user || typeof user.create !== "function" || !alias) {
      return Promise.resolve({
        ok: false,
        error: "Enter a valid username or Gun alias.",
        alias: "",
      });
    }

    return new Promise((resolve) => {
      user.create(alias, password, (ack) => {
        resolve({
          ok: !ack?.err || String(ack.err).includes("User already created"),
          error: ack?.err ? String(ack.err) : "",
          alias,
          ack: ack || {},
        });
      });
    });
  }

  function once(node) {
    return new Promise((resolve) => {
      if (!node || typeof node.once !== "function") {
        resolve(null);
        return;
      }

      node.once((data) => resolve(data || null));
    });
  }

  async function resolveAdminAccess({ gun, user, alias, adminPubs = [], namespace = "third-eye-print-co" }) {
    const pub = user && user.is ? user.is.pub || "" : "";
    if (pub && adminPubs.includes(pub)) {
      return { ok: true, mode: "pub", pub, alias };
    }

    if (!gun || typeof gun.get !== "function" || !alias) {
      return { ok: false, mode: "none", pub, alias };
    }

    const checks = [
      { mode: "site_alias", node: gun.get(namespace).get("admins").get(alias) },
      { mode: "site_pub", node: pub ? gun.get(namespace).get("admins").get(pub) : null },
    ];

    if (isBootstrapAdminAlias(alias)) {
      checks.push({
        mode: "bootstrap_portal_alias",
        node: gun.get("3dvr-portal").get("admins").get(alias),
      });
    }

    for (const check of checks) {
      if (!check.node) {
        continue;
      }

      const value = await once(check.node);
      if (value && typeof value === "object" ? Object.keys(value).length : value) {
        return { ok: true, mode: check.mode, pub, alias };
      }
    }

    return { ok: false, mode: "none", pub, alias };
  }

  global.ThirdEyePortalAuth = {
    BOOTSTRAP_ADMIN_ALIASES,
    STORAGE_KEYS,
    authenticateUser,
    buildAliasCandidates,
    clearStoredCredentials,
    createUser,
    leaveUser,
    readStoredCredentials,
    resolveAdminAccess,
    writeStoredCredentials,
  };
})(typeof window !== "undefined" ? window : globalThis);
