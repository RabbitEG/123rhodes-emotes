(() => {
  "use strict";
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const copy = JSON.parse($("#site-copy").textContent);
  const t = (key, values = {}) => (copy[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
  const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const text = (key, values) => escape(t(key, values));
  const normalize = value => window.RhodesSearch?.normalize(value) ?? String(value ?? "").trim().normalize("NFKC").toLocaleLowerCase("zh-CN");
  const number = value => Number(value).toLocaleString("zh-CN");
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const { validate, analyze, assetPath, officialURL } = RhodesStats;
  const isSearchPage = document.body.dataset.page === "search";
  const isInstancePage = document.body.dataset.page === "instance";
  const isCharacterPage = document.body.dataset.page === "character";
  const isEpisodePage = document.body.dataset.page === "episode";
  let release, stats, config = {}, state, visible = 36, matches = [], dataBase = "";
  let suggestionItems = [], activeSuggestion = -1;
  let pinyinLoadPromise = null, suggestionRevision = 0, searchPendingKey = "";
  const fuzzyResultCache = new Map(), fuzzyResultPromises = new Map();
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
    const episode = exactEpisode(query);
    if (episode) return { query_kind: "known_episode", object_type: "episode", object_id: episode.id };
    return { query_kind: "free_text" };
  }
  function trackSearchResults() {
    if (!isSearchPage || !release || !stats) return;
    if (searchPendingKey === resultStateKey()) return;
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
  function exactEpisode(query) {
    const normalized = normalize(query), value = String(query ?? "").trim();
    if (!normalized || !stats) return null;
    const exact = [...stats.episodes.values()].filter(episode => normalize(episode.name) === normalized || normalize(episode.id) === normalized);
    if (exact.length === 1) return exact[0];
    if (!/^\d+$/.test(value)) return null;
    const numbered = [...stats.episodes.values()].filter(episode => matchesEpisode(episode, value));
    return numbered.length === 1 ? numbered[0] : null;
  }
  function instanceURL(item) { return "/instance.html?id=" + encodeURIComponent(item.id); }
  function characterURL(character) { return "/character.html?id=" + encodeURIComponent(character.id); }
  function episodeURL(episode) { return "/episode.html?id=" + encodeURIComponent(episode.id); }
  function characterById(value) {
    const key = String(value ?? "");
    return stats?.characters.get(key) ?? stats?.characters.get(release?.canonical_id_redirects?.[key]);
  }
  function characterAlterNames(character) {
    return [...new Set((character.alter_names ?? []).filter(name => normalize(name) !== normalize(character.name)))];
  }
  function characterDisplayName(character) {
    const forms = characterAlterNames(character);
    return character.name + (forms.length ? "（" + forms.join("、") + "）" : "");
  }
  // First explicit listing section on PRTS; names without a row open the index itself.
  const prtsStoryLocations = {
    "阿雅吉": "太阳甩在身后",
    "胡安娜": "出苍白海",
    "大帝": "火蓝之心",
    "杰斯顿": "孤岛风云",
    "Touch": "长夜临光",
    "塞斯克": "出苍白海",
    "鼠王": "喧闹法则",
    "阿雅妮": "太阳甩在身后",
    "塔露拉": "第一章 黑暗时代·下",
    "吕刻伊昂": "雅赛努斯复仇记",
    "奥罗拉": "众生行记",
    "扎罗": "叙拉古人",
    "伊斯": "第八章 怒号光明",
    "Misery": "第九章 风暴瞭望",
    "博士": "序章 黑暗时代·上",
    "斐尔迪南": "绿野幻梦",
    "阿尔贝托": "叙拉古人",
  };
  function prtsURL(name, isOperator = true) {
    if (!isOperator) {
      const indexURL = "https://prts.wiki/w/" + encodeURIComponent("剧情角色一览");
      const section = prtsStoryLocations[name];
      return section ? indexURL + "#" + encodeURIComponent(section.replace(/ /g, "_")) : indexURL;
    }
    return "https://prts.wiki/w/" + encodeURIComponent(name);
  }
  function exactCharacter(query) {
    const normalized = normalize(query);
    if (!normalized || !stats) return null;
    const found = [...stats.characters.values()].filter(character => [character.name, ...(character.aliases ?? [])]
      .some(name => normalize(name) === normalized));
    return found.length === 1 ? found[0] : null;
  }
  function openCharacter(id) {
    const character = characterById(id);
    if (character) location.assign(characterURL(character));
  }
  function openEpisode(id) {
    const episode = stats?.episodes.get(String(id));
    if (episode) location.assign(episodeURL(episode));
  }
  function suggestionScore(name, query, alias = false) {
    const value = normalize(name);
    if (!value || !value.includes(query)) return Infinity;
    const category = value === query ? 0 : value.startsWith(query) ? 1 : 2;
    return category + (alias ? 3 : 0) + Math.min(value.indexOf(query), 999) / 1000;
  }
  function hasSuggestionContent(suggestion) {
    const item = suggestion?.item;
    if (!item) return false;
    const count = suggestion.kind === "episode"
      ? item.count
      : state.mode === "episodes" ? item.episodes?.size : item.count;
    return Number.isFinite(Number(count)) && Number(count) > 0;
  }
  function collectSuggestions(query, mode) {
    const characters = [...stats.characters.values()].map(character => {
      const alternateNames = new Set((character.alter_names ?? []).map(normalize));
      const candidates = [character.name, ...(character.aliases ?? [])]
        .map(name => ({ name, score: suggestionScore(name, query, normalize(name) !== normalize(character.name)) }))
        .filter(candidate => Number.isFinite(candidate.score))
        .sort((a, b) => a.score - b.score);
      const best = candidates[0];
      if (!best) return null;
      const isAlternateMatch = alternateNames.has(normalize(best.name)) && normalize(best.name) !== normalize(character.name);
      return {
        kind: "character", id: character.id,
        name: isAlternateMatch ? best.name : character.name,
        canonicalTarget: isAlternateMatch ? character.name : "",
        score: best.score, item: character
      };
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
  function fuzzyCacheKey(query, mode) { return mode + "\u0000" + normalize(query); }
  function resultStateKey() { return JSON.stringify([state?.mode, state?.q, state?.character, state?.episode, state?.pair, state?.browse]); }
  function loadPinyinPro() {
    if (window.pinyinPro?.pinyin) return Promise.resolve(window.pinyinPro);
    if (pinyinLoadPromise) return pinyinLoadPromise;
    pinyinLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/assets/pinyin-pro-3.29.4.js";
      script.async = true;
      script.onload = () => window.pinyinPro?.pinyin ? resolve(window.pinyinPro) : reject(new Error("拼音搜索组件不可用"));
      script.onerror = () => reject(new Error("拼音搜索组件加载失败"));
      document.head.append(script);
    }).catch(error => { pinyinLoadPromise = null; throw error; });
    return pinyinLoadPromise;
  }
  function fuzzyMatches(query, mode) {
    const key = fuzzyCacheKey(query, mode);
    if (fuzzyResultCache.has(key)) return Promise.resolve(fuzzyResultCache.get(key));
    if (fuzzyResultPromises.has(key)) return fuzzyResultPromises.get(key);
    const pending = loadPinyinPro().then(pinyin => {
      if (!stats || !window.RhodesSearch?.findFuzzy) return [];
      const found = window.RhodesSearch.findFuzzy(query, mode, stats.characters.values(), stats.episodes.values(), pinyin, 8);
      fuzzyResultCache.set(key, found);
      if (fuzzyResultCache.size > 80) fuzzyResultCache.delete(fuzzyResultCache.keys().next().value);
      return found;
    }).finally(() => fuzzyResultPromises.delete(key));
    fuzzyResultPromises.set(key, pending);
    return pending;
  }
  function presentFuzzySuggestion(suggestion) {
    const exactVariantTypes = new Set(["pinyin_prefix", "pinyin_initials"]);
    const item = suggestion.item;
    if (!exactVariantTypes.has(suggestion.matchType) || !item || !suggestion.matchedName) return suggestion;
    const matched = normalize(suggestion.matchedName);
    const isAlternate = (item.alter_names ?? []).some(name => normalize(name) === matched);
    return isAlternate
      ? { ...suggestion, name: suggestion.matchedName, canonicalTarget: item.name }
      : suggestion;
  }
  function closeSuggestions() {
    const input = $("#site-search"), box = $("#search-suggestions");
    if (!input || !box) return;
    box.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    activeSuggestion = -1;
  }
  function renderSuggestionItems(items) {
    const input = $("#site-search"), box = $("#search-suggestions");
    if (!input || !box) return;
    suggestionItems = items.filter(hasSuggestionContent);
    if (!suggestionItems.length) { closeSuggestions(); return; }
    activeSuggestion = -1;
    input.removeAttribute("aria-activedescendant");
    box.innerHTML = suggestionItems.map((suggestion, index) => {
      const isCharacter = suggestion.kind === "character";
      const type = text(isCharacter ? "search.suggestionCharacter" : "search.suggestionEpisode");
      const meta = isCharacter
        ? text(state.mode === "episodes" ? "search.suggestionCharacterEpisodes" : "search.suggestionCharacterCount", { count: number(state.mode === "episodes" ? suggestion.item.episodes.size : suggestion.item.count) })
        : text("search.suggestionEpisodeCount", { count: number(suggestion.item.count) });
      const canonicalTarget = suggestion.canonicalTarget
        ? `<span class="suggestion-canonical-target">${text("search.suggestionCanonicalTarget", { name: suggestion.canonicalTarget })}</span>`
        : "";
      const fuzzyLabel = suggestion.matchReason ? `<span class="suggestion-fuzzy-badge">${escape(suggestion.matchReason)}</span>` : "";
      return `<button type="button" role="option" tabindex="-1" class="search-suggestion" id="search-suggestion-${index}" aria-selected="false" data-suggestion-index="${index}"><span class="suggestion-primary"><span class="suggestion-kind">${type}</span><strong>${escape(suggestion.name)}</strong>${canonicalTarget}${fuzzyLabel}</span><span class="suggestion-meta">${meta}</span></button>`;
    }).join("");
    box.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }
  function renderSuggestions() {
    const input = $("#site-search"), box = $("#search-suggestions");
    if (!input || !box) return;
    const query = normalize(input.value);
    const revision = ++suggestionRevision;
    if (!release || !stats || !query || document.activeElement !== input) { closeSuggestions(); return; }
    const direct = collectSuggestions(query, state.mode).filter(hasSuggestionContent);
    if (direct.length) { renderSuggestionItems(direct); return; }
    closeSuggestions();
    if (Array.from(query).length < 2 || !window.RhodesSearch?.findFuzzy) return;
    fuzzyMatches(query, state.mode).then(found => {
      if (revision !== suggestionRevision || normalize(input.value) !== query || document.activeElement !== input) return;
      renderSuggestionItems(found.map(presentFuzzySuggestion));
    }).catch(() => { if (revision === suggestionRevision) closeSuggestions(); });
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
    window.RhodesAnalytics?.track("suggestion_select", {
      object_type: suggestion.kind, object_id: suggestion.id,
      character_id: suggestion.kind === "character" ? suggestion.id : "",
      episode_id: suggestion.kind === "episode" ? suggestion.id : "",
      context: "suggestion", query_kind: suggestion.kind === "character" ? "suggestion_character" : "suggestion_episode",
      search_mode: state.mode, release_id: release?.release_id,
    });
    closeSuggestions();
    if (suggestion.kind === "character") openCharacter(suggestion.id);
    else openEpisode(suggestion.id);
    closeSuggestions();
  }
  function image(path, alt, eager = false) {
    const url = assetPath(path);
    return url ? `<img src="${escape(publicAsset(url))}" alt="${escape(alt)}" loading="${eager ? "eager" : "lazy"}" decoding="async">` : `<span class="image-missing">${text("card.unavailable")}</span>`;
  }
  function cropCard(item, showEpisode = true) {
    const c = stats.characters.get(item.character_id), e = stats.episodes.get(item.episode_id);
    return `<article class="expression-card" data-instance="${escape(item.id)}" data-character="${escape(c.id)}" data-episode="${escape(e.id)}"><a class="crop-wrap" href="${escape(instanceURL(item))}" aria-label="${text("detail.open", { character: c.name })}">${image(item.crop_url, t("card.cropAlt", { character: c.name }))}</a><div class="expression-caption"><button class="name-button" data-character="${escape(c.id)}">${escape(c.name)}</button>${showEpisode ? `<button class="episode-button" data-episode="${escape(e.id)}">${escape(e.name)}</button>` : ""}</div><div class="source-detail"><button type="button" class="source-toggle" aria-expanded="false" aria-controls="preview-${escape(item.id)}">${text("card.source")} ↗</button><div class="source-peek" id="preview-${escape(item.id)}">${item.source_preview_url ? image(item.source_preview_url, t("card.previewAlt", { episode: e.name })) : `<p>${text("card.previewMissing")}</p>`}<strong>${escape(e.name)}</strong></div></div></article>`;
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
    $("#guestbook").hidden = false;
    container.innerHTML = `<div class="instance-layout"><section class="paper-card instance-main"><div class="instance-heading"><span class="instance-kicker">${text("detail.kicker")}</span><h1>${escape(character.name)}</h1></div><div class="instance-art">${image(item.crop_url, t("card.cropAlt", { character: character.name }), true)}</div><dl class="instance-meta"><div><dt>${text("detail.character")}</dt><dd><button data-character="${escape(character.id)}">${escape(character.name)}</button></dd></div><div><dt>${text("detail.episode")}</dt><dd><button data-episode="${escape(episode.id)}">${escape(episode.name)}</button></dd></div><div class="instance-related"><dt>${text("detail.episodeOthers")}</dt><dd><div class="instance-character-links">${otherCharacterLinks}</div></dd></div></dl></section><aside class="paper-card instance-source"><div class="instance-source-heading"><span aria-hidden="true">✦</span><div><p class="instance-kicker">${text("detail.sourceKicker")}</p><h2>${escape(episode.name)}</h2></div></div><div class="instance-source-art">${item.source_preview_url ? image(item.source_preview_url, t("card.previewAlt", { episode: episode.name }), true) : `<p>${text("card.previewMissing")}</p>`}</div><a class="primary instance-official-link" data-source-episode="${escape(episode.id)}" data-source-character="${escape(character.id)}" href="${escape(sourceURL)}" target="_blank" rel="noopener noreferrer">${text("detail.officialLink")} <span aria-hidden="true">↗</span></a></aside></div>`;
    window.RhodesAnalytics?.track("instance_open", {
      object_type: "instance", object_id: item.id, character_id: character.id, episode_id: episode.id,
      context: window.RhodesAnalytics.contextForInstanceOpen(), release_id: release.release_id,
    });
  }
  function renderCharacter() {
    const status = $("#character-status"), container = $("#character-detail");
    if (!status || !container || !release || !stats) return;
    const requestedId = new URLSearchParams(location.search).get("id");
    const character = characterById(requestedId);
    if (!character) {
      status.hidden = false;
      status.textContent = t("character.missing");
      container.hidden = true;
      document.title = t("character.pageTitle") + " · " + t("site.name");
      return;
    }
    if (character.id !== requestedId) {
      location.replace(characterURL(character));
      return;
    }
    const instances = release.instances.filter(item => item.character_id === character.id)
      .sort((a, b) => String(a.sort_key ?? a.id).localeCompare(String(b.sort_key ?? b.id), "zh-CN", { numeric: true }));
    const episodes = [...character.episodes].map(id => stats.episodes.get(id)).filter(Boolean)
      .sort((a, b) => Number(character.homeEpisodes.has(b.id)) - Number(character.homeEpisodes.has(a.id)) ||
        a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
    const episodeLinks = episodes.map(episode => {
      const isHomeEpisode = character.homeEpisodes.has(episode.id);
      return `<button type="button" class="character-episode-chip${isHomeEpisode ? " home-association" : ""}" data-episode="${escape(episode.id)}">${isHomeEpisode ? `<span class="home-association-label">${text("character.homeBadge")}</span>` : ""}${escape(episode.name)}</button>`;
    }).join("");
    const prtsForms = character.is_operator ? [character.name, ...characterAlterNames(character)] : [character.name];
    const prtsLinks = prtsForms.map(form => `<a class="character-prts-link" href="${escape(prtsURL(form, character.is_operator === true))}" target="_blank" rel="noopener noreferrer" aria-label="${text("character.prtsLink", { name: form })}">${escape(form)} <span aria-hidden="true">↗</span></a>`).join("");
    const profileLinks = `<section class="character-episodes${episodes.length ? "" : " character-prts-only"}">${episodes.length ? `<h2>${text("character.episodesTitle")}</h2><div class="instance-character-links">${episodeLinks}</div>` : ""}<div class="character-prts"><h2>${text("character.prtsTitle")}</h2><div class="character-prts-links">${prtsLinks}</div></div></section>`;
    const name = characterDisplayName(character);
    document.title = t("character.documentTitle", { character: name });
    status.hidden = true;
    container.hidden = false;
    container.innerHTML = `<header class="paper-card character-profile"><div class="character-heading"><span class="instance-kicker">${text("character.kicker")}</span><h1>${escape(name)}</h1></div><div class="character-summary"><span class="character-stat"><strong>${number(instances.length)}</strong>${text("character.instanceCount")}</span><span class="character-stat"><strong>${number(episodes.length)}</strong>${text("character.episodeCount")}</span></div>${profileLinks}</header><section class="character-gallery-section"><div class="character-gallery-heading"><h2>${text("character.galleryTitle")}</h2><span>${text("character.galleryCount", { count: number(instances.length) })}</span></div>${instances.length ? `<div class="gallery-grid character-gallery">${instances.map(item => cropCard(item)).join("")}</div>` : `<div class="empty-result character-empty"><span aria-hidden="true">✧</span><p>${text("character.empty")}</p></div>`}</section>`;
    window.RhodesAnalytics?.observeInstances($(".character-gallery", container), "character_gallery");
  }
  function renderEpisode() {
    const status = $("#episode-status"), container = $("#episode-detail");
    if (!status || !container || !release || !stats) return;
    const requestedId = new URLSearchParams(location.search).get("id");
    const episode = stats.episodes.get(String(requestedId ?? ""));
    if (!episode) {
      status.hidden = false;
      status.textContent = t("episode.missing");
      container.hidden = true;
      document.title = t("episode.pageTitle") + " · " + t("site.name");
      return;
    }
    const instances = release.instances.filter(item => item.episode_id === episode.id)
      .sort((a, b) => String(a.sort_key ?? a.id).localeCompare(String(b.sort_key ?? b.id), "zh-CN", { numeric: true }));
    const characters = [...episode.characters].map(id => stats.characters.get(id)).filter(Boolean)
      .sort((a, b) => Number(b.homeEpisodes.has(episode.id)) - Number(a.homeEpisodes.has(episode.id)) ||
        a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
    const characterLinks = characters.map(character => {
      const isHomeCharacter = character.homeEpisodes.has(episode.id);
      return `<button type="button" class="${isHomeCharacter ? "home-association" : ""}" data-character="${escape(character.id)}">${isHomeCharacter ? `<span class="home-association-label">${text("character.homeBadge")}</span>` : ""}${escape(character.name)}</button>`;
    }).join("");
    const sourceURL = officialURL(episode.official_url);
    const name = episode.name;
    document.title = t("episode.documentTitle", { episode: name });
    status.hidden = true;
    container.hidden = false;
    container.innerHTML = `<header class="paper-card character-profile episode-profile"><div class="character-heading"><span class="instance-kicker">${text("episode.kicker")}</span><h1>${escape(name)}</h1></div><div class="character-summary"><span class="character-stat"><strong>${number(instances.length)}</strong>${text("episode.instanceCount")}</span><span class="character-stat"><strong>${number(characters.length)}</strong>${text("episode.characterCount")}</span>${episode.published_at ? `<span class="character-stat"><strong>${escape(episode.published_at)}</strong>${text("episode.publishedAt")}</span>` : ""}</div>${characters.length ? `<section class="character-episodes"><h2>${text("episode.charactersTitle")}</h2><div class="instance-character-links">${characterLinks}</div></section>` : ""}${sourceURL ? `<div class="episode-source-link"><a class="primary instance-official-link" data-source-episode="${escape(episode.id)}" href="${escape(sourceURL)}" target="_blank" rel="noopener noreferrer">${text("episode.readOriginal")} <span aria-hidden="true">↗</span></a></div>` : ""}</header><section class="character-gallery-section"><div class="character-gallery-heading"><h2>${text("episode.galleryTitle")}</h2><span>${text("episode.galleryCount", { count: number(instances.length) })}</span></div>${instances.length ? `<div class="gallery-grid character-gallery episode-gallery">${instances.map(item => cropCard(item, false)).join("")}</div>` : `<div class="empty-result character-empty"><span aria-hidden="true">✧</span><p>${text("episode.empty")}</p></div>`}</section>`;
    window.RhodesAnalytics?.observeInstances($(".episode-gallery", container), "episode_gallery");
  }
  function episodeCard(e) {
    const first = release.instances.find(item => item.episode_id === e.id);
    return `<article class="episode-card" data-episode="${escape(e.id)}">${first ? `<button class="episode-cover" data-episode="${escape(e.id)}" aria-label="${text("card.open")} · ${escape(e.name)}">${image(first.crop_url, e.name)}</button>` : '<span class="episode-cover empty-cover" aria-hidden="true">✦</span>'}<div><h3><button class="name-button" data-episode="${escape(e.id)}">${escape(e.name)}</button></h3><p>${text("card.episodeMeta", { crops: e.count, characters: e.characters.size })}</p><div class="episode-characters">${[...e.characters].slice(0, 5).map(cid => `<button data-character="${escape(cid)}">${escape(stats.characters.get(cid).name)}</button>`).join("")}</div><a href="${escape(officialURL(e.official_url))}" target="_blank" rel="noopener noreferrer">${text("card.official")}</a></div></article>`;
  }
  function renderSearch() {
    if (isInstancePage || isEpisodePage || !$("#site-search")) return;
    $("#site-search").value = state.q;
    $("#site-search").placeholder = t(state.mode === "expressions" ? "search.placeholderExpressions" : "search.placeholderEpisodes");
    $$("[data-mode]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode)));
    renderSuggestions();
    if (!release) return;
    if (state.mode === "expressions" && state.character && !state.episode && !state.pair && characterById(state.character)) {
      location.replace(characterURL(characterById(state.character)));
      return;
    }
    if (state.mode === "expressions" && !state.episode && !state.pair) {
      const character = exactCharacter(state.q);
      if (character) {
        location.replace(characterURL(character));
        return;
      }
    }
    if (!state.character && !state.episode && !state.pair && state.q) {
      const episode = exactEpisode(state.q);
      if (episode) {
        location.replace(episodeURL(episode));
        return;
      }
    }
    if (state.episode && !state.character && !state.pair && stats.episodes.has(state.episode)) {
      location.replace(episodeURL(stats.episodes.get(state.episode)));
      return;
    }
    if (isSearchPage) $("#search-status").textContent = t("search.crops", { count: number(release.instances.length) });
    if (!isSearchPage) return;
    $("#results-section").hidden = false;
    const query = normalize(state.q);
    const cids = new Set([...stats.characters.values()].filter(c => matchesCharacter(c, query)).map(c => c.id));
    const eids = new Set([...stats.episodes.values()].filter(e => matchesEpisode(e, query)).map(e => e.id));
    const directMatches = cids.size > 0 || eids.size > 0;
    const needsFuzzy = Boolean(query && !directMatches && !state.character && !state.episode && !state.pair);
    const resultKey = resultStateKey();
    if (searchPendingKey && searchPendingKey !== resultKey) searchPendingKey = "";
    const cachedFuzzy = fuzzyResultCache.get(fuzzyCacheKey(query, state.mode));
    if (needsFuzzy && cachedFuzzy) {
      for (const candidate of cachedFuzzy) {
        if (candidate.kind === "character") cids.add(candidate.id);
        else if (candidate.kind === "episode") eids.add(candidate.id);
      }
    } else if (needsFuzzy && window.RhodesSearch?.findFuzzy) {
      if (searchPendingKey !== resultKey) {
        searchPendingKey = resultKey;
        fuzzyMatches(query, state.mode).then(() => {
          if (resultStateKey() !== resultKey) return;
          searchPendingKey = "";
          renderSearch();
          trackSearchResults();
        }).catch(() => {
          if (resultStateKey() !== resultKey) return;
          searchPendingKey = "";
          renderSearch();
          trackSearchResults();
        });
      }
    } else if (searchPendingKey === resultKey) searchPendingKey = "";
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
    const fuzzyPending = searchPendingKey === resultStateKey();
    grid.innerHTML = matches.length ? matches.slice(0, visible).map(item => state.mode === "episodes" ? episodeCard(item) : cropCard(item)).join("") : `<div class="empty-result"><span aria-hidden="true">${fuzzyPending ? "✦" : "(・_・?)"}</span><p>${text(fuzzyPending ? "search.loading" : "search.noResults")}</p></div>`;
    if (state.mode === "episodes") window.RhodesAnalytics?.observeEpisodes(grid);
    else window.RhodesAnalytics?.observeInstances(grid, "search_grid");
    $("#pagination-status").textContent = matches.length ? t("search.shown", { shown: Math.min(visible, matches.length), total: matches.length }) : "";
    $("#load-more").hidden = visible >= matches.length;
  }
  function rankButton(label, value, attrs, rank, valueExtra = "") {
    return `<button class="rank-row" ${attrs}><span class="rank-number">${String(rank).padStart(2, "0")}</span><span class="rank-name">${escape(label)}</span><strong class="rank-value">${valueExtra}<span>${escape(value)}</span></strong></button>`;
  }
  function renderRankRows(rows, valueOf, render) {
    let previous;
    let rank = 0;
    return rows.slice(0, 30).map((row, index) => {
      const value = valueOf(row);
      if (index === 0 || value !== previous) rank = index + 1;
      previous = value;
      return render(row, rank, value);
    }).join("");
  }
  function score(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? String(Number(numeric.toFixed(3))) : "0";
  }
  function rankingValue(kind, character) {
    if (kind === "coverage") return character.episodes.size;
    if (kind === "cameo") return character.cameoEpisodes.size;
    if (kind === "absence") return character.absence;
    if (kind === "noRhodes" || kind === "noAppearance") return character.implementationAgeDays;
    if (kind === "searches") return character.searches;
    return character.count;
  }
  function rankingValueKey(kind) {
    if (kind === "coverage") return "rank.episodeValue";
    if (kind === "absence") return "rank.absenceValue";
    if (kind === "noRhodes") return "rank.noRhodesValue";
    if (kind === "noAppearance") return "rank.noAppearanceValue";
    if (kind === "noHome") return "rank.guestValue";
    if (kind === "cameo") return "rank.cropEpisodeValue";
    if (kind === "searches") return "rank.searchValue";
    return "rank.cropValue";
  }
  function renderRankingList(kind, listSelector, noteSelector) {
    if (!stats) return;
    const list = $(listSelector), note = $(noteSelector);
    if (!list) return;
    if (note) note.textContent = t("rank." + kind + "Note");
    const rows = stats.rankings[kind];
    list.innerHTML = rows === null ? `<p class="empty-copy">${text(kind === "absence" ? "stats.orderMissing" : "stats.castMissing")}</p>` : rows.length ? renderRankRows(rows,
      character => rankingValue(kind, character),
      (character, rank, value) => {
        const shown = kind === "noAppearance" && !Number.isFinite(value) ? "—" : t(rankingValueKey(kind), { count: number(kind === "cameo" ? character.cameo : value), episodes: number(kind === "noHome" ? character.episodes.size : character.cameoEpisodes.size) });
        const stars = (kind === "noRhodes" || kind === "noAppearance") && Number.isInteger(character.stars)
          ? character.stars
          : 0;
        const starLabel = stars ? t("rank.starOperator", { count: stars }) : "";
        const starMarkup = stars
          ? `<span class="rank-stars" aria-label="${escape(starLabel)}" title="${escape(starLabel)}">${"★".repeat(stars)}</span>`
          : "";
        return rankButton(character.name, shown, `data-character="${escape(character.id)}"`, rank, starMarkup);
      }) : `<p class="empty-copy">${text(release.instances.length ? "stats.noRank" : "stats.empty")}</p>`;
  }
  function renderRanking() {
    if (!stats) return;
    const select = $("#ranking-kind");
    if (select) renderRankingList(select.value, "#character-ranking", "#rank-note");
    const missing = $("#missing-ranking-kind");
    if (missing) renderRankingList(missing.value, "#missing-ranking", "#missing-rank-note");
    renderRankingList("noHome", "#guest-ranking", null);
  }
  async function loadSearchRanking() {
    if (!stats || isSearchPage || isInstancePage || isEpisodePage) return;
    try {
      const response = await fetch("/api/analytics/search-ranking", { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json();
      const searchesByCharacter = new Map();
      for (const item of Array.isArray(payload.items) ? payload.items : []) {
        const character = characterById(item.id);
        const searches = Number(item.hot ?? item.searches);
        if (!character || !Number.isSafeInteger(searches) || searches <= 0) continue;
        searchesByCharacter.set(character.id, (searchesByCharacter.get(character.id) || 0) + searches);
      }
      stats.rankings.searches = [...searchesByCharacter].map(([id, searches]) => ({ ...stats.characters.get(id), searches }))
        .sort((a, b) => b.searches - a.searches || a.name.localeCompare(b.name, "zh-CN"))
        .slice(0, 30);
      if ($("#ranking-kind")?.value === "searches") renderRanking();
    } catch { /* Analytics rankings are optional; the rest of the site remains available. */ }
  }
  function miniCountChart(titleKey, items, color = "#8a72c7") {
    const title = t(titleKey);
    if (!items.length || !items.some(item => item.count > 0)) return `<section class="publication-mini-card"><h4>${text(titleKey)}</h4><p class="publication-chart-empty">${text("stats.publicationEmpty")}</p></section>`;
    const width = 320, height = 150, top = 18, baseline = 116, plotHeight = 78;
    const max = Math.max(1, ...items.map(item => item.count));
    const groupWidth = width / items.length, barWidth = Math.min(20, groupWidth * .62);
    const bars = items.map((item, index) => {
      const x = index * groupWidth + (groupWidth - barWidth) / 2;
      const barHeight = item.count > 0 ? Math.max(2, item.count / max * plotHeight) : 0;
      const label = item.displayLabel ?? item.label;
      const tip = `${label}：${number(item.count)} 篇`;
      const valueY = Math.max(top + 9, baseline - barHeight - 5);
      return `<g><title>${escape(tip)}</title><rect x="${x.toFixed(1)}" y="${(baseline - barHeight).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="3" fill="${color}"/><text class="publication-bar-value" x="${(x + barWidth / 2).toFixed(1)}" y="${valueY.toFixed(1)}">${number(item.count)}</text><text class="publication-bar-label" x="${(index * groupWidth + groupWidth / 2).toFixed(1)}" y="140">${escape(label)}</text></g>`;
    }).join("");
    return `<section class="publication-mini-card"><h4>${text(titleKey)}</h4><svg class="publication-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(title)}">${bars}</svg></section>`;
  }
  function operatorCoverageChart(rows) {
    const width = 320, height = 150, left = 34, right = 316, top = 20, baseline = 119, plotHeight = 82;
    if (!rows.length) return `<section class="publication-mini-card"><h4>${text("stats.operatorCoverage")}</h4><p class="publication-chart-empty">${text("stats.publicationEmpty")}</p></section>`;
    const groupWidth = (right - left) / rows.length, barWidth = Math.min(21, groupWidth * .48);
    const guides = [0, .5, 1].map(rate => {
      const y = baseline - plotHeight * rate;
      return `<line class="publication-gridline" x1="${left}" y1="${y}" x2="${right}" y2="${y}"/><text class="publication-axis-label" x="1" y="${y + 4}">${Math.round(rate * 100)}%</text>`;
    }).join("");
    const columns = rows.map((row, index) => {
      const center = left + groupWidth * (index + .5);
      const rate = row.total ? row.home / row.total : 0;
      const h = rate * plotHeight, x = center - barWidth / 2;
      const tip = `${row.year}：${row.home}/${row.total}（${(rate * 100).toFixed(1)}%）`;
      const mark = h > 0
        ? `<rect x="${x.toFixed(1)}" y="${(baseline - h).toFixed(1)}" width="${barWidth}" height="${h.toFixed(1)}" rx="2" fill="#8a72c7"/>`
        : `<circle cx="${center.toFixed(1)}" cy="${baseline}" r="1.2" fill="#8a72c7"/>`;
      return `<g><title>${escape(tip)}</title>${mark}<text class="publication-bar-label" x="${center.toFixed(1)}" y="140">${row.year}</text></g>`;
    }).join("");
    return `<section class="publication-mini-card"><h4>${text("stats.operatorCoverage")}</h4><svg class="publication-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${text("stats.operatorCoverageNote")}">${guides}${columns}</svg></section>`;
  }
  function publicationCalendarSvg(yearRows) {
    if (!yearRows.length) return `<p class="publication-chart-empty">${text("stats.publicationEmpty")}</p>`;
    const xStart = 48, cell = 13, pairGap = 3, groupGap = 6, pairStep = cell + groupGap, pairCount = Math.ceil(53 / 2);
    const rowTop = 31, rowStep = cell * 2 + pairGap + 7, width = xStart + pairCount * pairStep + 4;
    const height = rowTop + Math.max(0, yearRows.length - 1) * rowStep + cell * 2 + pairGap + 4;
    const labels = Array.from({ length: 12 }, (_, month) => {
      const x = xStart + Math.floor((yearRows[0].monthPositions[month] || 0) / 2) * pairStep;
      return `<text class="publication-month-label" x="${x}" y="15">${text("stats.monthLabel", { month: month + 1 })}</text>`;
    }).join("");
    const rows = yearRows.map((row, rowIndex) => {
      const y = rowTop + rowIndex * rowStep;
      const cells = row.weeks.map(week => {
        const level = week.count <= 0 ? 0 : Math.min(4, week.count);
        const x = xStart + Math.floor(week.index / 2) * pairStep;
        const weekY = y + (week.index % 2) * (cell + pairGap);
        const title = `${row.year} 第 ${week.index + 1} 周 · ${week.monday.slice(5)}—${week.sunday.slice(5)}：${week.count} 篇`;
        return `<g><title>${escape(title)}</title><rect class="heat-level-${level}" x="${x}" y="${weekY}" width="${cell}" height="${cell}" rx="3"/></g>`;
      }).join("");
      return `<g><text class="publication-year-label" x="0" y="${y + cell + 5}">${row.year}</text>${cells}</g>`;
    }).join("");
    return `<svg class="publication-calendar-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${text("stats.publicationCalendar")}">${labels}${rows}</svg>`;
  }
  function renderPublicationStats() {
    const publication = stats.publication;
    const weekdayNames = t("stats.weekdays").split("、");
    const weekdayRows = publication.weekdays.map((row, index) => ({ ...row, displayLabel: weekdayNames[index] || row.label }));
    const charts = [
      miniCountChart("stats.publicationYear", publication.years),
      miniCountChart("stats.publicationMonth", publication.months.map(row => ({ ...row, displayLabel: t("stats.monthLabel", { month: row.label }) })), "#d89ab5"),
      miniCountChart("stats.publicationWeekday", weekdayRows, "#6fa89e"),
      operatorCoverageChart(publication.operatorCoverage)
    ];
    $("#publication-charts").innerHTML = charts.join("");
    $("#publication-calendar").innerHTML = publicationCalendarSvg(publication.calendarYears);
    $("#publication-total").textContent = t("stats.publicationTotal", { count: number(publication.episodeCount) });
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
    renderPublicationStats();
    renderRanking();
    $("#pair-ranking").innerHTML = stats.bidirectionalPairs.length ? renderRankRows(stats.bidirectionalPairs, p => Number(p.bidirectionalScore.toFixed(3)), (p, rank) => rankButton(t("fun.pairName", { first: stats.characters.get(p.first).name, second: stats.characters.get(p.second).name }), t("fun.bidirectionalValue", { score: score(p.bidirectionalScore) }), `data-pair="${escape(p.first + "," + p.second)}"`, rank)) : `<p class="empty-copy">${text("stats.noRank")}</p>`;
    $("#one-sided-ranking").innerHTML = stats.oneSidedPairs.length ? renderRankRows(stats.oneSidedPairs, p => Number(p.oneSidedScore.toFixed(3)), (p, rank) => rankButton(t("fun.directionName", { source: stats.characters.get(p.source).name, target: stats.characters.get(p.target).name }), t("fun.oneSidedValue", { score: score(p.oneSidedScore) }), `data-pair="${escape(p.first + "," + p.second)}"`, rank)) : `<p class="empty-copy">${text("stats.noRank")}</p>`;
    $("#record-ranking").innerHTML = stats.records.length ? renderRankRows(stats.records, r => r.count, (r, rank) => rankButton(t("fun.recordName", { character: stats.characters.get(r.character).name, episode: stats.episodes.get(r.episode).name }), t("fun.recordValue", { score: score(r.count) }), `data-record-character="${escape(r.character)}" data-record-episode="${escape(r.episode)}"`, rank)) : `<p class="empty-copy">${text("stats.noRank")}</p>`;
    $("#guest-record-ranking").innerHTML = stats.guestRecords.length ? renderRankRows(stats.guestRecords, r => r.count, (r, rank) => rankButton(t("fun.recordName", { character: stats.characters.get(r.character).name, episode: stats.episodes.get(r.episode).name }), t("fun.guestRecordValue", { score: score(r.count) }), `data-record-character="${escape(r.character)}" data-record-episode="${escape(r.episode)}"`, rank)) : `<p class="empty-copy">${text("stats.noRank")}</p>`;
  }
  function shuffle(items) {
    for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
    return items;
  }
  function drawRibbon() {
    if (isSearchPage || isInstancePage || isEpisodePage || !release?.instances.length || config.carousel?.enabled === false) return;
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
    const status = $("#instance-status") || $("#character-status") || $("#episode-status") || $("#search-status"), retry = $("#retry");
    if (retry) retry.hidden = true;
    if (status) status.textContent = t(isInstancePage ? "detail.loading" : isCharacterPage ? "character.loading" : isEpisodePage ? "episode.loading" : "search.loading");
    try {
      const expectedOrigin = dataBase || location.origin;
      const url = new URL(config.releaseManifest || "/data/release.json", expectedOrigin);
      if (url.origin !== new URL(expectedOrigin).origin) throw new Error("Release origin mismatch");
      const response = await fetch(url, { cache: "no-cache" });
      if (response.status === 404) { if (status) status.textContent = t(isInstancePage ? "detail.unpublished" : isCharacterPage ? "character.unpublished" : isEpisodePage ? "episode.unpublished" : "search.unpublished"); return; }
      if (!response.ok) throw new Error("Release unavailable");
      release = validate(await response.json()); stats = analyze(release);
      window.RhodesAnalytics?.setReleaseId(release.release_id);
      if (isInstancePage) renderInstance();
      else if (isCharacterPage) renderCharacter();
      else if (isEpisodePage) renderEpisode();
      else { renderSearch(); if (isSearchPage) trackSearchResults(); else { renderStats(); void loadSearchRanking(); drawRibbon(); } }
    } catch (error) {
      release = undefined; stats = undefined;
      if (status) status.textContent = t(isInstancePage ? "detail.failed" : isCharacterPage ? "character.failed" : isEpisodePage ? "episode.failed" : "search.failed");
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
        suggestionRevision++;
        const query = searchInput.value.trim();
        const info = query ? analyticsQueryInfo(query, state.mode) : { query_kind: "browse" };
        window.RhodesAnalytics?.track("search_submit", { ...info, search_mode: state.mode, context: "search_form", release_id: release?.release_id });
        closeSuggestions();
        if (state.mode === "expressions") {
          const character = exactCharacter(query);
          if (character) { location.assign(characterURL(character)); return; }
        }
        const episode = exactEpisode(query);
        if (episode) { openEpisode(episode.id); return; }
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
    $("#ranking-kind")?.addEventListener("change", renderRanking); $("#missing-ranking-kind")?.addEventListener("change", renderRanking); $("#retry")?.addEventListener("click", load);
    $("#detail-back, #character-back, #episode-back")?.addEventListener("click", event => {
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
      else if (b.dataset.character) openCharacter(b.dataset.character);
      else if (b.dataset.episode) openEpisode(b.dataset.episode);
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
    if (!isSearchPage && !isInstancePage && !isEpisodePage && config.carousel?.enabled !== false) requestAnimationFrame(animateRibbon);
  }
  init().catch(() => { $("#search-status").textContent = document.body.dataset.error; });
})();
