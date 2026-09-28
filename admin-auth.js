(() => {
  "use strict";
  const storageKey = "rhodes.admin.session-key";
  const destinations = {
    portal: "/admin.html",
    guestbook: "/guestbook-admin.html",
    analytics: "/analytics-admin.html",
  };

  function getKey() {
    try { return sessionStorage.getItem(storageKey) || ""; }
    catch { return ""; }
  }
  function setKey(key) {
    try { sessionStorage.setItem(storageKey, key); return true; }
    catch { return false; }
  }
  function clearKey() {
    try { sessionStorage.removeItem(storageKey); } catch { /* Storage can be disabled by the browser. */ }
  }
  async function verify(key) {
    if (typeof key !== "string" || key.length < 32 || key.length > 256) return { ok: false, status: 401 };
    try {
      const response = await fetch("/api/admin/session", {
        cache: "no-store", headers: { Authorization: "Bearer " + key },
      });
      return { ok: response.ok, status: response.status };
    } catch { return { ok: false, status: 0 }; }
  }
  function nextTarget() {
    const requested = new URLSearchParams(location.search).get("next");
    return Object.prototype.hasOwnProperty.call(destinations, requested) && requested !== "portal" ? requested : "";
  }
  function currentTarget() {
    const path = location.pathname.replace(/\.html$/, "");
    if (path.endsWith("/guestbook-admin")) return "guestbook";
    if (path.endsWith("/analytics-admin")) return "analytics";
    return "portal";
  }
  function redirectToPortal(target = currentTarget(), reason = "") {
    const parameters = new URLSearchParams();
    if (target && target !== "portal") parameters.set("next", target);
    if (reason) parameters.set("reason", reason);
    const query = parameters.toString();
    location.replace("/admin.html" + (query ? "?" + query : ""));
  }
  function activateNavigation() {
    const navigation = document.querySelector("#admin-navigation");
    if (!navigation) return;
    navigation.hidden = false;
    const active = currentTarget();
    navigation.querySelectorAll("[data-admin-target]").forEach(link => {
      if (link.dataset.adminTarget === active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }
  async function requireSession(target) {
    const key = getKey();
    if (!key) { redirectToPortal(target); return ""; }
    const result = await verify(key);
    if (!result.ok) {
      clearKey();
      redirectToPortal(target, result.status === 503 ? "not_configured" : "unauthorized");
      return "";
    }
    activateNavigation();
    return key;
  }
  function expireSession(target) {
    clearKey();
    redirectToPortal(target, "unauthorized");
  }

  document.querySelector("#admin-logout")?.addEventListener("click", () => {
    clearKey();
    location.replace("/admin.html?logged_out=1");
  });
  window.RhodesAdmin = { getKey, setKey, clearKey, verify, requireSession, expireSession, activateNavigation };
})();
