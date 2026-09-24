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
      if (c.home_episode_ids !== undefined && (!Array.isArray(c.home_episode_ids) || c.home_episode_ids.some(x => !episodes.has(id(x))))) throw new Error("Invalid home episodes");
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
    const rows = release.characters.map(c => ({ ...c, count: 0, episodes: new Set(), perEpisode: new Map(), cameo: 0, cameoEpisodes: new Set(), homes: 0, homeEpisodes: new Set((c.home_episode_ids ?? []).map(id)), absence: 0 }));
    const characters = new Map(rows.map(c => [c.id, c]));
    const episodes = new Map(release.episodes.map(e => [e.id, { ...e, count: 0, characters: new Set(), cast: new Set(e.cast_character_ids ?? []) }]));
    const homeReady = release.characters.every(c => Array.isArray(c.home_episode_ids));
    const legacyCastReady = release.cast_complete === true && release.episodes.every(e => Array.isArray(e.cast_character_ids));
    const castReady = homeReady || legacyCastReady;
    const orderReady = release.episodes.length > 0 && release.episodes.every(e => Number.isFinite(e.order)) && new Set(release.episodes.map(e => e.order)).size === release.episodes.length;
    const sequence = [...episodes.values()].sort((a, b) => a.order - b.order);
    const orderIndex = new Map(sequence.map((e, i) => [e.id, i]));
    if (!homeReady && legacyCastReady) {
      for (const e of episodes.values()) for (const cid of e.cast) characters.get(cid).homeEpisodes.add(e.id);
    }
    if (castReady) {
      const normalizeHomeName = value => String(value).normalize("NFKC").replace(/\s+/g, "").replace(/篇$/, "");
      // Episode titles use operator alter names, while the public gallery keeps
      // one canonical person. Keep these reviewed title-to-person pairs explicit:
      // suffix matching would wrongly turn 罗小黑 into 黑 or 杜林 into 林.
      const alternateHomeOwners = new Map(Object.entries({
        "阿米娅（医疗）": "阿米娅", "寒芒克洛丝": "克洛丝", "归溟幽灵鲨": "幽灵鲨",
        "濯尘芙蓉": "芙蓉", "承曦格雷伊": "格雷伊", "百炼嘉维尔": "嘉维尔",
        "缄默德克萨斯": "德克萨斯", "焰影苇草": "苇草", "淬羽赫默": "赫默",
        "圣约送葬人": "送葬人", "纯烬艾雅法拉": "艾雅法拉", "琳琅诗怀雅": "诗怀雅",
        "涤火杰西卡": "杰西卡", "历阵锐枪芬": "芬", "维什戴尔": "W",
        "荒芜拉普兰德": "拉普兰德", "引星棘刺": "棘刺", "烛煌": "煌",
        "新约能天使": "能天使", "司霆惊蛰": "惊蛰", "斩业星熊": "星熊",
        "凛御银灰": "银灰", "溯光星源": "星源", "圣聆初雪": "初雪",
        "浊心斯卡蒂": "斯卡蒂", "撷英调香师": "调香师", "赤刃明霄陈": "陈",
        "怒潮凛冬": "凛冬", "凯尔希·思衡托": "凯尔希", "予愿安洁莉娜": "安洁莉娜",
        "假日威龙陈": "陈"
      }).map(([title, name]) => [normalizeHomeName(title), normalizeHomeName(name)]));
      const ownersByName = new Map();
      for (const c of rows) for (const name of [c.name, ...(c.aliases ?? [])]) {
        const normalized = normalizeHomeName(name);
        if (!normalized) continue;
        if (!ownersByName.has(normalized)) ownersByName.set(normalized, new Set());
        ownersByName.get(normalized).add(c.id);
      }
      for (const e of episodes.values()) {
        const title = e.name.replace(/^\d+_/, "");
        const normalizedTitle = normalizeHomeName(title);
        const owners = ownersByName.get(normalizedTitle) ?? ownersByName.get(alternateHomeOwners.get(normalizedTitle));
        if (owners?.size === 1) characters.get(owners.values().next().value).homeEpisodes.add(e.id);
      }
      for (const c of rows) c.homes = c.homeEpisodes.size;
    }
    for (const item of release.instances) {
      const c = characters.get(item.character_id), e = episodes.get(item.episode_id);
      c.count++; c.episodes.add(e.id); e.count++; e.characters.add(c.id);
      c.perEpisode.set(e.id, (c.perEpisode.get(e.id) || 0) + 1);
      if (!c.homeEpisodes.has(e.id)) {
        c.cameo++;
        c.cameoEpisodes.add(e.id);
      }
    }
    const present = rows.filter(c => c.count > 0);
    for (const c of present) c.absence = orderReady ? sequence.length - 1 - Math.max(...[...c.episodes].map(eid => orderIndex.get(eid))) : 0;
    const desc = field => (a, b) => b[field] - a[field] || byName(a, b);
    const rankings = {
      appearances: [...present].sort(desc("count")),
      searches: [],
      coverage: [...present].sort((a, b) => b.episodes.size - a.episodes.size || b.count - a.count || byName(a, b)),
      rare: [...present].sort((a, b) => a.count - b.count || byName(a, b)),
      cameo: castReady ? present.filter(c => c.cameo > 0).sort(desc("cameo")) : null,
      noHome: castReady ? present.filter(c => c.homes === 0).sort(desc("count")) : null,
      absence: orderReady ? [...present].sort(desc("absence")) : null
    };
    const pairs = new Map();
    for (const e of episodes.values()) {
      const ids = [...e.characters].sort((a, b) => byName(characters.get(a), characters.get(b)));
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const key = JSON.stringify([ids[i], ids[j]]);
        if (!pairs.has(key)) pairs.set(key, { first: ids[i], second: ids[j], episodes: [] });
        pairs.get(key).episodes.push(e.id);
      }
    }
    const pairRows = [...pairs.values()].map(pair => {
      const first = characters.get(pair.first), second = characters.get(pair.second);
      const count = pair.episodes.length;
      const unionCount = first.episodes.size + second.episodes.size - count;
      return {
        ...pair,
        count,
        firstEpisodes: first.episodes.size,
        secondEpisodes: second.episodes.size,
        unionCount,
        firstRate: count / first.episodes.size,
        secondRate: count / second.episodes.size,
        source: first.episodes.size <= second.episodes.size ? first.id : second.id,
        target: first.episodes.size <= second.episodes.size ? second.id : first.id,
        sourceRate: count / Math.min(first.episodes.size, second.episodes.size),
        targetRate: count / Math.max(first.episodes.size, second.episodes.size),
        jaccard: unionCount ? count / unionCount : 0,
        name: first.name + " × " + second.name
      };
    });
    pairRows.forEach(pair => {
      pair.bidirectionalScore = pair.jaccard * pair.count;
      pair.oneSidedScore = pair.sourceRate * (1 - pair.targetRate) * Math.log1p(pair.count) / Math.max(pair.firstEpisodes, pair.secondEpisodes);
    });
    const commonPairs = [...pairRows].sort((a, b) => b.bidirectionalScore - a.bidirectionalScore || b.count - a.count || byName(characters.get(a.first), characters.get(b.first)));
    const bidirectionalPairs = pairRows.filter(pair => pair.count >= 2)
      .sort((a, b) => b.bidirectionalScore - a.bidirectionalScore || b.count - a.count || byName(characters.get(a.first), characters.get(b.first)));
    const oneSidedPairs = pairRows.filter(pair => pair.count >= 2 && pair.sourceRate - pair.targetRate >= 0.1)
      .sort((a, b) => b.oneSidedScore - a.oneSidedScore || b.count - a.count || byName(characters.get(a.first), characters.get(b.first)));
    const records = present.flatMap(c => [...c.perEpisode].map(([eid, count]) => ({ character: c.id, episode: eid, count, name: c.name + " · " + episodes.get(eid).name }))).sort(desc("count"));
    const guestRecords = castReady ? present.flatMap(c => [...c.perEpisode]
      .filter(([eid]) => !c.homeEpisodes.has(eid))
      .map(([eid, count]) => ({ character: c.id, episode: eid, count, name: c.name + " · " + episodes.get(eid).name })))
      .sort(desc("count")) : [];
    let imageCount = null;
    if (Array.isArray(release.images)) imageCount = release.images.length;
    else if (Number.isInteger(release.overview?.images) && release.overview.images >= 0) imageCount = release.overview.images;
    else if (release.instances.length > 0 && release.instances.every(i => i.image_id)) imageCount = new Set(release.instances.map(i => i.image_id)).size;
    const chart = rankings.appearances.slice(0, 10).map(c => ({ id: c.id, name: c.name, count: c.count }));
    const other = release.instances.length - chart.reduce((sum, c) => sum + c.count, 0);
    if (other > 0) chart.push({ id: null, name: null, count: other });
    return { characters, episodes, rankings, commonPairs, bidirectionalPairs, oneSidedPairs, records, guestRecords, chart, imageCount, castReady, orderReady };
  }
  globalThis.RhodesStats = { validate, analyze, assetPath, officialURL };
})();
