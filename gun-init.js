(function initThirdEyeGun(global) {
  const runtimeConfig = global.THIRD_EYE_CONFIG || {};

  function normalizeList(value) {
    return Array.isArray(value)
      ? value.map((entry) => String(entry || "").trim()).filter(Boolean)
      : [];
  }

  function getRelayUrls() {
    const configured = normalizeList(runtimeConfig.gunRelayUrls);
    const fallback = String(runtimeConfig.gunRelayUrl || "").trim();
    const merged = configured.length ? configured : (fallback ? [fallback] : []);
    return Array.from(new Set(merged));
  }

  function getAdminPubs() {
    return normalizeList(runtimeConfig.adminPubs);
  }

  function getNamespace() {
    return String(runtimeConfig.gunNamespace || "third-eye-print-co").trim() || "third-eye-print-co";
  }

  function createContext() {
    if (typeof global.Gun !== "function") {
      return {
        gun: null,
        user: null,
        root: null,
        peers: getRelayUrls(),
        namespace: getNamespace(),
      };
    }

    const peers = getRelayUrls();
    const gun = peers.length ? global.Gun({ peers }) : global.Gun();
    return {
      gun,
      user: typeof gun.user === "function" ? gun.user() : null,
      root: typeof gun.get === "function" ? gun.get(getNamespace()) : null,
      peers,
      namespace: getNamespace(),
    };
  }

  global.__GUN_PEERS__ = getRelayUrls();
  global.ThirdEyeGun = {
    config: runtimeConfig,
    createContext,
    getAdminPubs,
    getNamespace,
    getRelayUrls,
  };
})(typeof window !== "undefined" ? window : globalThis);
