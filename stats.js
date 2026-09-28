/* Statistics use only the public release. */
(() => {
  const id = value => String(value);
  const byName = (a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true });
  // Crossover-only identities are excluded from the two "missing" operator
  // rankings. Canonical Arknights operators Yato and Noir Corne stay included:
  // their Monster Hunter forms are already folded into those existing people.
  const crossoverOnlyOperators = new Set([
    "灰烬", "战车", "闪击", "霜华", "艾拉", "双月", "医生", "导火索",
    "九色鹿", "罗小黑", "泰拉大陆调查团", "焰狐龙梓兰", "雷狼龙S空爆",
    "莱欧斯", "玛露西尔", "齐尔查克", "森西",
    "结城理", "岳羽由加莉", "埃癸斯", "虎狼丸"
  ]);
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
  function isoDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split("-").map(Number);
    const stamp = Date.UTC(year, month - 1, day);
    const check = new Date(stamp);
    return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day ? stamp : null;
  }
  function chinaToday() {
    return isoDate(new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10));
  }
  function daysSince(value, today = chinaToday()) {
    const stamp = isoDate(value);
    return stamp === null || today === null ? null : Math.max(0, Math.floor((today - stamp) / 86400000));
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
      if (c.is_operator !== undefined && typeof c.is_operator !== "boolean") throw new Error("Invalid operator flag");
      if (c.stars !== undefined && c.stars !== null && (!Number.isInteger(c.stars) || c.stars < 1 || c.stars > 6)) throw new Error("Invalid operator stars");
      if (c.aliases !== undefined && (!Array.isArray(c.aliases) || c.aliases.some(x => typeof x !== "string"))) throw new Error("Invalid aliases");
      if (c.home_episode_ids !== undefined && (!Array.isArray(c.home_episode_ids) || c.home_episode_ids.some(x => !episodes.has(id(x))))) throw new Error("Invalid home episodes");
      if (c.implementation_date !== undefined && c.implementation_date !== null && isoDate(c.implementation_date) === null) throw new Error("Invalid implementation date");
    }
    if (release.operator_forms !== undefined) {
      if (!Array.isArray(release.operator_forms)) throw new Error("Invalid operator forms");
      for (const form of release.operator_forms) {
        if (!form || !characters.has(id(form.character_id)) || typeof form.is_alter !== "boolean" ||
            (form.implementation_date != null && isoDate(form.implementation_date) === null)) throw new Error("Invalid operator form");
      }
    }
    for (const e of release.episodes) {
      if (!officialURL(e.official_url)) throw new Error("Missing verified official episode URL");
      if (e.published_at !== undefined && e.published_at !== null && isoDate(e.published_at) === null) throw new Error("Invalid publication date");
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
  function publicationSummary(release, characters) {
    const datedEpisodes = release.episodes.filter(episode => isoDate(episode.published_at) !== null);
    const years = new Map(), months = Array.from({ length: 12 }, (_, index) => ({ label: String(index + 1), count: 0 }));
    const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map(label => ({ label, count: 0 }));
    const weekCounts = new Map(), calendarYearSet = new Set();
    for (const episode of datedEpisodes) {
      const stamp = isoDate(episode.published_at), date = new Date(stamp);
      const year = date.getUTCFullYear(), month = date.getUTCMonth();
      years.set(year, (years.get(year) || 0) + 1);
      months[month].count++;
      weekdays[(date.getUTCDay() + 6) % 7].count++;
      const monday = stamp - ((date.getUTCDay() + 6) % 7) * 86400000;
      const weekKey = new Date(monday).toISOString().slice(0, 10);
      const weekYear = new Date(monday + 3 * 86400000).getUTCFullYear();
      calendarYearSet.add(weekYear);
      const key = `${weekYear}|${weekKey}`;
      weekCounts.set(key, (weekCounts.get(key) || 0) + 1);
    }
    const calendarYears = [...calendarYearSet].sort((a, b) => b - a).map(year => {
      const jan4 = Date.UTC(year, 0, 4), firstDay = new Date(jan4).getUTCDay();
      const anchor = jan4 - ((firstDay + 6) % 7) * 86400000;
      const weeks = Array.from({ length: 53 }, (_, index) => {
        const monday = anchor + index * 7 * 86400000;
        const weekKey = new Date(monday).toISOString().slice(0, 10);
        const sunday = monday + 6 * 86400000;
        return { index, monday: weekKey, sunday: new Date(sunday).toISOString().slice(0, 10), count: weekCounts.get(`${year}|${weekKey}`) || 0 };
      });
      const monthPositions = Array.from({ length: 12 }, (_, month) => {
        const first = Date.UTC(year, month, 1);
        return Math.max(0, Math.floor((first - anchor) / (7 * 86400000)));
      });
      return { year, weeks, monthPositions };
    });
    const cohorts = new Map();
    for (const form of release.operator_forms ?? []) {
      if (isoDate(form.implementation_date) === null) continue;
      const character = characters.get(id(form.character_id));
      if (!character || character.is_operator !== true || crossoverOnlyOperators.has(character.name)) continue;
      const year = Number(form.implementation_date.slice(0, 4));
      if (!cohorts.has(year)) cohorts.set(year, { year, base: { total: 0, home: 0 }, alter: { total: 0, home: 0 } });
      const series = cohorts.get(year)[form.is_alter ? "alter" : "base"];
      series.total++;
      if (character.homeEpisodes.size > 0) series.home++;
    }
    return {
      episodeCount: datedEpisodes.length,
      years: [...years].sort((a, b) => a[0] - b[0]).map(([year, count]) => ({ label: String(year), count })),
      months,
      weekdays,
      calendarYears,
      operatorCoverage: [...cohorts.values()].sort((a, b) => a.year - b.year)
    };
  }
  function analyze(release) {
    const rows = release.characters.map(c => ({ ...c, count: 0, episodes: new Set(), perEpisode: new Map(), cameo: 0, cameoEpisodes: new Set(), homes: 0, homeEpisodes: new Set((c.home_episode_ids ?? []).map(id)), absence: null, absenceDays: null, lastPublishedAt: null, implementationAgeDays: daysSince(c.implementation_date) }));
    const characters = new Map(rows.map(c => [c.id, c]));
    const episodes = new Map(release.episodes.map(e => [e.id, { ...e, count: 0, characters: new Set(), cast: new Set(e.cast_character_ids ?? []) }]));
    const homeReady = release.characters.every(c => Array.isArray(c.home_episode_ids));
    const legacyCastReady = release.cast_complete === true && release.episodes.every(e => Array.isArray(e.cast_character_ids));
    const castReady = homeReady || legacyCastReady;
    const orderReady = release.episodes.length > 0 && release.episodes.every(e => Number.isFinite(e.order)) && new Set(release.episodes.map(e => e.order)).size === release.episodes.length;
    const publishedReady = release.episodes.length > 0 && release.episodes.every(e => isoDate(e.published_at) !== null);
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
    const today = chinaToday();
    for (const c of present) {
      if (publishedReady) {
        const latest = Math.max(...[...c.episodes].map(eid => isoDate(episodes.get(eid).published_at)));
        c.lastPublishedAt = new Date(latest).toISOString().slice(0, 10);
        c.absenceDays = daysSince(c.lastPublishedAt, today);
        c.absence = c.absenceDays;
      } else if (orderReady) {
        // Backward-compatible fallback for old releases without dates.  New
        // 339-episode releases always take the date-based branch above.
        c.absence = sequence.length - 1 - Math.max(...[...c.episodes].map(eid => orderIndex.get(eid)));
        c.absenceDays = null;
      }
    }
    const desc = field => (a, b) => b[field] - a[field] || byName(a, b);
    const operatorRows = rows.filter(c => c.is_operator === true && !crossoverOnlyOperators.has(c.name));
    // The local roster folds named alters into their base canonical character.
    // Only the distinct-name pairs below need an explicit family for rankings.
    // These names come from the official alternate-operator set; is_alter alone
    // is not enough because the source game flag also covers unrelated operators.
    const operatorFamilyAliases = new Map([
      ["推进之王", "维娜·维多利亚"],
      ["傀影", "酒神"]
    ]);
    const operatorRankingRows = [...operatorRows.reduce((families, row) => {
      const familyName = operatorFamilyAliases.get(row.name) ?? row.name;
      if (!families.has(familyName)) families.set(familyName, []);
      families.get(familyName).push(row);
      return families;
    }, new Map())].map(([familyName, members]) => {
      const preferred = members.find(row => row.name === familyName) ?? members[0];
      const aggregate = {
        ...preferred,
        name: familyName,
        count: 0,
        episodes: new Set(),
        perEpisode: new Map(),
        homeEpisodes: new Set(),
        homes: 0,
        cameo: 0,
        cameoEpisodes: new Set(),
        stars: null,
        implementationAgeDays: null
      };
      for (const member of members) {
        if (Number.isInteger(member.stars)) aggregate.stars = Math.max(aggregate.stars || 0, member.stars);
        if (Number.isFinite(member.implementationAgeDays)) aggregate.implementationAgeDays = Math.max(aggregate.implementationAgeDays ?? -1, member.implementationAgeDays);
        aggregate.count += member.count;
        member.episodes.forEach(episodeId => aggregate.episodes.add(episodeId));
        member.homeEpisodes.forEach(episodeId => aggregate.homeEpisodes.add(episodeId));
        member.cameoEpisodes.forEach(episodeId => aggregate.cameoEpisodes.add(episodeId));
        aggregate.cameo += member.cameo;
        for (const [episodeId, count] of member.perEpisode) aggregate.perEpisode.set(episodeId, (aggregate.perEpisode.get(episodeId) || 0) + count);
      }
      aggregate.homes = aggregate.homeEpisodes.size;
      return aggregate;
    });
    const operatorAbsenceSort = (a, b) =>
      ((Number.isFinite(b.implementationAgeDays) ? b.implementationAgeDays : -1) -
       (Number.isFinite(a.implementationAgeDays) ? a.implementationAgeDays : -1)) ||
      ((b.stars || 0) - (a.stars || 0)) || byName(a, b);
    const rankings = {
      appearances: [...present].sort(desc("count")),
      searches: [],
      coverage: [...present].sort((a, b) => b.episodes.size - a.episodes.size || b.count - a.count || byName(a, b)),
      rare: [...present].sort((a, b) => a.count - b.count || byName(a, b)),
      cameo: castReady ? present.filter(c => c.cameo > 0).sort(desc("cameo")) : null,
      noHome: castReady ? present.filter(c => c.homes === 0).sort(desc("count")) : null,
      noRhodes: castReady ? operatorRankingRows.filter(c => c.homes === 0 && Number.isFinite(c.implementationAgeDays)).sort(operatorAbsenceSort) : null,
      noAppearance: operatorRankingRows.filter(c => c.count === 0).sort(operatorAbsenceSort),
      absence: (publishedReady || orderReady) ? [...present].sort(desc("absence")) : null
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
    const publication = publicationSummary(release, characters);
    return { characters, episodes, rankings, commonPairs, bidirectionalPairs, oneSidedPairs, records, guestRecords, chart, imageCount, castReady, orderReady, publishedReady, publication };
  }
  globalThis.RhodesStats = { validate, analyze, assetPath, officialURL };
})();
