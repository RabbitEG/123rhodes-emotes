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
  const isInstancePage = document.body.dataset.page === "instance";
  let release, stats, config = {}, state, visible = 36, matches = [], dataBase = "";
  let suggestionItems = [], activeSuggestion = -1;
  let marqueePosition = 0, marqueeWidth = 0, lastFrame = 0, manualUntil = 0;
  let ribbonObserver;
  const publicAsset = path => dataBase ? new URL(path, dataBase).href : path;
  let ribbonHovered = false, ribbonFocused = false, carouselMode = "random";

  function readState() {
    const p = new URLSearchParams(location.search);
    return { mode: p.get("mode") === "episodes" ? "episodes" : "expressions", q: p.get("q") || "", character: p.get("character") || "", episode: p.get("episode") || "", pair: p.get("pair") || "", browse: p.get("browse") === "1" };
  }
  function analyticsQueryInfo(query, mode) {
    const normalized = normalize(query);
    if (!stats) return { query_kind: normalized ? "free_text" : "empty" };
    if (!normalized) {
      if (state?.character && stats.characters.has(state.character)) return { query_kind: "known_character", object_type: "character", object_id: state.character };
      if (state?.episode && stats.episodes.has(state.episode)) return { query_kind: "known_episode", object_type: "episode", object_id: state.episode };
      return { query_kind: state?.browse ? "browse" : "empty" };
    }
    const exactCharacters = [...stats.characters.values()].filter(character => [character.name, ...(character.aliases ?? [])].some(name => normalize(name) === normalized));
    if (exactCharacters.length === 1) return { query_kind: "known_character", object_type: "character", object_id: exactCharacters[0].id };
    const exactEpisode = [...stats.episodes.values()].find(episode => normalize(episode.name) === normalized || normalize(episode.id) === normalized);
    if (exactEpisode) return { query_kind: "known_episode", object_type: "episode", object_id: exactEpisode.id };
    return { query_kind: "free_text" };
  }
  function trackSearchResults() {
    if (!isSearchPage || !release || !stats) return;
    const info = analyticsQueryInfo(state.q, state.mode);
    window.RhodesAnalytics?.track("search_results", {
      ...info, search_mode: state.mode, result_count: matches.length,
      context: state.q || state.character || state.episode || state.pair ? "search_grid" : "search_form",
      release_id: release.release_id,
    });
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
    trackSearchResults();
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
  function instanceURL(item) { return "/instance.html?id=" + encodeURIComponent(item.id); }
  function suggestionScore(name, query, alias = false) {
    const value = normalize(name);
    if (!value || !value.includes(query)) return Infinity;
    const category = value === query ? 0 : value.startsWith(query) ? 1 : 2;
    return category + (alias ? 3 : 0) + Math.min(value.indexOf(query), 999) / 1000;
  }
  function collectSuggestions(query, mode) {
    const characters = [...stats.characters.values()].map(character => {
      const score = Math.min(suggestionScore(character.name, query), ...(character.aliases ?? []).map(alias => suggestionScore(alias, query, true)));
      return Number.isFinite(score) ? { kind: "character", id: character.id, name: character.name, score, item: character } : null;
    }).filter(Boolean);
    if (mode === "expressions") return characters.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name, "zh-CN")).slice(0, 8);

    const episodes = [...stats.episodes.values()].map(episode => {
      let score = suggestionScore(episode.name, query);
      if (/^\d+$/.test(query) && matchesEpisode(episode, query)) score = Math.min(score, 0);
      else if (normalize(episode.id) === query) score = Math.min(score, 0);
      return Number.isFinite(score) ? { kind: "episode", id: episode.id, name: episode.name, score, item: episode } : null;
    }).filter(Boolean);
    return [...episodes, ...characters].sort((a, b) => a.score - b.score || (a.kind === b.kind ? 0 : a.kind === "episode" ? -1 : 1) || a.name.localeCompare(b.name, "zh-CN", { numeric: true })).slice(0, 8);
  }
  function closeSuggestions() {
    const input = $("#site-search"), box = $("#search-suggestions");
    if (!input || !box) return;
    box.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    activeSuggestion = -1;
  }
  function renderSuggestions() {
    const input = $("#site-search"), box = $("#search-suggestions");
    if (!input || !box) return;
    const query = normalize(input.value);
    if (!release || !stats || !query || document.activeElement !== input) { closeSuggestions(); return; }
    suggestionItems = collectSuggestions(query, state.mode);
    if (!suggestionItems.length) { closeSuggestions(); return; }
    activeSuggestion = -1;
    input.removeAttribute("aria-activedescendant");
    box.innerHTML = suggestionItems.map((suggestion, index) => {
      const isCharacter = suggestion.kind === "character";
      const type = text(isCharacter ? "search.suggestionCharacter" : "search.suggestionEpisode");
      const meta = isCharacter
        ? text(state.mode === "episodes" ? "search.suggestionCharacterEpisodes" : "search.suggestionCharacterCount", { count: number(state.mode === "episodes" ? suggestion.item.episodes.size : suggestion.item.count) })
        : text("search.suggestionEpisodeCount", { count: number(suggestion.item.count) });
      return `<button type="button" role="option" tabindex="-1" class="search-suggestion" id="search-suggestion-${index}" aria-selected="false" data-suggestion-index="${index}"><span class="suggestion-primary"><span class="suggestion-kind">${type}</span><strong>${escape(suggestion.name)}</strong></span><span class="suggestion-meta">${meta}</span></button>`;
    }).join("");
    box.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }
  function activateSuggestion(index) {
    if (!suggestionItems.length) return;
    activeSuggestion = Math.max(0, Math.min(index, suggestionItems.length - 1));
    const input = $("#site-search");
    $$(".search-suggestion", $("#search-suggestions")).forEach((option, optionIndex) => {
      const selected = optionIndex === activeSuggestion;
      option.setAttribute("aria-selected", String(selected));
      if (selected) input.setAttribute("aria-activedescendant", option.id);
    });
    $("#search-suggestion-" + activeSuggestion)?.scrollIntoView({ block: "nearest" });
  }
  function selectSuggestion(index) {
    const suggestion = suggestionItems[index];
    if (!suggestion) return;
    const patch = suggestion.kind === "episode"
      ? { mode: "episodes", q: suggestion.name, episode: suggestion.id }
      : { mode: state.mode, q: suggestion.name, character: suggestion.id };
    window.RhodesAnalytics?.track("suggestion_select", {
      object_type: suggestion.kind, object_id: suggestion.id,
      character_id: suggestion.kind === "character" ? suggestion.id : "",
      episode_id: suggestion.kind === "episode" ? suggestion.id : "",
      context: "suggestion", query_kind: suggestion.kind === "character" ? "suggestion_character" : "suggestion_episode",
      search_mode: state.mode, release_id: release?.release_id,
    });
    closeSuggestions();
    go(patch, true);
    closeSuggestions();
  }
  function image(path, alt, eager = false) {
    const url = assetPath(path);
    return url ? `<img src="${escape(publicAsset(url))}" alt="${escape(alt)}" loading="${eager ? "eager" : "lazy"}" decoding="async">` : `<span class="image-missing">${text("card.unavailable")}</span>`;
  }
  function cropCard(item) {
    const c = stats.characters.get(item.character_id), e = stats.episodes.get(item.episode_id);
    return `<article class="expression-card" data-instance="${escape(item.id)}" data-character="${escape(c.id)}" data-episode="${escape(e.id)}"><a class="crop-wrap" href="${escape(instanceURL(item))}" aria-label="${text("detail.open", { character: c.name })}">${image(item.crop_url, t("card.cropAlt", { character: c.name }))}</a><div class="expression-caption"><button class="name-button" data-character="${escape(c.id)}">${escape(c.name)}</button><button class="episode-button" data-episode="${escape(e.id)}">${escape(e.name)}</button></div><div class="source-detail"><button type="button" class="source-toggle" aria-expanded="false" aria-controls="preview-${escape(item.id)}">${text("card.source")} ↗</button><div class="source-peek" id="preview-${escape(item.id)}">${item.source_preview_url ? image(item.source_preview_url, t("card.previewAlt", { episode: e.name })) : `<p>${text("card.previewMissing")}</p>`}<strong>${escape(e.name)}</strong></div></div></article>`;
  }
  function renderInstance() {
    const status = $("#instance-status"), container = $("#instance-detail");
    if (!status || !container || !release || !stats) return;
    const requestedId = new URLSearchParams(location.search).get("id");
    const item = release.instances.find(instance => instance.id === requestedId);
    if (!item) {
      status.hidden = false;
      status.textContent = t("detail.missing");
      container.hidden = true;
      document.title = t("detail.pageTitle") + " · " + t("site.name");
      return;
    }
    const character = stats.characters.get(item.character_id), episode = stats.episodes.get(item.episode_id);
    const sourceURL = officialURL(episode.official_url);
    const otherCharacters = [...episode.characters]
      .filter(characterId => characterId !== character.id)
      .map(characterId => stats.characters.get(characterId))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    const otherCharacterLinks = otherCharacters.length
      ? otherCharacters.map(other => `<button type="button" data-character="${escape(other.id)}">${escape(other.name)}</button>`).join("")
      : `<span class="instance-related-empty">${text("detail.noEpisodeOthers")}</span>`;
    document.title = t("detail.documentTitle", { character: character.name, episode: episode.name });
    status.hidden = true;
    container.hidden = false;
    container.innerHTML = `<div class="instance-layout"><section class="paper-card instance-main"><div class="instance-heading"><span class="instance-kicker">${text("detail.kicker")}</span><h1>${escape(character.name)}</h1></div><div class="instance-art">${image(item.crop_url, t("card.cropAlt", { character: character.name }), true)}</div><dl class="instance-meta"><div><dt>${text("detail.character")}</dt><dd><button data-character="${escape(character.id)}">${escape(character.name)}</button></dd></div><div><dt>${text("detail.episode")}</dt><dd><button data-episode="${escape(episode.id)}">${escape(episode.name)}</button></dd></div><div class="instance-related"><dt>${text("detail.episodeOthers")}</dt><dd><div class="instance-character-links">${otherCharacterLinks}</div></dd></div></dl></section><aside class="paper-card instance-source"><div class="instance-source-heading"><span aria-hidden="true">✦</span><div><p class="instance-kicker">${text("detail.sourceKicker")}</p><h2>${escape(episode.name)}</h2></div></div><div class="instance-source-art">${item.source_preview_url ? image(item.source_preview_url, t("card.previewAlt", { episode: episode.name }), true) : `<p>${text("card.previewMissing")}</p>`}</div><a class="primary instance-official-link" data-source-episode="${escape(episode.id)}" href="${escape(sourceURL)}" target="_blank" rel="noopener noreferrer">${text("detail.officialLink")} <span aria-hidden="true">↗</span></a></aside></div>`;
    window.RhodesAnalytics?.track("instance_open", {
      object_type: "instance", object_id: item.id, character_id: character.id, episode_id: episode.id,
      context: window.RhodesAnalytics.contextForInstanceOpen(), release_id: release.release_id,
    });
  }
  function episodeCard(e) {
    const first = release.instances.find(item => item.episode_id === e.id);
    return `<article class="episode-card" data-episode="${escape(e.id)}">${first ? `<button class="episode-cover" data-episode="${escape(e.id)}" aria-label="${text("card.open")} · ${escape(e.name)}">${image(first.crop_url, e.name)}</button>` : '<span class="episode-cover empty-cover" aria-hidden="true">✦</span>'}<div><h3><button class="name-button" data-episode="${escape(e.id)}">${escape(e.name)}</button></h3><p>${text("card.episodeMeta", { crops: e.count, characters: e.characters.size })}</p><div class="episode-characters">${[...e.characters].slice(0, 5).map(cid => `<button data-character="${escape(cid)}">${escape(stats.characters.get(cid).name)}</button>`).join("")}</div><a href="${escape(officialURL(e.official_url))}" target="_blank" rel="noopener noreferrer">${text("card.official")}</a></div></article>`;
  }
  function renderSearch() {
    if (isInstancePage || !$("#site-search")) return;
    $("#site-search").value = state.q;
    $("#site-search").placeholder = t(state.mode === "expressions" ? "search.placeholderExpressions" : "search.placeholderEpisodes");
    $$("[data-mode]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode)));
    renderSuggestions();
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
      matches = [...stats.episodes.values()].filter(e => state.episode ? e.id === state.episode : state.character ? e.characters.has(state.character) : !query || eids.has(e.id) || [...e.characters].some(cid => cids.has(cid))).sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
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
    if (state.mode === "episodes") window.RhodesAnalytics?.observeEpisodes(grid);
    else window.RhodesAnalytics?.observeInstances(grid, "search_grid");
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
      const value = kind === "coverage" ? c.episodes.size : kind === "cameo" ? c.cameo : kind === "absence" ? c.absence : kind === "searches" ? c.searches : c.count;
      const valueKey = kind === "coverage" ? "rank.episodeValue" : kind === "absence" ? "rank.absenceValue" : kind === "cameo" ? "rank.cropEpisodeValue" : kind === "searches" ? "rank.searchValue" : "rank.cropValue";
      return rankButton(c.name, t(valueKey, { count: number(value), episodes: number(c.cameoEpisodes.size) }), `data-character="${escape(c.id)}"`, index);
    }).join("") : `<p class="empty-copy">${text(release.instances.length ? "stats.noRank" : "stats.empty")}</p>`;
  }
  async function loadSearchRanking() {
    if (!stats || isSearchPage || isInstancePage) return;
    try {
      const response = await fetch("/api/analytics/search-ranking", { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json();
      stats.rankings.searches = (Array.isArray(payload.items) ? payload.items : [])
        .map(item => {
          const character = stats.characters.get(String(item.id));
          const searches = Number(item.searches);
          return character && Number.isSafeInteger(searches) && searches > 0 ? { ...character, searches } : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.searches - a.searches || a.name.localeCompare(b.name, "zh-CN"))
        .slice(0, 30);
      if ($("#ranking-kind")?.value === "searches") renderRanking();
    } catch { /* Analytics rankings are optional; the rest of the site remains available. */ }
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
    if (isSearchPage || isInstancePage || !release?.instances.length || config.carousel?.enabled === false) return;
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
      const c = stats.characters.get(item.character_id);
      const e = stats.episodes.get(item.episode_id);
      return `<a class="sticker" data-instance="${escape(item.id)}" data-character="${escape(c.id)}" data-episode="${escape(e.id)}" href="${escape(instanceURL(item))}" aria-label="${text("detail.open", { character: c.name })}">${image(item.crop_url, t("card.cropAlt", { character: c.name }), true)}<span class="sticker-label">${escape(c.name)}</span></a>`;
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
    window.RhodesAnalytics?.observeInstances(group, "home_ribbon");
    marqueePosition = 0; $("#ribbon").scrollLeft = 0;
  }
  function animateRibbon(now) {
    const elapsed = Math.min((now - lastFrame) / 1000 || 0, .05); lastFrame = now;
    const ribbon = $("#ribbon");
    if (ribbon && marqueeWidth) {
      const paused = motion.matches || ribbonHovered || ribbonFocused || document.hidden || now < manualUntil;
      if (paused) marqueePosition = ribbon.scrollLeft;
      else {
        const speed = Math.max(5, Math.min(60, Number(config.carousel?.speedPixelsPerSecond) || 28));
        marqueePosition = (marqueePosition + elapsed * speed) % marqueeWidth;
        ribbon.scrollLeft = marqueePosition;
      }
    }
    requestAnimationFrame(animateRibbon);
  }
  async function load() {
    const status = $("#instance-status") || $("#search-status"), retry = $("#retry");
    if (retry) retry.hidden = true;
    if (status) status.textContent = t(isInstancePage ? "detail.loading" : "search.loading");
    try {
      const expectedOrigin = dataBase || location.origin;
      const url = new URL(config.releaseManifest || "/data/release.json", expectedOrigin);
      if (url.origin !== new URL(expectedOrigin).origin) throw new Error("Release origin mismatch");
      const response = await fetch(url, { cache: "no-cache" });
      if (response.status === 404) { if (status) status.textContent = t(isInstancePage ? "detail.unpublished" : "search.unpublished"); return; }
      if (!response.ok) throw new Error("Release unavailable");
      release = validate(await response.json()); stats = analyze(release);
      window.RhodesAnalytics?.setReleaseId(release.release_id);
      if (isInstancePage) renderInstance();
      else { renderSearch(); if (isSearchPage) trackSearchResults(); else { renderStats(); void loadSearchRanking(); drawRibbon(); } }
    } catch (error) {
      release = undefined; stats = undefined;
      if (status) status.textContent = t(isInstancePage ? "detail.failed" : "search.failed");
      if (retry) retry.hidden = false;
      window.RhodesAnalytics?.track("release_error", { context: "fetch_failed" });
      console.warn("Public release unavailable:", error.message);
    }
  }
  function setupEvents() {
    const searchInput = $("#site-search"), searchForm = $("#search-form");
    if (searchInput) {
      searchInput.addEventListener("input", renderSuggestions);
      searchInput.addEventListener("focus", renderSuggestions);
      searchInput.addEventListener("keydown", event => {
        const box = $("#search-suggestions");
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          if (box.hidden) renderSuggestions();
          if (box.hidden || !suggestionItems.length) return;
          event.preventDefault();
          const step = event.key === "ArrowDown" ? 1 : -1;
          activateSuggestion(activeSuggestion < 0 ? (step > 0 ? 0 : suggestionItems.length - 1) : activeSuggestion + step);
        } else if (event.key === "Enter" && !box.hidden && activeSuggestion >= 0) {
          event.preventDefault();
          selectSuggestion(activeSuggestion);
        } else if (event.key === "Escape" && !box.hidden) {
          event.preventDefault();
          event.stopPropagation();
          closeSuggestions();
        }
      });
      searchForm.addEventListener("submit", event => {
        event.preventDefault();
        const query = searchInput.value.trim();
        const info = query ? analyticsQueryInfo(query, state.mode) : { query_kind: "browse" };
        window.RhodesAnalytics?.track("search_submit", { ...info, search_mode: state.mode, context: "search_form", release_id: release?.release_id });
        closeSuggestions();
        go({ q: query, browse: !query }, true);
      });
    }
    $$("[data-mode]").forEach(b => b.addEventListener("click", () => {
      const patch = { mode: b.dataset.mode, q: $("#site-search").value.trim(), browse: state.browse };
      if (isSearchPage) go(patch);
      else { state = { ...state, ...patch }; renderSearch(); }
    }));
    $("#clear-search")?.addEventListener("click", () => go({}));
    $("#load-more")?.addEventListener("click", () => { visible += Number(config.pageSize) || 36; renderMatches(); });
    $("#ranking-kind")?.addEventListener("change", renderRanking); $("#retry")?.addEventListener("click", load);
    $("#detail-back")?.addEventListener("click", event => {
      try {
        const previous = new URL(document.referrer);
        if (previous.origin === location.origin && previous.pathname === "/search.html") { event.preventDefault(); history.back(); }
      } catch { /* Keep the search-page fallback link. */ }
    });
    window.addEventListener("popstate", () => { state = readState(); visible = Number(config.pageSize) || 36; renderSearch(); trackSearchResults(); window.RhodesBackground?.rotate(); });
    document.addEventListener("click", event => {
      const suggestion = event.target.closest("[data-suggestion-index]");
      if (suggestion) {
        event.preventDefault();
        selectSuggestion(Number(suggestion.dataset.suggestionIndex));
        return;
      }
      if (!event.target.closest("#search-form")) closeSuggestions();
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
    if (!isSearchPage && !isInstancePage && config.carousel?.enabled !== false) requestAnimationFrame(animateRibbon);
  }
  init().catch(() => { $("#search-status").textContent = document.body.dataset.error; });
})();
