/* Statistics use only the public release. */
(() => {
  const id = value => String(value);
  const byName = (a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true });
  function assetPath(value) {
    if (typeof value !== "string" || !value.startsWith("/media/")) return "";
    try {
      const url = new URL(value, "https://assets.invalid");
      return url.origin === "https://assets.invalid" && url.pathname.startsWith("/media/") && /\.(webp|png|jpe?g|avif)$/i.test(url.pathname) ? url.pathname + url.search : "";
    } catch { return ""; }
  }
  function officialURL(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password && ["comic.hypergryph.com", "terra-historicus.hypergryph.com"].includes(url.hostname) ? url.href : "";
    } catch { return ""; }
  }
  function validate(raw) {
    if (!raw || typeof raw !== "object") throw new Error("Invalid release");
    const release = { ...raw };
    for (const key of ["characters", "episodes", "instances"]) {
      if (!Array.isArray(raw[key])) throw new Error("Missing array: " + key);
      const seen = new Set();
      release[key] = raw[key].map(item => {
        if (!item || !["string", "number"].includes(typeof item.id) || !String(item.id).trim() || seen.has(id(item.id))) throw new Error("Invalid/duplicate id: " + key);
        seen.add(id(item.id));
        if (key !== "instances" && (typeof item.name !== "string" || !item.name.trim())) throw new Error("Missing name: " + key);
        return { ...item, id: id(item.id) };
      });
    }
    const characters = new Set(release.characters.map(x => x.id));
    const episodes = new Set(release.episodes.map(x => x.id));
    for (const c of release.characters) {
      if (c.type && c.type !== "canonical") throw new Error("Noncanonical public character");
      if (c.aliases !== undefined && (!Array.isArray(c.aliases) || c.aliases.some(x => typeof x !== "string"))) throw new Error("Invalid aliases");
    }
    for (const e of release.episodes) {
      if (!officialURL(e.official_url)) throw new Error("Missing verified official episode URL");
      if (e.cast_character_ids !== undefined) {
        if (!Array.isArray(e.cast_character_ids) || e.cast_character_ids.some(x => !characters.has(id(x)))) throw new Error("Invalid cast");
        e.cast_character_ids = [...new Set(e.cast_character_ids.map(id))];
      }
    }
    for (const item of release.instances) {
      item.character_id = id(item.character_id); item.episode_id = id(item.episode_id);
      if (!characters.has(item.character_id) || !episodes.has(item.episode_id) || !assetPath(item.crop_url)) throw new Error("Invalid instance references/assets");
      if (item.source_preview_url && !assetPath(item.source_preview_url)) throw new Error("Invalid source preview");
      if (item.image_id !== undefined && item.image_id !== null) item.image_id = id(item.image_id);
    }
    if (release.images !== undefined) {
      if (!Array.isArray(release.images)) throw new Error("Invalid image catalog");
      const ids = release.images.map(x => x && x.id !== undefined ? id(x.id) : "");
      if (ids.some(x => !x) || new Set(ids).size !== ids.length) throw new Error("Invalid image IDs");
      if (release.instances.some(x => x.image_id && !ids.includes(x.image_id))) throw new Error("Unknown image ID");
    }
    return release;
  }
  function analyze(release) {
    const rows = release.characters.map(c => ({ ...c, count: 0, episodes: new Set(), perEpisode: new Map(), cameo: 0, homes: 0, absence: 0 }));
    const characters = new Map(rows.map(c => [c.id, c]));
    const episodes = new Map(release.episodes.map(e => [e.id, { ...e, count: 0, characters: new Set(), cast: new Set(e.cast_character_ids ?? []) }]));
    const castReady = release.cast_complete === true && release.episodes.every(e => Array.isArray(e.cast_character_ids));
    const orderReady = release.episodes.length > 0 && release.episodes.every(e => Number.isFinite(e.order)) && new Set(release.episodes.map(e => e.order)).size === release.episodes.length;
    const sequence = [...episodes.values()].sort((a, b) => a.order - b.order);
    const orderIndex = new Map(sequence.map((e, i) => [e.id, i]));
    for (const e of episodes.values()) for (const cid of e.cast) characters.get(cid).homes++;
    for (const item of release.instances) {
      const c = characters.get(item.character_id), e = episodes.get(item.episode_id);
      c.count++; c.episodes.add(e.id); e.count++; e.characters.add(c.id);
      c.perEpisode.set(e.id, (c.perEpisode.get(e.id) || 0) + 1);
      if (!e.cast.has(c.id)) c.cameo++;
    }
    const present = rows.filter(c => c.count > 0);
    for (const c of present) c.absence = orderReady ? sequence.length - 1 - Math.max(...[...c.episodes].map(eid => orderIndex.get(eid))) : 0;
    const desc = field => (a, b) => b[field] - a[field] || byName(a, b);
    const rankings = {
      appearances: [...present].sort(desc("count")),
      coverage: [...present].sort((a, b) => b.episodes.size - a.episodes.size || b.count - a.count || byName(a, b)),
      rare: [...present].sort((a, b) => a.count - b.count || byName(a, b)),
      cameo: castReady ? present.filter(c => c.cameo > 0).sort(desc("cameo")) : null,
      noHome: castReady ? present.filter(c => c.homes === 0).sort(desc("count")) : null,
      absence: orderReady ? [...present].sort(desc("absence")) : null
    };
    const pairs = new Map();
    for (const e of episodes.values()) {
      const ids = [...e.characters].sort();
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const key = JSON.stringify([ids[i], ids[j]]);
        if (!pairs.has(key)) pairs.set(key, { first: ids[i], second: ids[j], episodes: [] });
        pairs.get(key).episodes.push(e.id);
      }
    }
    const commonPairs = [...pairs.values()].map(pair => ({ ...pair, count: pair.episodes.length, name: characters.get(pair.first).name + " × " + characters.get(pair.second).name })).sort(desc("count"));
    const records = present.flatMap(c => [...c.perEpisode].map(([eid, count]) => ({ character: c.id, episode: eid, count, name: c.name + " · " + episodes.get(eid).name }))).sort(desc("count"));
    let imageCount = null;
    if (Array.isArray(release.images)) imageCount = release.images.length;
    else if (Number.isInteger(release.overview?.images) && release.overview.images >= 0) imageCount = release.overview.images;
    else if (release.instances.length > 0 && release.instances.every(i => i.image_id)) imageCount = new Set(release.instances.map(i => i.image_id)).size;
    const chart = rankings.appearances.slice(0, 5).map(c => ({ id: c.id, name: c.name, count: c.count }));
    const other = release.instances.length - chart.reduce((sum, c) => sum + c.count, 0);
    if (other > 0) chart.push({ id: null, name: null, count: other });
    return { characters, episodes, rankings, commonPairs, records, chart, imageCount, castReady, orderReady };
  }
  globalThis.RhodesStats = { validate, analyze, assetPath, officialURL };
})();
