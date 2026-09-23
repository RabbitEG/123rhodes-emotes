(() => {
  "use strict";
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const copy = JSON.parse($("#site-copy").textContent);
  const t = (key, values = {}) => (copy[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
  const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const text = (key, values) => escape(t(key, values));
  const normalize = value => String(value ?? "").trim().normalize("NFKC").toLocaleLowerCase("zh-CN");
  const number = value => Number(value).toLocaleString("zh-CN");
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const { validate, analyze, assetPath, officialURL } = RhodesStats;
  const isSearchPage = document.body.dataset.page === "search";
  let release, stats, config = {}, state, visible = 36, matches = [], dataBase = "";
  let marqueePosition = 0, marqueeWidth = 0, lastFrame = 0, manualUntil = 0;
  let ribbonObserver;
  const publicAsset = path => dataBase ? new URL(path, dataBase).href : path;
  let ribbonHovered = false, ribbonFocused = false, carouselMode = "random";

  function readState() {
    const p = new URLSearchParams(location.search);
    return { mode: p.get("mode") === "episodes" ? "episodes" : "expressions", q: p.get("q") || "", character: p.get("character") || "", episode: p.get("episode") || "", pair: p.get("pair") || "", browse: p.get("browse") === "1" };
  }
  function go(patch, scroll = false) {
    state = { mode: state.mode, q: "", character: "", episode: "", pair: "", browse: false, ...patch };
    const p = new URLSearchParams();
    if (state.mode !== "expressions") p.set("mode", state.mode);
    for (const key of ["q", "character", "episode", "pair"]) if (state[key]) p.set(key, state[key]);
    if (state.browse) p.set("browse", "1");
    const destination = "/search.html" + (p.toString() ? "?" + p.toString() : "");
    if (!isSearchPage) { location.assign(destination); return; }
    history.pushState(null, "", destination + (scroll ? "#results-section" : "#search"));
    window.RhodesBackground?.rotate();
    visible = Number(config.pageSize) || 36;
    renderSearch();
    if (scroll && !$("#results-section").hidden) $("#results-section").scrollIntoView({ block: "start", behavior: motion.matches ? "instant" : "smooth" });
  }
  function matchesCharacter(c, query) {
    return !query || [c.name, ...(c.aliases ?? [])].some(name => normalize(name).includes(query));
  }
  function matchesEpisode(e, query) {
    if (!query) return true;
    if (/^\d+$/.test(query)) {
      const prefix = String(e.name).match(/^0*(\d+)(?:\D|$)/) || String(e.id).match(/^0*(\d+)(?:\D|$)/);
      return Boolean(prefix && Number(prefix[1]) === Number(query));
    }
    return normalize(e.name).includes(query) || normalize(e.id) === query;
  }
  function image(path, alt, eager = false) {
    const url = assetPath(path);
    return url ? `<img src="${escape(publicAsset(url))}" alt="${escape(alt)}" loading="${eager ? "eager" : "lazy"}" decoding="async">` : `<span class="image-missing">${text("card.unavailable")}</span>`;
  }
  function cropCard(item) {
    const c = stats.characters.get(item.character_id), e = stats.episodes.get(item.episode_id);
    const url = officialURL(e.official_url);
    return `<article class="expression-card" data-instance="${escape(item.id)}"><a class="crop-wrap" href="${escape(url)}" target="_blank" rel="noopener noreferrer" aria-label="${text("card.cropAlt", { character: c.name })} · ${text("card.official")}">${image(item.crop_url, t("card.cropAlt", { character: c.name }))}</a><div class="expression-caption"><button class="name-button" data-character="${escape(c.id)}">${escape(c.name)}</button><button class="episode-button" data-episode="${escape(e.id)}">${escape(e.name)}</button></div><div class="source-detail"><button type="button" class="source-toggle" aria-expanded="false" aria-controls="preview-${escape(item.id)}">${text("card.source")} ↗</button><div class="source-peek" id="preview-${escape(item.id)}">${item.source_preview_url ? image(item.source_preview_url, t("card.previewAlt", { episode: e.name })) : `<p>${text("card.previewMissing")}</p>`}<strong>${escape(e.name)}</strong><a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${text("card.official")}</a></div></div></article>`;
  }
  function episodeCard(e) {
    const first = release.instances.find(item => item.episode_id === e.id);
    return `<article class="episode-card">${first ? `<button class="episode-cover" data-episode="${escape(e.id)}" aria-label="${text("card.open")} · ${escape(e.name)}">${image(first.crop_url, e.name)}</button>` : '<span class="episode-cover empty-cover" aria-hidden="true">✦</span>'}<div><h3><button class="name-button" data-episode="${escape(e.id)}">${escape(e.name)}</button></h3><p>${text("card.episodeMeta", { crops: e.count, characters: e.characters.size })}</p><div class="episode-characters">${[...e.characters].slice(0, 5).map(cid => `<button data-character="${escape(cid)}">${escape(stats.characters.get(cid).name)}</button>`).join("")}</div><a href="${escape(officialURL(e.official_url))}" target="_blank" rel="noopener noreferrer">${text("card.official")}</a></div></article>`;
  }
  function renderSearch() {
    $("#site-search").value = state.q;
    $("#site-search").placeholder = t(state.mode === "expressions" ? "search.placeholderExpressions" : "search.placeholderEpisodes");
    $$("[data-mode]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode)));
    if (!release) return;
    if (isSearchPage) $("#search-status").textContent = t("search.crops", { count: number(release.instances.length) });
    if (!isSearchPage) return;
    $("#results-section").hidden = false;
    const query = normalize(state.q);
    const cids = new Set([...stats.characters.values()].filter(c => matchesCharacter(c, query)).map(c => c.id));
    const eids = new Set([...stats.episodes.values()].filter(e => matchesEpisode(e, query)).map(e => e.id));
    const pairIds = state.pair.split(",").filter(id => stats.characters.has(id));
    const shared = pairIds.length === 2 ? new Set([...stats.episodes.values()].filter(e => pairIds.every(id => e.characters.has(id))).map(e => e.id)) : null;
    if (state.mode === "episodes") {
      matches = [...stats.episodes.values()].filter(e => !query || eids.has(e.id) || [...e.characters].some(cid => cids.has(cid))).sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
    } else {
      matches = release.instances.filter(item => (!query || cids.has(item.character_id)) && (!state.character || item.character_id === state.character) && (!state.episode || item.episode_id === state.episode) && (!state.pair || (shared?.has(item.episode_id) && pairIds.includes(item.character_id)))).sort((a, b) => String(a.sort_key ?? a.id).localeCompare(String(b.sort_key ?? b.id), "zh-CN", { numeric: true }));
    }
    let title = state.q || t("search.all");
    const scopedNames = [stats.characters.get(state.character)?.name, stats.episodes.get(state.episode)?.name].filter(Boolean);
    if (scopedNames.length) title = scopedNames.join(" · ");
    if (pairIds.length === 2) title = t("fun.pairName", { first: stats.characters.get(pairIds[0]).name, second: stats.characters.get(pairIds[1]).name });
    $("#results-title").textContent = title;
    $("#result-count").textContent = t(state.mode === "expressions" ? "search.crops" : "search.episodeCount", { count: number(matches.length) });
    $("#character-matches").innerHTML = query && state.mode === "expressions" && !state.character ? [...cids].slice(0, 12).map(cid => `<button class="pill" data-character="${escape(cid)}">${escape(stats.characters.get(cid).name)}</button>`).join("") : "";
    renderMatches();
  }
  function renderMatches() {
    const grid = $("#results-grid");
    grid.classList.toggle("episodes-grid", state.mode === "episodes");
    grid.innerHTML = matches.length ? matches.slice(0, visible).map(state.mode === "episodes" ? episodeCard : cropCard).join("") : `<div class="empty-result"><span aria-hidden="true">(・_・?)</span><p>${text("search.noResults")}</p></div>`;
    $("#pagination-status").textContent = matches.length ? t("search.shown", { shown: Math.min(visible, matches.length), total: matches.length }) : "";
    $("#load-more").hidden = visible >= matches.length;
  }
  function rankButton(label, value, attrs, index) {
    return `<button class="rank-row" ${attrs}><span class="rank-number">${String(index + 1).padStart(2, "0")}</span><span class="rank-name">${escape(label)}</span><strong>${escape(value)}</strong></button>`;
  }
  function renderRanking() {
    if (!stats) return;
    const kind = $("#ranking-kind").value;
    $("#rank-note").textContent = t("rank." + kind + "Note");
    const rows = stats.rankings[kind];
    $("#character-ranking").innerHTML = rows === null ? `<p class="empty-copy">${text(kind === "absence" ? "stats.orderMissing" : "stats.castMissing")}</p>` : rows.length ? rows.slice(0, 30).map((c, index) => {
      const value = kind === "coverage" ? c.episodes.size : kind === "cameo" ? c.cameo : kind === "absence" ? c.absence : c.count;
      const valueKey = kind === "coverage" ? "rank.episodeValue" : kind === "absence" ? "rank.absenceValue" : kind === "cameo" ? "rank.cropEpisodeValue" : "rank.cropValue";
      return rankButton(c.name, t(valueKey, { count: number(value), episodes: number(c.cameoEpisodes.size) }), `data-character="${escape(c.id)}"`, index);
    }).join("") : `<p class="empty-copy">${text(release.instances.length ? "stats.noRank" : "stats.empty")}</p>`;
  }
  function renderStats() {
    $("#totals").innerHTML = [["episodes", release.episodes.length], ["instances", release.instances.length], ["characters", release.characters.length], ["images", stats.imageCount]].map(([key, value]) => `<article><strong>${value === null ? "—" : number(value)}</strong><span>${text("stats." + key)}</span></article>`).join("");
    if (stats.chart.length) {
      let offset = 0;
      const arcs = stats.chart.map((row, index) => {
        const percent = row.count / release.instances.length * 100;
        const arc = `<circle class="chart-color-${index}" cx="90" cy="90" r="66" pathLength="100" stroke-dasharray="${percent} ${100 - percent}" stroke-dashoffset="${-offset}" transform="rotate(-90 90 90)"/>`;
        offset += percent; return arc;
      }).join("");
      const legend = stats.chart.map((row, index) => `<${row.id ? "button" : "div"} class="legend-row" ${row.id ? `data-character="${escape(row.id)}"` : ""}><span class="legend-dot chart-color-${index}" aria-hidden="true"></span><span>${escape(row.name || t("stats.other"))}</span><small>${text("stats.chartValue", { count: number(row.count), percent: (100 * row.count / release.instances.length).toFixed(1) })}</small></${row.id ? "button" : "div"}>`).join("");
      $("#distribution").innerHTML = `<div class="donut"><svg viewBox="0 0 180 180" role="img" aria-label="${text("stats.chartLabel")}"><title>${text("stats.chartLabel")}</title>${arcs}</svg><div class="donut-center"><strong>${number(release.instances.length)}</strong><span>${text("stats.chartTotal")}</span></div></div><div class="legend">${legend}</div>`;
    }
    renderRanking();
    $("#pair-ranking").innerHTML = stats.bidirectionalPairs.length ? stats.bidirectionalPairs.slice(0, 30).map((p, index) => rankButton(t("fun.pairName", { first: stats.characters.get(p.first).name, second: stats.characters.get(p.second).name }), t("fun.bidirectionalValue", { count: p.count, percent: (100 * p.jaccard).toFixed(0) }), `data-pair="${escape(p.first + "," + p.second)}"`, index)).join("") : `<p class="empty-copy">${text("stats.noRank")}</p>`;
    $("#one-sided-ranking").innerHTML = stats.oneSidedPairs.length ? stats.oneSidedPairs.slice(0, 30).map((p, index) => rankButton(t("fun.directionName", { source: stats.characters.get(p.source).name, target: stats.characters.get(p.target).name }), t("fun.oneSidedValue", { sourcePercent: (100 * p.sourceRate).toFixed(0), count: p.count }), `data-pair="${escape(p.first + "," + p.second)}"`, index)).join("") : `<p class="empty-copy">${text("stats.noRank")}</p>`;
    $("#record-ranking").innerHTML = stats.records.length ? stats.records.slice(0, 30).map((r, index) => rankButton(t("fun.recordName", { character: stats.characters.get(r.character).name, episode: stats.episodes.get(r.episode).name }), t("rank.cropValue", { count: number(r.count) }), `data-record-character="${escape(r.character)}" data-record-episode="${escape(r.episode)}"`, index)).join("") : `<p class="empty-copy">${text("stats.noRank")}</p>`;
    $("#guest-record-ranking").innerHTML = stats.guestRecords.length ? stats.guestRecords.slice(0, 30).map((r, index) => rankButton(t("fun.recordName", { character: stats.characters.get(r.character).name, episode: stats.episodes.get(r.episode).name }), t("rank.cropValue", { count: number(r.count) }), `data-record-character="${escape(r.character)}" data-record-episode="${escape(r.episode)}"`, index)).join("") : `<p class="empty-copy">${text("stats.noRank")}</p>`;
  }
  function shuffle(items) {
    for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
    return items;
  }
  function drawRibbon() {
    if (isSearchPage || !release?.instances.length || config.carousel?.enabled === false) return;
    const max = Math.max(4, Math.min(32, Number(config.carousel?.maxItems) || 16));
    const byId = new Map(release.instances.map(item => [item.id, item]));
    let items = (release.featured_instance_ids || []).map(id => byId.get(String(id))).filter(Boolean);
    if (!items.length) {
      const pool = carouselMode === "random" ? shuffle([...release.instances]) : [...release.instances];
      const used = new Set(); items = pool.filter(item => { if (used.has(item.character_id)) return false; used.add(item.character_id); return true; });
      const chosen = new Set(items.map(item => item.id)); items.push(...pool.filter(item => !chosen.has(item.id)));
    } else if (carouselMode === "random") shuffle(items);
    $("#ribbon-track").removeAttribute("aria-hidden");
    const cards = items.slice(0, max).map(item => {
      const c = stats.characters.get(item.character_id), e = stats.episodes.get(item.episode_id);
      return `<a class="sticker" data-instance="${escape(item.id)}" href="${escape(officialURL(e.official_url))}" target="_blank" rel="noopener noreferrer" aria-label="${text("card.cropAlt", { character: c.name })} · ${text("card.official")}">${image(item.crop_url, t("card.cropAlt", { character: c.name }), true)}<span class="sticker-label">${escape(c.name)}</span></a>`;
    }).join("");
    const track = $("#ribbon-track");
    track.classList.add("is-marquee");
    track.innerHTML = '<div class="ribbon-group">' + cards + '</div>';
    const group = $(".ribbon-group", track);
    ribbonObserver?.disconnect();
    ribbonObserver = new ResizeObserver(() => {
      marqueeWidth = group.offsetWidth + parseFloat(getComputedStyle(track).gap);
      marqueePosition %= Math.max(1, marqueeWidth);
      $("#ribbon").scrollLeft = marqueePosition;
    });
    ribbonObserver.observe(group);
    marqueeWidth = group.offsetWidth + parseFloat(getComputedStyle(track).gap);
    const groups = Math.max(2, Math.ceil(1480 / Math.max(1, marqueeWidth)) + 1);
    for (let i = 1; i < groups; i++) {
      const clone = group.cloneNode(true); clone.setAttribute("aria-hidden", "true");
      $$("a", clone).forEach(link => { link.tabIndex = -1; });
      track.append(clone);
    }
    marqueePosition = 0; $("#ribbon").scrollLeft = 0;
  }
  function animateRibbon(now) {
    const elapsed = Math.min((now - lastFrame) / 1000 || 0, .05); lastFrame = now;
    const ribbon = $("#ribbon");
    if (ribbon && marqueeWidth) {
      const paused = motion.matches || ribbonHovered || ribbonFocused || document.hidden || now < manualUntil;
      if (paused) marqueePosition = ribbon.scrollLeft;
      else {
        const speed = Math.max(5, Math.min(60, Number(config.carousel?.speedPixelsPerSecond) || 22));
        marqueePosition = (marqueePosition + elapsed * speed) % marqueeWidth;
        ribbon.scrollLeft = marqueePosition;
      }
    }
    requestAnimationFrame(animateRibbon);
  }
  async function load() {
    $("#retry").hidden = true; $("#search-status").textContent = t("search.loading");
    try {
      const expectedOrigin = dataBase || location.origin;
      const url = new URL(config.releaseManifest || "/data/release.json", expectedOrigin);
      if (url.origin !== new URL(expectedOrigin).origin) throw new Error("Release origin mismatch");
      const response = await fetch(url, { cache: "no-cache" });
      if (response.status === 404) { $("#search-status").textContent = t("search.unpublished"); return; }
      if (!response.ok) throw new Error("Release unavailable");
      release = validate(await response.json()); stats = analyze(release);
      renderSearch(); if (!isSearchPage) { renderStats(); drawRibbon(); }
    } catch (error) {
      release = undefined; stats = undefined;
      $("#search-status").textContent = t("search.failed"); $("#retry").hidden = false;
      console.warn("Public release unavailable:", error.message);
    }
  }
  function setupEvents() {
    $("#search-form").addEventListener("submit", event => { event.preventDefault(); go({ q: $("#site-search").value.trim(), browse: !$("#site-search").value.trim() }, true); });
    $$("[data-mode]").forEach(b => b.addEventListener("click", () => {
      const patch = { mode: b.dataset.mode, q: $("#site-search").value.trim(), browse: state.browse };
      if (isSearchPage) go(patch);
      else { state = { ...state, ...patch }; renderSearch(); }
    }));
    $("#clear-search")?.addEventListener("click", () => go({}));
    $("#load-more")?.addEventListener("click", () => { visible += Number(config.pageSize) || 36; renderMatches(); });
    $("#ranking-kind")?.addEventListener("change", renderRanking); $("#retry").addEventListener("click", load);
    window.addEventListener("popstate", () => { state = readState(); visible = Number(config.pageSize) || 36; renderSearch(); window.RhodesBackground?.rotate(); });
    document.addEventListener("click", event => {
      const toggle = event.target.closest(".source-toggle");
      if (toggle) {
        const card = toggle.closest(".expression-card");
        const opened = !card.classList.contains("preview-open");
        card.classList.toggle("preview-open", opened);
        card.classList.toggle("preview-suppressed", !opened);
        toggle.setAttribute("aria-expanded", String(opened));
        return;
      }
      const b = event.target.closest("[data-character], [data-episode], [data-pair], [data-record-character]");
      if (!b) return;
      if (b.dataset.recordCharacter) go({ mode: "expressions", character: b.dataset.recordCharacter, episode: b.dataset.recordEpisode }, true);
      else if (b.dataset.character) go({ mode: "expressions", character: b.dataset.character }, true);
      else if (b.dataset.episode) go({ mode: "expressions", episode: b.dataset.episode }, true);
      else if (b.dataset.pair) go({ mode: "expressions", pair: b.dataset.pair }, true);
    });
    document.addEventListener("error", event => {
      if (event.target.tagName !== "IMG") return;
      const fallback = document.createElement("span"); fallback.className = "image-missing"; fallback.textContent = t("card.unavailable"); event.target.replaceWith(fallback);
    }, true);
    function positionPreview(event) {
      const card = event.target.closest(".expression-card");
      if (card) card.classList.toggle("preview-left", card.getBoundingClientRect().right + 212 > innerWidth);
    }
    document.addEventListener("pointerover", positionPreview); document.addEventListener("focusin", positionPreview);
    document.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      $$(".expression-card").filter(card => card.matches(":hover, :focus-within") || card.classList.contains("preview-open")).forEach(card => {
        card.classList.remove("preview-open"); card.classList.add("preview-suppressed");
        $(".source-toggle", card).setAttribute("aria-expanded", "false");
      });
    });
    for (const eventName of ["pointerout", "focusout"]) document.addEventListener(eventName, event => {
      const card = event.target.closest(".expression-card");
      if (card && !card.contains(event.relatedTarget)) card.classList.remove("preview-suppressed");
    });
    const ribbon = $("#ribbon");
    if (!ribbon) return;
    ribbon.addEventListener("touchstart", () => { manualUntil = performance.now() + 60000; }, { passive: true });
    ribbon.addEventListener("touchend", () => { manualUntil = performance.now() + 1500; }, { passive: true });
    ribbon.addEventListener("touchcancel", () => { manualUntil = performance.now() + 1500; }, { passive: true });
    ribbon.addEventListener("mouseenter", () => { ribbonHovered = true; }); ribbon.addEventListener("mouseleave", () => { ribbonHovered = false; });
    ribbon.addEventListener("focusin", () => { ribbonFocused = true; }); ribbon.addEventListener("focusout", event => { ribbonFocused = ribbon.contains(event.relatedTarget); });
  }
  async function init() {
    state = readState();
    if (!isSearchPage && (state.q || state.character || state.episode || state.pair || state.browse)) {
      location.replace("/search.html" + location.search); return;
    }
    setupEvents(); renderSearch();
    try {
      const response = await fetch("/config/site.json", { cache: "no-cache" });
      if (response.ok) config = await response.json();
      if (config.publicDataBaseUrl) {
        const origin = new URL(config.publicDataBaseUrl);
        if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("Invalid public data origin");
        dataBase = origin.origin;
      }
    } catch { config = {}; }
    carouselMode = config.carousel?.mode === "sequential" ? "sequential" : "random";
    visible = Number(config.pageSize) || 36; await load();
    if (!isSearchPage && config.carousel?.enabled !== false) requestAnimationFrame(animateRibbon);
  }
  init().catch(() => { $("#search-status").textContent = document.body.dataset.error; });
})();
