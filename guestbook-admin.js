(() => {
  "use strict";
  const copy = JSON.parse(document.querySelector("#site-copy").textContent);
  const t = (key, values = {}) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), copy[key] || key);
  const login = document.querySelector("#moderator-login");
  const panel = document.querySelector("#moderator-panel");
  const list = document.querySelector("#moderator-list");
  const count = document.querySelector("#moderator-count");
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
    count.textContent = t("guest.adminCount", { count: data.messages.length });
    const table = document.createElement("table");
    table.className = "moderator-table";
    const head = document.createElement("thead");
    const headerRow = document.createElement("tr");
    for (const label of ["guest.adminId", "guest.adminTime", "guest.adminFirstNickname", "guest.adminCurrentNickname", "guest.adminBody", "guest.adminOrigin", "guest.adminStatus", "guest.adminActions"]) {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = t(label);
      headerRow.append(cell);
    }
    head.append(headerRow);
    const body = document.createElement("tbody");
    for (const message of data.messages) {
      const item = document.createElement("tr");
      item.className = "moderator-entry moderator-row-" + message.status;
      const shortId = (message.id || "").slice(0, 8);
      const idCell = document.createElement("td");
      const idValue = document.createElement("code");
      idValue.className = "moderator-id";
      idValue.textContent = shortId || "—";
      idValue.title = message.id || "";
      idCell.append(idValue);

      const timeCell = document.createElement("td");
      const time = document.createElement("time");
      time.dateTime = message.created_at;
      time.textContent = new Date(message.created_at).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
      timeCell.append(time);

      const visitorCell = document.createElement("td");
      visitorCell.className = "moderator-visitor-name";
      visitorCell.textContent = message.visitor_name || "—";
      const displayCell = document.createElement("td");
      displayCell.className = "moderator-display-name";
      displayCell.textContent = message.author_name || t("guest.legacyAuthor");

      const messageCell = document.createElement("td");
      messageCell.className = "moderator-body-cell";
      const messageBody = document.createElement("div");
      messageBody.className = "moderator-message-text";
      messageBody.textContent = message.body;
      messageCell.append(messageBody);

      const originCell = document.createElement("td");
      originCell.className = "moderator-meta";
      const originType = message.source_type === "instance" ? "guest.adminOriginInstance" : "guest.adminOriginHome";
      originCell.textContent = t(originType) + (message.source_type === "instance" && message.source_id ? " · " + message.source_id : "");

      const statusCell = document.createElement("td");
      const statusLabel = ({ pending: "guest.adminPending", approved: "guest.adminApprove", rejected: "guest.adminReject" })[message.status] || "guest.adminPending";
      const statusPill = document.createElement("span");
      statusPill.className = "moderator-status";
      statusPill.textContent = t(statusLabel);
      statusCell.append(statusPill);

      const actionCell = document.createElement("td");
      const actions = document.createElement("div");
      actions.className = "moderator-actions";
      for (const [value, label] of [["approved", "guest.adminApproveAction"], ["rejected", "guest.adminRejectAction"], ["pending", "guest.adminPendingAction"]]) {
        if (value === message.status) continue;
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = t(label);
        button.setAttribute("aria-label", t("guest.adminActionFor", { action: t(label), id: shortId }));
        button.addEventListener("click", async () => {
          actions.querySelectorAll("button").forEach(action => { action.disabled = true; });
          try { await request("POST", { id: message.id, status: value }); await load(); feedback.textContent = t("guest.adminSaved"); }
          catch (error) { feedback.textContent = error.message; actions.querySelectorAll("button").forEach(action => { action.disabled = false; }); }
        });
        actions.append(button);
      }
      actionCell.append(actions);
      item.append(idCell, timeCell, visitorCell, displayCell, messageCell, originCell, statusCell, actionCell);
      body.append(item);
    }
    if (!data.messages.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 8;
      cell.className = "moderator-empty";
      cell.textContent = t("guest.adminEmpty");
      row.append(cell);
      body.append(row);
    }
    table.append(head, body);
    list.append(table);
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
