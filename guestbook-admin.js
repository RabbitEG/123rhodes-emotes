(() => {
  "use strict";
  const copy = JSON.parse(document.querySelector("#site-copy").textContent);
  const t = key => copy[key] || key;
  const login = document.querySelector("#moderator-login");
  const panel = document.querySelector("#moderator-panel");
  const list = document.querySelector("#moderator-list");
  const feedback = document.querySelector("#moderator-feedback");
  const filter = document.querySelector("#moderator-filter");
  let key = "";

  async function request(method, body) {
    const response = await fetch("/api/guestbook/admin" + (method === "GET" ? "?status=" + filter.value : ""), {
      method, cache: "no-store",
      headers: { "Authorization": "Bearer " + key, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw new Error(response.status === 401 ? t("guest.adminUnauthorized") : t("guest.unavailable"));
    return response.json();
  }

  async function load() {
    const data = await request("GET");
    list.replaceChildren();
    for (const message of data.messages) {
      const item = document.createElement("article");
      item.className = "guestbook-entry moderator-entry";
      const author = document.createElement("strong");
      author.className = "guestbook-author";
      const messageName = message.author_name || t("guest.legacyAuthor");
      const visitorName = message.visitor_name;
      author.textContent = visitorName
        ? t("guest.adminFirstNickname") + " " + visitorName + " → " + t("guest.adminCurrentNickname") + " " + messageName
        : messageName;
      const body = document.createElement("p");
      body.textContent = message.body;
      const time = document.createElement("time");
      time.dateTime = message.created_at;
      time.textContent = new Date(message.created_at).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
      const meta = document.createElement("div");
      meta.className = "moderator-meta";
      const statusLabel = ({ pending: "guest.adminPending", approved: "guest.adminApprove", rejected: "guest.adminReject" })[message.status] || "guest.adminPending";
      const statusPill = document.createElement("span");
      statusPill.className = "moderator-status";
      statusPill.textContent = t("guest.adminStatus") + "：" + t(statusLabel);
      const origin = document.createElement("span");
      const originType = message.source_type === "instance" ? "guest.adminOriginInstance" : "guest.adminOriginHome";
      origin.textContent = t("guest.adminOrigin") + "：" + t(originType) + (message.source_type === "instance" && message.source_id ? " · " + message.source_id : "");
      meta.append(statusPill, origin);
      const actions = document.createElement("div");
      actions.className = "moderator-actions";
      for (const [value, label] of [["approved", "guest.adminApproveAction"], ["rejected", "guest.adminRejectAction"], ["pending", "guest.adminPendingAction"]]) {
        if (value === message.status) continue;
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = t(label);
        button.addEventListener("click", async () => {
          button.disabled = true;
          try { await request("POST", { id: message.id, status: value }); await load(); feedback.textContent = t("guest.adminSaved"); }
          catch (error) { feedback.textContent = error.message; button.disabled = false; }
        });
        actions.append(button);
      }
      item.append(author, body, meta, time, actions);
      list.append(item);
    }
    if (!data.messages.length) list.textContent = t("guest.adminEmpty");
  }

  login.addEventListener("submit", async event => {
    event.preventDefault();
    key = login.elements.key.value;
    login.elements.key.value = "";
    try { await load(); login.hidden = true; panel.hidden = false; feedback.textContent = ""; }
    catch (error) { key = ""; feedback.textContent = error.message; }
  });
  filter.addEventListener("change", async () => {
    try { await load(); feedback.textContent = ""; }
    catch (error) { feedback.textContent = error.message; }
  });
})();
