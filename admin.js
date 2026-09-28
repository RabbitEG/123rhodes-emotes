(() => {
  "use strict";
  const copy = JSON.parse(document.querySelector("#site-copy").textContent);
  const t = (key, values = {}) => (copy[key] || key).replace(/\{(\w+)\}/g, (_match, name) => String(values[name] ?? ""));
  const form = document.querySelector("#admin-login");
  const input = document.querySelector("#admin-key");
  const feedback = document.querySelector("#admin-feedback");
  const launcher = document.querySelector("#admin-launcher");
  const next = new URLSearchParams(location.search).get("next");
  const destination = { guestbook: "/guestbook-admin.html", analytics: "/analytics-admin.html" };

  function showWorkspace() {
    form.hidden = true;
    launcher.hidden = false;
    feedback.textContent = t("admin.connected");
    window.RhodesAdmin.activateNavigation();
  }
  async function authenticate(key) {
    feedback.textContent = t("admin.verifying");
    const result = await window.RhodesAdmin.verify(key);
    if (!result.ok) {
      if (result.status === 401) window.RhodesAdmin.clearKey();
      feedback.textContent = result.status === 503 ? t("admin.notConfigured")
        : result.status === 0 ? t("admin.unavailable") : t("admin.invalid");
      return;
    }
    if (!window.RhodesAdmin.setKey(key)) {
      feedback.textContent = t("admin.sessionStorageUnavailable");
      return;
    }
    input.value = "";
    if (destination[next]) {
      location.replace(destination[next]);
      return;
    }
    showWorkspace();
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const key = input.value.trim();
    if (key.length < 32 || key.length > 256) {
      feedback.textContent = t("admin.keyLength");
      return;
    }
    await authenticate(key);
  });

  const parameters = new URLSearchParams(location.search);
  if (parameters.get("logged_out") === "1") feedback.textContent = t("admin.loggedOut");
  else if (parameters.get("reason") === "not_configured") feedback.textContent = t("admin.notConfigured");
  else if (parameters.get("reason") === "unauthorized") feedback.textContent = t("admin.sessionExpired");

  const existingKey = window.RhodesAdmin.getKey();
  if (existingKey) authenticate(existingKey);
})();
