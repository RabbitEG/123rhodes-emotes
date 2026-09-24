(() => {
  "use strict";
  const copy = JSON.parse(document.querySelector("#site-copy").textContent);
  const t = (key, values = {}) => (copy[key] || key).replace(/\{(\w+)\}/g, (_match, name) => String(values[name] ?? ""));
  const login = document.querySelector("#analytics-login");
  const panel = document.querySelector("#analytics-panel");
  const feedback = document.querySelector("#analytics-feedback");
  const days = document.querySelector("#analytics-days");
  let key = "";
  let catalogs = { instances: new Map(), characters: new Map(), episodes: new Map() };

  function number(value) { return (Number(value) || 0).toLocaleString("zh-CN"); }
  function node(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined && text !== null) item.textContent = String(text);
    return item;
  }
  function table(container, headings, rows, emptyText) {
    container.replaceChildren();
    if (!rows.length) { container.append(node("p", "analytics-empty", emptyText)); return; }
    const result = node("table", "analytics-table");
    const thead = node("thead"), header = node("tr");
    headings.forEach((heading, index) => header.append(node("th", index > 0 ? "numeric" : "", heading)));
    thead.append(header); result.append(thead);
    const tbody = node("tbody");
    rows.forEach(row => {
      const tr = node("tr");
      row.forEach((value, index) => {
        const cell = node("td", index > 0 && typeof value !== "object" ? "numeric" : "");
        if (value instanceof Node) cell.append(value);
        else cell.textContent = value === null || value === undefined ? "—" : String(value);
        tr.append(cell);
      });
      tbody.append(tr);
    });
    result.append(tbody); container.append(result);
  }
  function entityLabel(type, id) {
    if (!id) return "—";
    if (type === "instance") {
      const item = catalogs.instances.get(id);
      if (!item) return id;
      const character = catalogs.characters.get(item.character_id)?.name || item.character_id;
      const episode = catalogs.episodes.get(item.episode_id)?.name || item.episode_id;
      return `${character} · ${episode}`;
    }
    return catalogs[type === "character" ? "characters" : "episodes"].get(id)?.name || id;
  }
  async function loadCatalogs() {
    try {
      const response = await fetch("/data/release.json", { cache: "no-cache" });
      if (!response.ok) return;
      const release = await response.json();
      catalogs = {
        instances: new Map((release.instances || []).map(item => [String(item.id), item])),
        characters: new Map((release.characters || []).map(item => [String(item.id), item])),
        episodes: new Map((release.episodes || []).map(item => [String(item.id), item])),
      };
    } catch { /* IDs remain visible if the public release is temporarily unavailable. */ }
  }
  async function requestReport() {
    const response = await fetch("/api/analytics/admin?days=" + encodeURIComponent(days.value), {
      cache: "no-store", headers: { Authorization: "Bearer " + key },
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) throw new Error(t("analytics.unauthorized"));
      if (response.status === 503 || data.error === "not_configured") throw new Error(t("analytics.notConfigured"));
      throw new Error(t("analytics.failed"));
    }
    return response.json();
  }
  function renderKpis(data) {
    const totals = data.totals || {};
    const all = data.all_time_totals || {};
    const zeroSearches = (data.searches || []).filter(item => item.result_bucket === "zero").reduce((sum, item) => sum + Number(item.count || 0), 0);
    const cards = [
      [t("analytics.pageViews"), number(totals.page_view)],
      [t("analytics.searchesCount"), number((totals.search_submit || 0) + (totals.suggestion_select || 0))],
      [t("analytics.detailOpens"), number(totals.instance_open)],
      [t("analytics.sourceClicks"), number(totals.source_click)],
      [t("analytics.zeroResults"), number(zeroSearches)],
      [t("analytics.releaseErrors"), number(totals.release_error)],
      [t("analytics.sessions"), `${number(data.unique_sessions)} · ${number(data.unique_sessions_days)} ${t("analytics.daysSuffix")}`],
      [t("analytics.allTimeViews"), number(all.page_view)],
      [t("analytics.allTimeDetailOpens"), number(all.instance_open)],
    ];
    const root = document.querySelector("#analytics-kpis");
    root.replaceChildren();
    for (const [label, value] of cards) {
      const card = node("article", "analytics-kpi");
      card.append(node("strong", "", value), node("span", "", label)); root.append(card);
    }
  }
  function renderInstances(target, rows) {
    table(target, [t("analytics.instance"), t("analytics.character"), t("analytics.episode"), t("analytics.opens"), t("analytics.impressions"), t("analytics.clicks")], rows.map(item => {
      const link = node("a", "analytics-instance-link", entityLabel("instance", item.id));
      link.href = "/instance.html?id=" + encodeURIComponent(item.id);
      link.target = "_blank"; link.rel = "noopener noreferrer";
      return [link, entityLabel("character", item.character_id), entityLabel("episode", item.episode_id), number(item.opens), number(item.impressions), number(item.clicks)];
    }), t("analytics.empty"));
  }
  function render(data) {
    document.querySelector("#analytics-generated").textContent = t("analytics.generated", { time: new Date(data.generated_at).toLocaleString("zh-CN") });
    renderKpis(data);
    renderInstances(document.querySelector("#analytics-instances"), data.top_instances || []);
    renderInstances(document.querySelector("#analytics-all-instances"), data.all_time_instances || []);
    table(document.querySelector("#analytics-characters"), [t("analytics.character"), t("analytics.opens"), t("analytics.sessions")], (data.top_characters || []).map(item => [entityLabel("character", item.id), number(item.opens), number(item.unique_sessions)]), t("analytics.empty"));
    table(document.querySelector("#analytics-episodes"), [t("analytics.episode"), t("analytics.opens"), t("analytics.sessions")], (data.top_episodes || []).map(item => [entityLabel("episode", item.id), number(item.opens), number(item.unique_sessions)]), t("analytics.empty"));
    table(document.querySelector("#analytics-daily"), [t("analytics.date"), t("analytics.pageViews"), t("analytics.searchesCount"), t("analytics.detailOpens"), t("analytics.sourceClicks")], (data.daily || []).map(item => [item.day, number(item.page_views), number(item.searches), number(item.instance_opens), number(item.source_clicks)]), t("analytics.empty"));
    const bucketNames = { zero: t("analytics.zero"), "1_5": "1–5", "6_20": "6–20", "21_100": "21–100", "101_plus": "101+" };
    const queryNames = { empty: t("analytics.queryEmpty"), browse: t("analytics.queryBrowse"), free_text: t("analytics.queryFree"), known_character: t("analytics.queryCharacter"), known_episode: t("analytics.queryEpisode"), suggestion_character: t("analytics.querySuggestionCharacter"), suggestion_episode: t("analytics.querySuggestionEpisode") };
    table(document.querySelector("#analytics-searches"), [t("analytics.searchMode"), t("analytics.queryType"), t("analytics.resultRange"), t("analytics.count")], (data.searches || []).map(item => [item.search_mode === "episodes" ? t("search.episodes") : t("search.expressions"), queryNames[item.query_kind] || item.query_kind || "—", bucketNames[item.result_bucket] || item.result_bucket || "—", number(item.count)]), t("analytics.empty"));
    table(document.querySelector("#analytics-search-targets"), [t("analytics.searchTargets"), t("analytics.count")], (data.search_targets || []).map(item => [entityLabel(item.object_type, item.id), number(item.count)]), t("analytics.empty"));
    table(document.querySelector("#analytics-sources"), [t("analytics.entrySource"), t("analytics.detailOpens")], (data.entry_sources || []).map(item => [item.context || "unknown", number(item.count)]), t("analytics.empty"));
    const audience = [
      ...(data.screens || []).map(item => [item.name === "narrow" ? t("analytics.narrow") : item.name === "wide" ? t("analytics.wide") : t("analytics.unknown"), number(item.count)]),
      ...(data.countries || []).map(item => [item.name, number(item.count)]),
    ];
    table(document.querySelector("#analytics-audience"), [t("analytics.coarseRegionOrScreen"), t("analytics.pageViews")], audience, t("analytics.empty"));
  }
  async function load() {
    feedback.textContent = t("analytics.loading");
    try {
      const data = await requestReport();
      render(data); feedback.textContent = "";
      panel.hidden = false; login.hidden = true;
    } catch (error) {
      feedback.textContent = error.message;
      if (error.message === t("analytics.unauthorized")) { key = ""; login.hidden = false; panel.hidden = true; }
    }
  }

  login.addEventListener("submit", async event => {
    event.preventDefault(); key = login.elements.key.value.trim(); login.elements.key.value = "";
    if (key.length < 32) { feedback.textContent = t("analytics.keyTooShort"); return; }
    await loadCatalogs(); await load();
  });
  document.querySelector("#analytics-refresh").addEventListener("click", load);
  days.addEventListener("change", load);
  document.querySelector("#analytics-logout").addEventListener("click", () => {
    key = ""; panel.hidden = true; login.hidden = false; feedback.textContent = t("analytics.loggedOut");
  });
})();
