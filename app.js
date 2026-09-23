(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const normalize = (value) => String(value ?? "").trim().toLocaleLowerCase("zh-CN");
  let release = null;
  let config = null;
  let carouselTimer = null;
  let carouselIndex = 0;
  let carouselPaused = false;
  let carouselItems = [];

  function setStatus(message, isError = false) {
    const status = $("#search-status");
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("error-copy", isError);
  }

  function updateStats() {
    if (!release?.overview) return;
    const overview = release.overview;
    const stats = $("#overview-stats");
    const entries = [
      ["已收录表情", overview.instances],
      ["收录角色", overview.characters],
      ["收录篇目", overview.episodes]
    ];
    stats.innerHTML = entries.map(([label, value]) => `<article class="stat-card"><span>${escapeHTML(label)}</span><strong>${Number.isFinite(Number(value)) ? Number(value).toLocaleString("zh-CN") : "—"}</strong><small>只统计当前公开版本</small></article>`).join("");
    const date = $("#release-date");
    if (date && release.generated_at) {
      const parsed = new Date(release.generated_at);
      date.textContent = Number.isNaN(parsed.getTime()) ? "公开索引" : `更新于 ${new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeZone: "Asia/Shanghai" }).format(parsed)}`;
    }
  }

  function episodeById(id) { return release?.episodes?.find((episode) => episode.id === id); }
  function characterById(id) { return release?.characters?.find((character) => character.id === id); }

  function officialLink(episode) {
    const value = episode?.official_url;
    if (!value) return "";
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || !["comic.hypergryph.com", "terra-historicus.hypergryph.com"].includes(url.hostname)) return "";
      return url.href;
    } catch { return ""; }
  }

  function renderCharacters(query = "") {
    const host = $("#character-results");
    const term = normalize(query);
    const characters = (release?.characters ?? []).filter((item) => !term || [item.name, ...(item.aliases ?? [])].some((value) => normalize(value).includes(term)));
    if (!characters.length) {
      host.innerHTML = `<div class="empty-note"><span class="empty-mark" aria-hidden="true">♡</span><p>${term ? "沒有找到符合的已收錄角色。" : "公開角色圖集尚未發布。"}</p><a href="about.html">了解本站如何整理和標注来源</a></div>`;
      return;
    }
    host.innerHTML = characters.slice(0, 48).map((item) => `<button class="result-card" type="button" data-character="${escapeHTML(item.id)}"><strong>${escapeHTML(item.name)}</strong><small>${Number(item.instance_count) || 0} 张表情 · ${Number(item.episode_count) || 0} 个篇目</small></button>`).join("");
  }

  function renderEpisodes(query = "") {
    const host = $("#episode-results");
    const term = normalize(query);
    const episodes = (release?.episodes ?? []).filter((item) => !term || normalize(item.name).includes(term) || normalize(item.id).includes(term));
    if (!episodes.length) {
      host.innerHTML = `<div class="empty-note"><span class="empty-mark" aria-hidden="true">⌁</span><p>${term ? "没有找到符合的已收录篇目。" : "篇目索引正在整理，核实出处后会逐步开放。"}</p><a class="text-link" href="${escapeHTML(config?.officialSeriesUrl ?? "https://comic.hypergryph.com/comic/6253")}" target="_blank" rel="noopener noreferrer">前往泰拉记事社 ↗</a></div>`;
      return;
    }
    host.innerHTML = episodes.slice(0, 48).map((item) => {
      const url = officialLink(item);
      const label = url ? `<a class="text-link" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">官方阅读 ↗</a>` : "出处链接待核实";
      return `<article class="result-card"><strong>${escapeHTML(item.name)}</strong><small>${Number(item.instance_count) || 0} 张本站收录表情</small>${label}</article>`;
    }).join("");
  }

  function renderGallery(characterId) {
    const host = $("#gallery-results");
    const character = characterById(characterId);
    if (!character) return;
    const instances = (release?.instances ?? []).filter((item) => item.character_id === characterId).sort((a, b) => String(a.sort_key ?? "").localeCompare(String(b.sort_key ?? ""), "zh-CN", { numeric: true }));
    if (!instances.length) {
      host.innerHTML = `<div class="empty-note"><p>${escapeHTML(character.name)}暂未收录可展示的表情图。</p></div>`;
      return;
    }
    host.innerHTML = instances.map((item) => {
      const episode = episodeById(item.episode_id);
      const url = officialLink(episode);
      const href = url || "about.html#sources";
      const sourcePreview = item.source_preview_url ? `<span class="source-peek"><img src="${escapeHTML(item.source_preview_url)}" alt="${escapeHTML(episode?.name ?? "") }漫画出处缩略图" loading="lazy"><span>${escapeHTML(episode?.name ?? "出处预览")}</span></span>` : "";
      return `<article class="expression-card"><a class="crop-wrap" href="${escapeHTML(href)}" ${url ? 'target="_blank" rel="noopener noreferrer"' : ""} aria-label="查看${escapeHTML(episode?.name ?? "") }官方出处">${item.crop_url ? `<img class="crop-image" src="${escapeHTML(item.crop_url)}" alt="${escapeHTML(character.name)}表情图" loading="lazy">` : `<span class="empty-mark" aria-hidden="true">♡</span>`}${sourcePreview}</a><div class="expression-caption"><strong>${escapeHTML(character.name)}</strong><span>${escapeHTML(episode?.name ?? "篇目待核实")}</span></div></article>`;
    }).join("");
    host.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "nearest" });
  }

  function setupCarousel() {
    const controls = $("#carousel-mode");
    const pause = $("#carousel-pause");
    const host = $("#featured-track");
    const enabled = config?.carousel?.enabled && (release?.instances?.length ?? 0) > 0;
    if (!enabled) return;
    const featuredIds = release.featured_instance_ids ?? [];
    const byId = new Map(release.instances.map((item) => [item.id, item]));
    carouselItems = (featuredIds.length ? featuredIds.map((id) => byId.get(id)).filter(Boolean) : [...release.instances]).slice(0, Number(config.carousel.maxItems) || 8);
    if (!carouselItems.length) return;
    if (config.carousel.mode === "random") carouselItems.sort(() => Math.random() - 0.5);
    controls.disabled = false;
    pause.disabled = false;
    controls.textContent = config.carousel.mode === "random" ? "随机" : "顺序";

    const draw = () => {
      const visible = Array.from({ length: Math.min(4, carouselItems.length) }, (_, offset) => carouselItems[(carouselIndex + offset) % carouselItems.length]);
      host.innerHTML = visible.map((item) => {
        const character = characterById(item.character_id);
        const episode = episodeById(item.episode_id);
        const url = officialLink(episode);
        if (!item.crop_url) return "";
        return `<article class="expression-card"><a class="crop-wrap" href="${escapeHTML(url || "about.html#sources")}" ${url ? 'target="_blank" rel="noopener noreferrer"' : ""}><img class="crop-image" src="${escapeHTML(item.crop_url)}" alt="${escapeHTML(character?.name ?? "人物")}表情图" loading="lazy"></a><div class="expression-caption"><strong>${escapeHTML(character?.name ?? "人物待核实")}</strong><span>${escapeHTML(episode?.name ?? "篇目待核实")}</span></div></article>`;
      }).join("");
    };
    draw();
    controls.addEventListener("click", () => {
      config.carousel.mode = config.carousel.mode === "random" ? "sequential" : "random";
      if (config.carousel.mode === "random") carouselItems.sort(() => Math.random() - 0.5);
      controls.textContent = config.carousel.mode === "random" ? "随机" : "顺序";
      carouselIndex = 0;
      draw();
    });
    pause.addEventListener("click", () => {
      carouselPaused = !carouselPaused;
      pause.textContent = carouselPaused ? "继续" : "暂停";
    });
    const start = () => {
      if (carouselTimer) clearInterval(carouselTimer);
      carouselTimer = setInterval(() => {
        if (carouselPaused || document.hidden || matchMedia("(prefers-reduced-motion: reduce)").matches || carouselItems.length < 5) return;
        carouselIndex = (carouselIndex + 1) % carouselItems.length;
        draw();
      }, Math.max(4000, Number(config.carousel.intervalMs) || 5200));
    };
    host.addEventListener("mouseenter", () => { carouselPaused = true; });
    host.addEventListener("mouseleave", () => { carouselPaused = false; });
    host.addEventListener("focusin", () => { carouselPaused = true; });
    host.addEventListener("focusout", () => { carouselPaused = false; });
    start();
  }

  function runSearch(query) {
    const term = query.trim();
    if (!release) {
      setStatus("公开索引尚未发布，暂时无法检索。", false);
      return;
    }
    if (!term) {
      setStatus("输入角色名、别名或篇目名开始搜索。", false);
      renderCharacters();
      renderEpisodes();
      return;
    }
    renderCharacters(term);
    renderEpisodes(term);
    const matchedCharacters = (release.characters ?? []).filter((item) => [item.name, ...(item.aliases ?? [])].some((value) => normalize(value).includes(normalize(term)))).length;
    const matchedEpisodes = (release.episodes ?? []).filter((item) => normalize(item.name).includes(normalize(term)) || normalize(item.id).includes(normalize(term))).length;
    setStatus(`找到 ${matchedCharacters} 个角色、${matchedEpisodes} 个篇目。`, matchedCharacters + matchedEpisodes === 0);
    document.querySelector("#expressions").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function init() {
    const form = $("#search-form");
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      runSearch($("#site-search").value);
    });
    $("#character-results")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-character]");
      if (button) renderGallery(button.dataset.character);
    });

    try {
      const configResponse = await fetch("/config/site.json", { cache: "no-cache" });
      if (!configResponse.ok) throw new Error("配置文件暂不可用");
      config = await configResponse.json();
      document.documentElement.style.setProperty("--accent", config.theme?.accent || "#347f88");
      document.documentElement.style.setProperty("--paper", config.theme?.background || "#f4f0e8");
      if (config.theme?.backgroundImage) {
        const safePath = new URL(config.theme.backgroundImage, location.origin);
        if (safePath.origin === location.origin) document.documentElement.style.setProperty("--site-bg-image", `url("${safePath.href}")`);
      }
    } catch {
      config = { carousel: { enabled: false }, officialSeriesUrl: "https://comic.hypergryph.com/comic/6253" };
    }

    try {
      const response = await fetch(config.releaseManifest || "/data/release.json", { cache: "no-cache" });
      if (!response.ok) throw new Error("还没有公开发布清单");
      release = await response.json();
      updateStats();
      renderCharacters();
      renderEpisodes();
      setupCarousel();
      setStatus("输入角色名、别名或篇目名开始搜索。", false);
    } catch {
      setStatus("公开图集正在准备中；现在可以先看站点介绍和来源。", false);
    }
  }

  init();
})();
