(() => {
  "use strict";
  const copy = JSON.parse(document.querySelector("#site-copy").textContent);
  const t = key => copy[key] || key;
  const form = document.querySelector("#guestbook-form");
  const list = document.querySelector("#guestbook-list");
  const status = document.querySelector("#guestbook-status");
  const feedback = document.querySelector("#guestbook-feedback");
  const send = document.querySelector("#guestbook-send");
  let token = "", widgetId;
  const sourceType = document.body.dataset.page === "instance" ? "instance" : "home";
  const sourceId = sourceType === "instance" ? new URLSearchParams(location.search).get("id") || "" : "";

  function date(value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
  }

  function render(messages) {
    list.replaceChildren();
    for (const message of messages) {
      const item = document.createElement("article");
      item.className = "guestbook-entry";
      const body = document.createElement("p");
      body.textContent = message.body;
      const time = document.createElement("time");
      time.dateTime = message.created_at;
      time.textContent = date(message.created_at);
      item.append(body, time);
      list.append(item);
    }
    if (!list.children.length) {
      const empty = document.createElement("p");
      empty.className = "guestbook-empty";
      empty.textContent = t("guest.empty");
      list.append(empty);
    }
  }

  async function load() {
    const params = new URLSearchParams();
    if (sourceType === "instance") {
      params.set("source_type", "instance");
      params.set("source_id", sourceId);
    }
    const query = params.toString();
    const response = await fetch("/api/guestbook" + (query ? "?" + query : ""), { cache: "no-store" });
    if (!response.ok) throw new Error("guestbook unavailable");
    const data = await response.json();
    render((data.messages || []).slice(0, 10));
    return data.enabled;
  }

  function startTurnstile(sitekey) {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => {
      if (!window.turnstile) return;
      widgetId = window.turnstile.render("#guestbook-turnstile", {
        sitekey,
        callback: value => { token = value; },
        "expired-callback": () => { token = ""; },
        "error-callback": () => { token = ""; feedback.textContent = t("guest.verifyError"); },
      });
    };
    script.onerror = () => { feedback.textContent = t("guest.verifyError"); };
    document.head.append(script);
  }

  async function init() {
    try {
      const [configResponse, enabled] = await Promise.all([
        fetch("/config/site.json", { cache: "no-cache" }), load(),
      ]);
      const sitekey = configResponse.ok ? (await configResponse.json()).guestbook?.turnstileSiteKey : "";
      if (!enabled || typeof sitekey !== "string" || !sitekey.trim()) {
        status.textContent = t("guest.status");
        if (list.firstElementChild?.classList.contains("guestbook-empty")) list.replaceChildren();
        return;
      }
      status.textContent = t("guest.open");
      form.hidden = false;
      startTurnstile(sitekey);
    } catch { status.textContent = t("guest.unavailable"); }
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const body = form.elements.body.value.trim();
    if (!body || [...body].length > 500) { feedback.textContent = t("guest.invalid"); return; }
    if (!token) { feedback.textContent = t("guest.verifyFirst"); return; }
    send.disabled = true;
    feedback.textContent = t("guest.sending");
    try {
      const response = await fetch("/api/guestbook", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, turnstile_token: token, source_type: sourceType, source_id: sourceId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "unavailable");
      form.elements.body.value = "";
      feedback.textContent = t("guest.sent");
      window.RhodesAnalytics?.track("guestbook_submit", { context: "unknown" });
    } catch (error) {
      feedback.textContent = t(error.message === "verification_failed" ? "guest.verifyError" : "guest.sendFailed");
    } finally {
      token = "";
      if (widgetId !== undefined) window.turnstile?.reset(widgetId);
      send.disabled = false;
    }
  });
  init();
})();
