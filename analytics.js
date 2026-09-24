(() => {
  "use strict";
  const SESSION_KEY = "rhodes-emote-analytics-session";
  const OPT_OUT_KEY = "rhodes-emote-analytics-opt-out";
  const SESSION_IDLE_MS = 30 * 60 * 1000;
  const ENTRY_CONTEXT_KEY = "rhodes-emote-analytics-entry";
  const pageTypes = new Set(["home", "search", "instance", "about", "privacy", "notfound"]);
  const page = pageTypes.has(document.body.dataset.page)
    ? document.body.dataset.page
    : ({ "/": "home", "/index.html": "home", "/search.html": "search", "/instance.html": "instance", "/about.html": "about", "/privacy.html": "privacy", "/404.html": "notfound" }[location.pathname] || "other");
  const pageType = page;
  const optoutButton = document.querySelector("#analytics-preference");
  const optoutStatus = document.querySelector("#analytics-preference-status");
  const isDoNotTrack = navigator.doNotTrack === "1" || navigator.globalPrivacyControl === true;
  let memoryOptOut = false;

  function optedOut() {
    if (memoryOptOut) return true;
    try { return localStorage.getItem(OPT_OUT_KEY) === "1"; }
    catch { return false; }
  }

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function sessionId() {
    try {
      const now = Date.now();
      const previous = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
      const id = previous && typeof previous.id === "string" && now - previous.last_seen < SESSION_IDLE_MS ? previous.id : uuid();
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id, last_seen: now }));
      return id;
    } catch { return uuid(); }
  }

  function screenClass() {
    return matchMedia("(max-width: 700px)").matches ? "narrow" : "wide";
  }

  function referrerContext() {
    if (!document.referrer) return "direct";
    try {
      const referrer = new URL(document.referrer);
      if (referrer.origin !== location.origin) return "external";
      if (referrer.pathname === "/" || referrer.pathname === "/index.html") return "internal_home";
      if (referrer.pathname === "/search.html") return "internal_search";
      if (referrer.pathname === "/instance.html") return "internal_instance";
      return "unknown";
    } catch { return "unknown"; }
  }

  let releaseId = "";
  const pendingEvents = [];
  let flushTimer = 0, flushing = false;
  function flushEvents() {
    if (flushing || !pendingEvents.length || isDoNotTrack || optedOut()) return;
    const batch = pendingEvents.splice(0, 8);
    flushing = true;
    try {
      void fetch("/api/analytics", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batch), keepalive: true, credentials: "same-origin",
      }).catch(() => {}).finally(() => {
        flushing = false;
        if (pendingEvents.length) flushEvents();
      });
    } catch {
      flushing = false;
    }
  }
  function track(eventType, detail = {}) {
    if (isDoNotTrack || optedOut()) return;
    const payload = {
      event_id: uuid(), session_id: sessionId(), event_type: eventType, page_type: pageType,
      object_type: detail.object_type || "", object_id: detail.object_id || "",
      character_id: detail.character_id || "", episode_id: detail.episode_id || "",
      context: detail.context || "", search_mode: detail.search_mode || "",
      query_kind: detail.query_kind || "", result_count: Number.isSafeInteger(detail.result_count) ? detail.result_count : null,
      screen_class: screenClass(), release_id: detail.release_id || releaseId,
    };
    pendingEvents.push(payload);
    if (flushTimer) clearTimeout(flushTimer);
    if (pendingEvents.length >= 8) flushEvents();
    else flushTimer = setTimeout(flushEvents, 350);
  }

  function contextForInstanceOpen() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(ENTRY_CONTEXT_KEY) || "null");
      sessionStorage.removeItem(ENTRY_CONTEXT_KEY);
      if (saved && Date.now() - saved.at < 15 * 60 * 1000) return saved.context;
    } catch { /* Use the referrer category below. */ }
    const context = referrerContext();
    return context === "internal_home" ? "home_ribbon" : context === "internal_search" ? "search_grid" : context === "internal_instance" ? "detail_related" : context;
  }

  function observeInstances(root, context) {
    if (isDoNotTrack || optedOut() || !root || !("IntersectionObserver" in window)) return;
    const nodes = root.matches?.("[data-instance]") ? [root] : [...root.querySelectorAll("[data-instance]")];
    if (!nodes.length) return;
    const seen = new WeakSet();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting || entry.intersectionRatio < 0.35 || seen.has(entry.target)) continue;
        seen.add(entry.target);
        observer.unobserve(entry.target);
        const node = entry.target;
        track("instance_impression", {
          object_type: "instance", object_id: node.dataset.instance,
          character_id: node.dataset.character, episode_id: node.dataset.episode,
          context,
        });
      }
    }, { threshold: [0.35] });
    nodes.forEach(node => observer.observe(node));
  }

  function observeEpisodes(root) {
    if (isDoNotTrack || optedOut() || !root || !("IntersectionObserver" in window)) return;
    const nodes = root.matches?.(".episode-card[data-episode]") ? [root] : [...root.querySelectorAll(".episode-card[data-episode]")];
    if (!nodes.length) return;
    const seen = new WeakSet();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting || entry.intersectionRatio < 0.35 || seen.has(entry.target)) continue;
        seen.add(entry.target); observer.unobserve(entry.target);
        const id = entry.target.dataset.episode;
        track("episode_impression", { object_type: "episode", object_id: id, episode_id: id, context: "episode_results" });
      }
    }, { threshold: [0.35] });
    nodes.forEach(node => observer.observe(node));
  }

  function updatePreference() {
    if (!optoutButton) return;
    if (isDoNotTrack) {
      optoutButton.disabled = true;
      optoutButton.textContent = optoutButton.dataset.dntLabel || "已遵循浏览器的请勿追踪设置";
      optoutButton.setAttribute("aria-pressed", "true");
      if (optoutStatus) optoutStatus.textContent = optoutButton.dataset.dntStatus || "本站不会记录此浏览器的站内使用统计。";
      return;
    }
    const disabled = optedOut();
    optoutButton.disabled = false;
    optoutButton.textContent = disabled
      ? (optoutButton.dataset.enableLabel || "允许本站记录站内使用统计")
      : (optoutButton.dataset.disableLabel || "关闭此浏览器的站内使用统计");
    optoutButton.setAttribute("aria-pressed", String(disabled));
    if (optoutStatus) optoutStatus.textContent = disabled
      ? (optoutButton.dataset.disabledStatus || "此浏览器已停止站内统计。")
      : (optoutButton.dataset.enabledStatus || "此浏览器当前允许参与站内统计。");
  }

  optoutButton?.addEventListener("click", () => {
    if (isDoNotTrack) return;
    try {
      if (optedOut()) {
        localStorage.removeItem(OPT_OUT_KEY);
        memoryOptOut = false;
        if (optoutStatus) optoutStatus.textContent = optoutButton.dataset.enabledStatus || "此浏览器当前允许参与站内统计。";
        track("page_view", { context: referrerContext() });
      } else {
        memoryOptOut = true;
        pendingEvents.length = 0;
        if (flushTimer) clearTimeout(flushTimer);
        flushTimer = 0;
        localStorage.setItem(OPT_OUT_KEY, "1");
        sessionStorage.removeItem(SESSION_KEY);
        if (optoutStatus) optoutStatus.textContent = optoutButton.dataset.disabledStatus || "此浏览器已停止站内统计。";
      }
      updatePreference();
    } catch {
      if (optoutStatus) optoutStatus.textContent = optoutButton.dataset.preferenceError || "无法保存此浏览器的统计设置。";
      updatePreference();
    }
  });
  updatePreference();

  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const sourceLink = target.closest('a[href^="https://comic.hypergryph.com/"], a[href^="https://terra-historicus.hypergryph.com/"]');
    if (sourceLink) {
      const episodeCard = sourceLink.closest(".episode-card[data-episode]");
      const episodeId = sourceLink.dataset.sourceEpisode || episodeCard?.dataset.episode || "";
      if (episodeId) track("source_click", { object_type: "episode", object_id: episodeId, episode_id: episodeId, context: episodeCard ? "episode_card" : "detail_source" });
      return;
    }
    const instanceLink = target.closest('a[href*="/instance.html?id="]');
    if (instanceLink) {
      const card = instanceLink.closest("[data-instance]");
      if (card?.dataset.instance) {
        const context = card.classList.contains("sticker") ? "home_ribbon" : "search_grid";
        const detail = {
          object_type: "instance", object_id: card.dataset.instance,
          character_id: card.dataset.character, episode_id: card.dataset.episode, context,
        };
        track("instance_link_click", detail);
        try { sessionStorage.setItem(ENTRY_CONTEXT_KEY, JSON.stringify({ context, at: Date.now() })); } catch { /* Direct/referrer context is still available. */ }
      }
      return;
    }
    if (target.closest("[data-suggestion-index]")) return;
    const character = target.closest("[data-character]");
    if (character?.dataset.character) {
      const context = character.closest(".instance-related") ? "detail_related" : character.closest(".rank-list") ? "ranking" : "search_grid";
      track("character_select", { object_type: "character", object_id: character.dataset.character, character_id: character.dataset.character, context });
      return;
    }
    const episode = target.closest("[data-episode]");
    if (episode?.dataset.episode) {
      track("episode_select", { object_type: "episode", object_id: episode.dataset.episode, episode_id: episode.dataset.episode, context: episode.closest(".episode-card") ? "episode_results" : "search_grid" });
    }
  }, true);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushEvents();
  });
  window.addEventListener("pagehide", flushEvents);

  track("page_view", { context: referrerContext() });
  window.RhodesAnalytics = {
    track,
    observeInstances,
    observeEpisodes,
    setReleaseId(value) { releaseId = typeof value === "string" ? value.slice(0, 80) : ""; },
    contextForInstanceOpen,
  };
})();
