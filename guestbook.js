(() => {
  "use strict";
  const copy = JSON.parse(document.querySelector("#site-copy").textContent);
  const t = key => copy[key] || key;
  const form = document.querySelector("#guestbook-form");
  const list = document.querySelector("#guestbook-list");
  const status = document.querySelector("#guestbook-status");
  const feedback = document.querySelector("#guestbook-feedback");
  const send = document.querySelector("#guestbook-send");
  const authorPreview = document.querySelector("#guestbook-author-preview");
  const reroll = document.querySelector("#guestbook-reroll");
  const bodyField = form.elements.body;
  let token = "", widgetId;
  let authorName = "", registered = false;
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
      const author = document.createElement("strong");
      author.className = "guestbook-author";
      author.textContent = message.author_name || t("guest.legacyAuthor");
      const body = document.createElement("p");
      body.textContent = message.body;
      const time = document.createElement("time");
      time.dateTime = message.created_at;
      time.textContent = date(message.created_at);
      item.append(author, body, time);
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

  function showIdentity(data) {
    if (typeof data.author_name !== "string" || !data.author_name) throw new Error("identity_unavailable");
    authorName = data.author_name;
    registered = data.registered === true;
    authorPreview.textContent = authorName;
    reroll.hidden = false;
    reroll.disabled = false;
  }

  async function refreshIdentity(exclude = "") {
    const params = new URLSearchParams();
    if (exclude) params.set("exclude", exclude);
    const query = params.toString();
    const response = await fetch("/api/guestbook/identity" + (query ? "?" + query : ""), {
      cache: "no-store", credentials: "same-origin",
    });
    if (!response.ok) throw new Error("identity_unavailable");
    const data = await response.json();
    if (!data.enabled) throw new Error("identity_unavailable");
    showIdentity(data);
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
      await refreshIdentity();
      status.textContent = t("guest.open");
      form.hidden = false;
      startTurnstile(sitekey);
    } catch { status.textContent = t("guest.unavailable"); }
  }

  reroll.addEventListener("click", async () => {
    if (reroll.disabled) return;
    reroll.disabled = true;
    feedback.textContent = "";
    try {
      if (registered) {
        const response = await fetch("/api/guestbook/identity", {
          method: "POST", credentials: "same-origin", cache: "no-store",
        });
        const data = await response.json();
        if (!response.ok) {
          if (data.error === "nickname_changed") {
            await refreshIdentity();
            feedback.textContent = t("guest.nicknameSynced").replace("{author}", authorName);
            try { await load(); } catch { /* The identity has already been refreshed. */ }
            return;
          }
          throw new Error(data.error || "identity_unavailable");
        }
        showIdentity(data);
        try { await load(); } catch { /* Keep the successful nickname change visible. */ }
        feedback.textContent = t("guest.nicknameChanged").replace("{author}", authorName);
      } else {
        await refreshIdentity(authorName);
      }
    }
    catch { feedback.textContent = t("guest.identityUnavailable"); }
    finally { reroll.disabled = false; }
  });

  bodyField.addEventListener("keydown", event => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (!send.disabled) form.requestSubmit(send);
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const body = bodyField.value.trim();
    if (!body || [...body].length > 500) { feedback.textContent = t("guest.invalid"); return; }
    if (!token) { feedback.textContent = t("guest.verifyFirst"); return; }
    send.disabled = true;
    feedback.textContent = t("guest.sending");
    try {
      const response = await fetch("/api/guestbook", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, display_name: authorName, turnstile_token: token, source_type: sourceType, source_id: sourceId }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.error === "nickname_taken") {
          try { await refreshIdentity(authorName); } catch { /* Keep the old preview visible if refreshing fails. */ }
          feedback.textContent = t("guest.nicknameTaken");
          return;
        }
        throw new Error(result.error || "unavailable");
      }
      bodyField.value = "";
      authorName = result.author_name || authorName;
      registered = true;
      authorPreview.textContent = authorName;
      reroll.hidden = false;
      feedback.textContent = t("guest.sent").replace("{author}", result.author_name || t("guest.legacyAuthor"));
      window.RhodesAnalytics?.track("guestbook_submit", { context: "unknown" });
    } catch (error) {
      feedback.textContent = t(error.message === "verification_failed" ? "guest.verifyError" : error.message === "invalid_nickname" ? "guest.identityUnavailable" : "guest.sendFailed");
    } finally {
      token = "";
      if (widgetId !== undefined) window.turnstile?.reset(widgetId);
      send.disabled = false;
    }
  });
  init();
})();
