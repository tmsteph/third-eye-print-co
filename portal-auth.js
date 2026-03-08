(function initThirdEyePortalAuth(global) {
  const STORAGE_KEYS = {
    alias: "thirdEyeAdminAlias",
    password: "thirdEyeAdminPassword",
    pub: "thirdEyeAdminPub",
  };
  const GRAPH_KEYS = {
    accounts: "portalAccounts",
    admins: "admins",
    recovery: "accountRecovery",
  };
  const BOOTSTRAP_ADMINS = [
    {
      aliases: ["tmsteph", "tmsteph@3dvr"],
      pub: "Cg-NVNIbxWPDBqX7OmllJQqjxy2t3KA_U2DqQBjcPQ8.1fppECqamDOHh2tKt1G5t8Yd21NjBCZ3C6qunST3lvg",
      username: "tmsteph",
    },
  ];

  function normalizeIdentity(value) {
    return String(value || "").trim();
  }

  function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function normalizeAlias(value) {
    return normalizeIdentity(value).toLowerCase();
  }

  function normalizePub(value) {
    return normalizeIdentity(value);
  }

  function normalizePortalAlias(identity, fallbackDomain = "@thirdeye") {
    const normalized = normalizeIdentity(identity);
    if (!normalized) {
      return "";
    }

    return normalized.includes("@") ? normalized : `${normalized}${fallbackDomain}`;
  }

  function aliasToUsername(alias) {
    const normalized = normalizeIdentity(alias);
    if (!normalized) {
      return "";
    }

    return normalized.includes("@") ? normalized.split("@")[0] : normalized;
  }

  function hasTruthyRecord(value) {
    if (!value) {
      return false;
    }

    if (typeof value === "object") {
      return Object.keys(value).length > 0;
    }

    return Boolean(value);
  }

  function isActiveAdminRecord(value) {
    if (!hasTruthyRecord(value)) {
      return false;
    }

    if (typeof value !== "object") {
      return true;
    }

    return value.active !== false && !value.archived && !value.revoked;
  }

  function findBootstrapAdmin({ alias, pub }) {
    const normalizedAlias = normalizeAlias(alias);
    const normalizedPub = normalizePub(pub);

    return BOOTSTRAP_ADMINS.find((entry) => {
      const aliasMatch = entry.aliases.some((candidate) => normalizeAlias(candidate) === normalizedAlias);
      if (!aliasMatch) {
        return false;
      }

      return !entry.pub || normalizePub(entry.pub) === normalizedPub;
    }) || null;
  }

  function buildAliasCandidates(identity) {
    const normalized = normalizeIdentity(identity);
    if (!normalized) {
      return [];
    }

    if (normalized.includes("@")) {
      return [normalized];
    }

    return unique([
      `${normalized}@thirdeye`,
      `${normalized}@3dvr`,
      normalized,
    ]);
  }

  function buildAccountLookupCandidates(identity) {
    const normalized = normalizeIdentity(identity);
    if (!normalized) {
      return [];
    }

    if (normalized.includes("@")) {
      return [normalized];
    }

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

  function put(node, value) {
    return new Promise((resolve) => {
      if (!node || typeof node.put !== "function") {
        resolve({ ok: false, error: "Node is not writable." });
        return;
      }

      node.put(value, (ack) => {
        if (ack && ack.err) {
          resolve({ ok: false, error: String(ack.err) });
          return;
        }

        resolve({ ok: true, ack: ack || {} });
      });
    });
  }

  function getNamespaceRoot(gun, namespace) {
    if (!gun || typeof gun.get !== "function") {
      return null;
    }

    return gun.get(namespace);
  }

  function getAdminsRoot(gun, namespace) {
    const root = getNamespaceRoot(gun, namespace);
    return root && typeof root.get === "function" ? root.get(GRAPH_KEYS.admins) : null;
  }

  function getAccountsRoot(gun, namespace) {
    const root = getNamespaceRoot(gun, namespace);
    return root && typeof root.get === "function" ? root.get(GRAPH_KEYS.accounts) : null;
  }

  function getRecoveryRoot(gun, namespace) {
    const root = getNamespaceRoot(gun, namespace);
    return root && typeof root.get === "function" ? root.get(GRAPH_KEYS.recovery) : null;
  }

  async function readPortalAccount({ gun, namespace = "third-eye-print-co", identity }) {
    const accountsRoot = getAccountsRoot(gun, namespace);
    if (!accountsRoot || typeof accountsRoot.get !== "function") {
      return null;
    }

    const candidates = buildAccountLookupCandidates(identity);
    for (const candidate of candidates) {
      const value = await once(accountsRoot.get(candidate));
      if (hasTruthyRecord(value)) {
        return {
          alias: candidate,
          record: value,
        };
      }
    }

    return null;
  }

  function buildBootstrapAdminRecord(entry, alias, pub) {
    const normalizedAlias = normalizeIdentity(alias);
    const username = normalizeIdentity(entry && entry.username)
      || aliasToUsername(normalizedAlias)
      || "admin";

    return {
      alias: normalizedAlias,
      username,
      pub: normalizePub(pub),
      addedAt: nowIso(),
      addedBy: "bootstrap",
      source: "bootstrap_identity",
      active: true,
      archived: false,
      revoked: false,
    };
  }

  function buildPortalAccountRecord(existing, {
    alias,
    pub,
    role,
    status = "active",
    source = "",
    lastLoginAt = "",
    extra = {},
  } = {}) {
    const base = existing && typeof existing === "object" ? existing : {};
    const normalizedAlias = normalizePortalAlias(alias) || normalizeIdentity(base.alias);
    const timestamp = nowIso();

    return {
      ...base,
      ...extra,
      alias: normalizedAlias,
      username: normalizeIdentity(extra.username)
        || normalizeIdentity(base.username)
        || aliasToUsername(normalizedAlias),
      pub: normalizePub(pub) || normalizePub(base.pub),
      role: normalizeIdentity(role) || normalizeIdentity(base.role) || "member",
      status: normalizeIdentity(status) || normalizeIdentity(base.status) || "active",
      createdAt: normalizeIdentity(base.createdAt) || timestamp,
      updatedAt: timestamp,
      lastLogin: normalizeIdentity(lastLoginAt) || normalizeIdentity(base.lastLogin) || timestamp,
      source: normalizeIdentity(source) || normalizeIdentity(base.source) || "portal_account",
      archived: false,
      revoked: false,
    };
  }

  async function syncPortalAccount({
    gun,
    namespace = "third-eye-print-co",
    alias,
    pub,
    role = "",
    source = "portal_signin",
    lastLoginAt = "",
  }) {
    const normalizedAlias = normalizePortalAlias(alias);
    const accountsRoot = getAccountsRoot(gun, namespace);
    if (!accountsRoot || !normalizedAlias) {
      return { ok: false, error: "Portal account graph is unavailable." };
    }

    const existing = await once(accountsRoot.get(normalizedAlias));
    const record = buildPortalAccountRecord(existing, {
      alias: normalizedAlias,
      pub,
      role,
      source,
      lastLoginAt,
    });
    const writeResult = await put(accountsRoot.get(normalizedAlias), record);

    return writeResult.ok
      ? { ok: true, record }
      : { ok: false, error: writeResult.error || "Could not save portal account metadata." };
  }

  function buildAdminRecord({
    alias,
    pub,
    username,
    addedBy,
    source = "admin_promotion",
    extra = {},
  }) {
    const normalizedAlias = normalizeIdentity(alias);

    return {
      ...extra,
      alias: normalizedAlias,
      username: normalizeIdentity(username) || aliasToUsername(normalizedAlias),
      pub: normalizePub(pub),
      addedAt: nowIso(),
      addedBy: normalizeIdentity(addedBy) || "admin",
      source,
      active: true,
      archived: false,
      revoked: false,
    };
  }

  async function writeAdminAccess({
    gun,
    namespace = "third-eye-print-co",
    alias,
    pub,
    username,
    addedBy,
    source = "admin_promotion",
  }) {
    const adminsRoot = getAdminsRoot(gun, namespace);
    if (!adminsRoot || !normalizeIdentity(alias)) {
      return { ok: false, error: "Admin graph is unavailable." };
    }

    const record = buildAdminRecord({ alias, pub, username, addedBy, source });
    const writes = [put(adminsRoot.get(record.alias), record)];

    if (record.pub) {
      writes.push(put(adminsRoot.get(record.pub), record));
    }

    const results = await Promise.all(writes);
    const failed = results.find((result) => !result.ok);

    return failed
      ? { ok: false, error: failed.error || "Could not save admin access." }
      : { ok: true, record };
  }

  async function revokeAdminAccess({
    gun,
    namespace = "third-eye-print-co",
    alias,
    pub,
    replacedBy = "",
    revokedBy = "",
  }) {
    const adminsRoot = getAdminsRoot(gun, namespace);
    const normalizedAlias = normalizeIdentity(alias);
    const normalizedPub = normalizePub(pub);
    if (!adminsRoot || (!normalizedAlias && !normalizedPub)) {
      return { ok: false, error: "Admin graph is unavailable." };
    }

    const record = {
      alias: normalizedAlias,
      username: aliasToUsername(normalizedAlias),
      pub: normalizedPub,
      active: false,
      archived: true,
      revoked: true,
      replacedBy: normalizeIdentity(replacedBy),
      replacedAt: nowIso(),
      updatedAt: nowIso(),
      source: "account_recovery",
      addedBy: normalizeIdentity(revokedBy) || "admin",
    };
    const writes = [];

    if (normalizedAlias) {
      writes.push(put(adminsRoot.get(normalizedAlias), record));
    }

    if (normalizedPub) {
      writes.push(put(adminsRoot.get(normalizedPub), record));
    }

    const results = await Promise.all(writes);
    const failed = results.find((result) => !result.ok);

    return failed
      ? { ok: false, error: failed.error || "Could not revoke admin access." }
      : { ok: true, record };
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
      { mode: "site_alias", node: gun.get(namespace).get(GRAPH_KEYS.admins).get(alias) },
      { mode: "site_pub", node: pub ? gun.get(namespace).get(GRAPH_KEYS.admins).get(pub) : null },
    ];

    for (const check of checks) {
      if (!check.node) {
        continue;
      }

      const value = await once(check.node);
      if (isActiveAdminRecord(value)) {
        return { ok: true, mode: check.mode, pub, alias };
      }
    }

    const bootstrapAdmin = findBootstrapAdmin({ alias, pub });
    if (bootstrapAdmin) {
      return { ok: true, mode: "bootstrap_identity", pub, alias };
    }

    return { ok: false, mode: "none", pub, alias };
  }

  async function ensureBootstrapAdminAccess({ gun, alias, pub, namespace = "third-eye-print-co" }) {
    const bootstrapAdmin = findBootstrapAdmin({ alias, pub });
    if (!bootstrapAdmin || !gun || typeof gun.get !== "function") {
      return { ok: false, mode: "skipped" };
    }

    return writeAdminAccess({
      gun,
      namespace,
      alias,
      pub,
      username: bootstrapAdmin.username,
      addedBy: "bootstrap",
      source: "bootstrap_identity",
    });
  }

  async function promotePortalAdmin({
    gun,
    namespace = "third-eye-print-co",
    actorAlias = "",
    targetIdentity,
    targetPub = "",
  }) {
    const current = await readPortalAccount({ gun, namespace, identity: targetIdentity });
    const alias = current && current.alias
      ? current.alias
      : normalizePortalAlias(targetIdentity);

    if (!alias) {
      return { ok: false, error: "Enter a valid username or alias to promote." };
    }

    const pub = normalizePub(targetPub) || normalizePub(current && current.record ? current.record.pub : "");
    const accountResult = await syncPortalAccount({
      gun,
      namespace,
      alias,
      pub,
      role: "admin",
      source: "admin_promotion",
      lastLoginAt: current && current.record ? current.record.lastLogin : "",
    });
    if (!accountResult.ok) {
      return accountResult;
    }

    const promotedRecord = {
      ...accountResult.record,
      role: "admin",
      promotedAt: nowIso(),
      promotedBy: normalizeIdentity(actorAlias) || "admin",
      updatedAt: nowIso(),
    };
    const accountsRoot = getAccountsRoot(gun, namespace);
    const accountWrite = await put(accountsRoot.get(alias), promotedRecord);
    if (!accountWrite.ok) {
      return { ok: false, error: accountWrite.error || "Could not update the account role." };
    }

    const adminResult = await writeAdminAccess({
      gun,
      namespace,
      alias,
      pub,
      username: promotedRecord.username,
      addedBy: actorAlias,
      source: "admin_promotion",
    });

    return adminResult.ok
      ? { ok: true, record: promotedRecord, adminRecord: adminResult.record }
      : adminResult;
  }

  async function resetPortalCredentials({
    gun,
    namespace = "third-eye-print-co",
    actorAlias = "",
    currentIdentity,
    nextIdentity,
    tempPassword,
  }) {
    const current = await readPortalAccount({ gun, namespace, identity: currentIdentity });
    if (!current || !current.record) {
      return { ok: false, error: "No portal account metadata was found for that user." };
    }

    const currentAlias = current.alias;
    const nextAlias = normalizePortalAlias(nextIdentity);
    const password = normalizeIdentity(tempPassword);
    if (!nextAlias) {
      return { ok: false, error: "Add the new username or alias you want to issue." };
    }
    if (!password || password.length < 6) {
      return { ok: false, error: "Use a temporary password with at least 6 characters." };
    }
    if (currentAlias === nextAlias) {
      return { ok: false, error: "Choose a new username so a fresh alias can be created." };
    }
    if (!gun || typeof gun.user !== "function") {
      return { ok: false, error: "Gun is unavailable. Reload the page and try again." };
    }

    const creationUser = gun.user();
    if (!creationUser || typeof creationUser.create !== "function") {
      return { ok: false, error: "Gun user creation is unavailable. Reload and try again." };
    }

    const creationAck = await new Promise((resolve) => {
      try {
        creationUser.create(nextAlias, password, (ack) => resolve(ack || {}));
      } catch (error) {
        resolve({ err: error && error.message ? error.message : "account-creation-failed" });
      }
    });

    if (creationAck && creationAck.err) {
      const message = String(creationAck.err || "").includes("User already created")
        ? "That new username already exists. Pick a different username."
        : `Could not create the new account: ${creationAck.err}`;
      return { ok: false, error: message };
    }

    let nextPub = "";
    const authAck = await authOnce(creationUser, nextAlias, password);
    if (!authAck.err && creationUser && creationUser.is && creationUser.is.pub) {
      nextPub = creationUser.is.pub;
    }
    leaveUser(creationUser);

    const currentRecord = current.record;
    const role = normalizeIdentity(currentRecord.role) || "member";
    const issuedAt = nowIso();
    const accountsRoot = getAccountsRoot(gun, namespace);
    const recoveryRoot = getRecoveryRoot(gun, namespace);
    const adminsRoot = getAdminsRoot(gun, namespace);

    const nextRecord = buildPortalAccountRecord(currentRecord, {
      alias: nextAlias,
      pub: nextPub || currentRecord.pub,
      role,
      source: "account_recovery",
      lastLoginAt: currentRecord.lastLogin || "",
      extra: {
        username: aliasToUsername(nextAlias),
        recoveredFrom: currentAlias,
        recoveredAt: issuedAt,
        recoveredBy: normalizeIdentity(actorAlias) || "admin",
      },
    });
    const archivedRecord = {
      ...currentRecord,
      alias: currentAlias,
      username: normalizeIdentity(currentRecord.username) || aliasToUsername(currentAlias),
      pub: normalizePub(currentRecord.pub),
      role,
      status: "archived",
      archived: true,
      updatedAt: issuedAt,
      recoveredTo: nextAlias,
      recoveredAt: issuedAt,
      recoveredBy: normalizeIdentity(actorAlias) || "admin",
    };

    const writes = [
      put(accountsRoot.get(nextAlias), nextRecord),
      put(accountsRoot.get(currentAlias), archivedRecord),
    ];

    if (recoveryRoot) {
      writes.push(put(recoveryRoot.get(`${currentAlias}-${Date.now()}`), {
        currentAlias,
        nextAlias,
        issuedAt,
        issuedBy: normalizeIdentity(actorAlias) || "admin",
      }));
    }

    const oldAliasAdmin = adminsRoot ? await once(adminsRoot.get(currentAlias)) : null;
    const oldPubAdmin = adminsRoot && currentRecord.pub
      ? await once(adminsRoot.get(currentRecord.pub))
      : null;
    const shouldCarryAdmin = role === "admin"
      || isActiveAdminRecord(oldAliasAdmin)
      || isActiveAdminRecord(oldPubAdmin);

    if (shouldCarryAdmin) {
      nextRecord.role = "admin";
      nextRecord.promotedAt = normalizeIdentity(currentRecord.promotedAt) || issuedAt;
      nextRecord.promotedBy = normalizeIdentity(currentRecord.promotedBy)
        || normalizeIdentity(actorAlias)
        || "admin";
      writes.push(put(accountsRoot.get(nextAlias), nextRecord));
      writes.push(writeAdminAccess({
        gun,
        namespace,
        alias: nextAlias,
        pub: nextPub || currentRecord.pub,
        username: nextRecord.username,
        addedBy: actorAlias,
        source: "account_recovery",
      }).then((result) => result.ok ? { ok: true } : result));
      writes.push(revokeAdminAccess({
        gun,
        namespace,
        alias: currentAlias,
        pub: currentRecord.pub,
        replacedBy: nextAlias,
        revokedBy: actorAlias,
      }).then((result) => result.ok ? { ok: true } : result));
    }

    const results = await Promise.all(writes);
    const failed = results.find((result) => result && result.ok === false);
    if (failed) {
      return { ok: false, error: failed.error || "Could not finish the account recovery flow." };
    }

    return {
      ok: true,
      currentAlias,
      nextAlias,
      nextPub,
      tempPassword: password,
      record: nextRecord,
    };
  }

  global.ThirdEyePortalAuth = {
    BOOTSTRAP_ADMINS,
    GRAPH_KEYS,
    STORAGE_KEYS,
    aliasToUsername,
    authenticateUser,
    buildAliasCandidates,
    clearStoredCredentials,
    createUser,
    ensureBootstrapAdminAccess,
    findBootstrapAdmin,
    leaveUser,
    normalizePortalAlias,
    promotePortalAdmin,
    readPortalAccount,
    readStoredCredentials,
    resetPortalCredentials,
    resolveAdminAccess,
    syncPortalAccount,
    writeStoredCredentials,
  };
})(typeof window !== "undefined" ? window : globalThis);
