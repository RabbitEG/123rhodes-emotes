/* Small matching helpers shared by the public search UI and its tests. */
(() => {
  "use strict";

  const HAN = /\p{Script=Han}/u;
  const LATIN_OR_NUMBER = /[a-z0-9]/i;
  const DASHES = /[‐‑‒–—―−﹣－]/g;
  const variantCache = new WeakMap();

  function normalize(value) {
    return String(value ?? "").trim().normalize("NFKC").toLocaleLowerCase("zh-CN")
      .replace(DASHES, "-").replace(/\s+/g, " ");
  }

  function editDistance(left, right, limit = Infinity) {
    const a = Array.from(left), b = Array.from(right);
    if (Math.abs(a.length - b.length) > limit) return limit + 1;
    let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const current = [i];
      let rowMinimum = i;
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
        rowMinimum = Math.min(rowMinimum, current[j]);
      }
      if (rowMinimum > limit) return limit + 1;
      previous = current;
    }
    return previous[b.length];
  }

  function nearSubstringDistance(query, text, limit) {
    const q = Array.from(query), target = Array.from(text);
    if (!q.length || !target.length || q.length > target.length + limit) return limit + 1;
    let best = limit + 1;
    const minLength = Math.max(1, q.length - limit);
    const maxLength = Math.min(target.length, q.length + limit);
    for (let start = 0; start <= target.length - minLength; start++) {
      for (let length = minLength; length <= maxLength && start + length <= target.length; length++) {
        best = Math.min(best, editDistance(query, target.slice(start, start + length).join(""), limit));
        if (best === 0) return 0;
      }
    }
    return best;
  }

  function pinyinForms(value, pinyinApi) {
    try {
      const result = pinyinApi.pinyin(value, { toneType: "none", type: "array" });
      const parts = (Array.isArray(result) ? result : String(result).split(/\s+/))
        .map(part => normalize(part).replace(/[^a-z0-9]/g, ""))
        .filter(Boolean);
      return { full: parts.join(""), initials: parts.map(part => Array.from(part)[0]).join("") };
    } catch {
      return { full: "", initials: "" };
    }
  }

  function makeVariants(item, pinyinApi) {
    const cached = variantCache.get(item);
    if (cached) return cached;
    const variants = [...new Set([item.name, ...(item.aliases ?? [])].map(normalize).filter(Boolean))].map(value => ({
      value,
      hasHan: HAN.test(value),
      pinyin: pinyinForms(value, pinyinApi),
    }));
    variantCache.set(item, variants);
    return variants;
  }

  function findFuzzy(query, mode, characters, episodes, pinyinApi, limit = 8) {
    const q = normalize(query);
    const queryLength = Array.from(q).length;
    if (!q || !pinyinApi?.pinyin || queryLength < 2) return [];

    const queryHasHan = HAN.test(q);
    const queryHasLatin = LATIN_OR_NUMBER.test(q);
    const qLatin = q.replace(/[^a-z0-9]/g, "");
    const qPinyin = queryHasHan ? pinyinForms(q, pinyinApi).full : qLatin;
    const docs = [
      ...[...characters].map(item => ({ kind: "character", item, id: item.id, name: item.name, aliases: item.aliases ?? [] })),
      ...(mode === "episodes" ? [...episodes].map(item => ({ kind: "episode", item, id: item.id, name: item.name, aliases: [] })) : []),
    ];
    const ranked = [];

    for (const doc of docs) {
      let best = null;
      for (const variant of makeVariants(doc.item, pinyinApi)) {
        if (queryHasHan && variant.hasHan) {
          const qLength = Array.from(q).length;
          if (qLength >= 3) {
            const distance = nearSubstringDistance(q, variant.value, 1);
            if (distance <= 1 && (!best || 130 + distance < best.score)) {
              best = { score: 130 + distance, matchReason: "错字近似" };
            }
          }
        }

        if (!qPinyin || !variant.pinyin.full) continue;
        if (queryHasHan) {
          // Two-character queries only get exact full-pinyin matches; broader
          // edit-distance matching is too noisy for short character names.
          const distanceLimit = queryLength === 2 ? 0 : qPinyin.length >= 9 ? 2 : qPinyin.length >= 5 ? 1 : 0;
          // A full Chinese name should compare against a full pinyin name.
          // Substring matching here creates misleading near-homophones whose
          // syllables happen to appear in a different order in another name.
          const distance = editDistance(qPinyin, variant.pinyin.full, distanceLimit);
          if (distance <= distanceLimit) {
            const score = distance === 0 ? 100 : 150 + distance;
            if (!best || score < best.score) best = { score, matchReason: distance === 0 ? "同音拼写" : "拼音近似" };
          }
        } else if (queryHasLatin) {
          const romanLength = qLatin.length;
          if (romanLength >= 3 && (variant.pinyin.full.startsWith(qLatin) || variant.pinyin.initials.startsWith(qLatin))) {
            const isInitials = variant.pinyin.initials.startsWith(qLatin) && !variant.pinyin.full.startsWith(qLatin);
            const score = variant.pinyin.full === qLatin ? 100 : isInitials ? 115 : 110;
            if (!best || score < best.score) best = { score, matchReason: isInitials ? "拼音首字母" : "拼音" };
          }
          const distanceLimit = romanLength >= 9 ? 2 : romanLength >= 5 ? 1 : 0;
          if (distanceLimit) {
            const distance = nearSubstringDistance(qLatin, variant.pinyin.full, distanceLimit);
            if (distance <= distanceLimit) {
              const score = 150 + distance;
              if (!best || score < best.score) best = { score, matchReason: "拼音近似" };
            }
            const rawDistance = nearSubstringDistance(q, variant.value, distanceLimit);
            if (rawDistance <= distanceLimit) {
              const score = 170 + rawDistance;
              if (!best || score < best.score) best = { score, matchReason: "文字近似" };
            }
          }
        }
      }
      if (best) ranked.push({ ...doc, ...best });
    }

    return ranked.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name, "zh-CN", { numeric: true }))
      .slice(0, Math.max(1, limit));
  }

  const api = { normalize, editDistance, findFuzzy };
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof globalThis !== "undefined") globalThis.RhodesSearch = api;
})();
