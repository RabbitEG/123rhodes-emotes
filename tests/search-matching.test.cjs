const assert = require("node:assert/strict");
const RhodesSearch = require("../search-matching.js");
const pinyinPro = require("../assets/pinyin-pro-3.29.4.js");
require("../stats.js");
const RhodesStats = globalThis.RhodesStats;

const characters = [
  { id: "eyfl", name: "艾雅法拉", aliases: [], count: 5 },
  { id: "anjl", name: "安洁莉娜", aliases: [], count: 4 },
  { id: "wrong-order", name: "卡涅利安", aliases: [], count: 1 },
  { id: "kluosi", name: "克洛丝", aliases: [], count: 3 },
  { id: "doctor", name: "博士", aliases: [], count: 2 },
  { id: "wrong-two-char-typo", name: "博土", aliases: [], count: 1 },
  { id: "lingzhi", name: "灵知", aliases: [], count: 1 },
];
const episodes = [
  { id: "057", name: "057_艾雅法拉篇", count: 5 },
  { id: "001", name: "001_测试篇", count: 1 },
];

assert.equal(RhodesSearch.normalize("castle—3"), "castle-3");
assert.equal(RhodesSearch.normalize("ＣＡＳＴＬＥ－３"), "castle-3");
assert.equal(RhodesSearch.editDistance("克洛斯", "克洛丝", 1), 1);

function find(query, mode = "expressions") {
  return RhodesSearch.findFuzzy(query, mode, characters.values(), episodes.values(), pinyinPro, 8);
}

assert.equal(find("阿雅法拉")[0]?.id, "eyfl", "a one-character Chinese typo should find the canonical operator");
assert.equal(find("安洁丽娜")[0]?.id, "anjl", "same-sound Chinese spelling should be found through pinyin");
assert(!find("安洁丽娜").some(item => item.id === "wrong-order"), "pinyin edit distance must not match similarly composed syllables in a different order");
assert.equal(find("克洛斯")[0]?.id, "kluosi", "same-sound spelling variants should be found");
assert.equal(find("灵芝")[0]?.id, "lingzhi", "two-character exact-pinyin typo should find the canonical operator");
assert(!find("博士").some(item => item.id === "wrong-two-char-typo"), "two-character queries must not use general edit-distance matching");
assert.equal(find("aiyafala")[0]?.id, "eyfl", "full pinyin input should find a Chinese name");
assert.equal(find("ayfl")[0]?.id, "eyfl", "pinyin initials should find a Chinese name");
assert.equal(find("阿").length, 0, "single-character Chinese queries must not trigger fuzzy matches");
const soraAlternate = { id: "sora", name: "空爆", aliases: [], alter_names: ["雷狼龙S空爆"] };
const soraPinyin = RhodesSearch.findFuzzy("leilanglong", "expressions", [soraAlternate], [], pinyinPro, 8)[0];
assert.equal(soraPinyin?.matchType, "pinyin_prefix", "full pinyin prefix should be treated as a direct spelling match");
assert.equal(soraPinyin?.matchedName, "雷狼龙S空爆", "fuzzy ranking should retain which canonical/alternate name matched");
const soraTypo = RhodesSearch.findFuzzy("雷狼龍", "expressions", [soraAlternate], [], pinyinPro, 8)[0];
assert.equal(soraTypo?.matchReason, "错字近似");
assert.equal(soraTypo?.matchType, "han_typo");
assert.equal(soraTypo?.name, "空爆", "typo matches should still use the canonical label");
assert.equal(soraTypo?.matchedName, "雷狼龙S空爆", "even typo matching should preserve matched-variant metadata without changing its label");

const amiyaFormsRelease = RhodesStats.validate({
  characters: [
    { id: "amiya", name: "阿米娅", aliases: [], is_operator: true, stars: 5, home_episode_ids: [] },
  ],
  episodes: [],
  instances: [],
  operator_forms: [
    { character_id: "amiya", name: "阿米娅", is_alter: false, implementation_date: "2019-04-30" },
    { character_id: "amiya", name: "阿米娅（近卫）", is_alter: true, implementation_date: "2020-11-01" },
    { character_id: "amiya", name: "阿米娅（医疗）", is_alter: true, implementation_date: "2024-05-01" },
  ],
});
assert.deepEqual(amiyaFormsRelease.characters.map(character => character.name), ["阿米娅"]);
assert.deepEqual(amiyaFormsRelease.characters[0].alter_names, ["阿米娅（近卫）", "阿米娅（医疗）"]);
assert.deepEqual(amiyaFormsRelease.characters[0].aliases, [], "official forms are not player aliases");

const oldPublicCharacterIds = RhodesStats.validate({
  characters: [
    { id: "d02df707d241b8fb", name: "推进之王", aliases: [] },
    { id: "cf34a85641597783", name: "傀影", aliases: [] },
  ],
  episodes: [],
  instances: [],
});
assert.equal(oldPublicCharacterIds.canonical_id_redirects["60ae5aa63d1a0fbc"], "d02df707d241b8fb");
assert.equal(oldPublicCharacterIds.canonical_id_redirects["a2c0878923815ac9"], "cf34a85641597783");

const alterAliasRelease = RhodesStats.validate({
  characters: [
    { id: "star-source", name: "星源", aliases: [] },
    { id: "flame", name: "炎熔", aliases: [] },
    { id: "near-light", name: "临光", aliases: [] },
    { id: "black-horn", name: "黑角", aliases: [] },
    { id: "night-blade", name: "夜刀", aliases: [] },
  ],
  episodes: [{ id: "057", name: "057_溯光星源篇", official_url: "https://comic.hypergryph.com/comic/6253/test" }],
  instances: [],
  operator_forms: [
    { character_id: "star-source", name: "星源", is_alter: false, implementation_date: "2021-11-01" },
    { character_id: "star-source", name: "溯光星源", is_alter: true, implementation_date: "2025-11-01" },
    { character_id: "flame", name: "炎熔", is_alter: false, implementation_date: "2019-04-30" },
    { character_id: "flame", name: "炎狱炎熔", is_alter: true, implementation_date: "2021-02-05" },
    { character_id: "near-light", name: "临光", is_alter: false, implementation_date: "2020-05-01" },
    { character_id: "near-light", name: "耀骑士临光", is_alter: true, implementation_date: "2021-11-01" },
    { character_id: "black-horn", name: "黑角", is_alter: false, implementation_date: "2019-04-30" },
    { character_id: "black-horn", name: "火龙S黑角", is_alter: true, implementation_date: "2023-03-07" },
    { character_id: "night-blade", name: "夜刀", is_alter: false, implementation_date: "2019-04-30" },
    { character_id: "night-blade", name: "麒麟R夜刀", is_alter: true, implementation_date: "2023-03-07" },
  ],
});
assert(alterAliasRelease.characters[0].alter_names.includes("溯光星源"), "a formal alter should map to its canonical character as a form name");
assert(!alterAliasRelease.characters[0].aliases.includes("溯光星源"), "a formal alter must not be duplicated in player aliases");
for (const [id, alterName] of [["flame", "炎狱炎熔"], ["near-light", "耀骑士临光"], ["black-horn", "火龙S黑角"], ["night-blade", "麒麟R夜刀"]]) {
  assert(alterAliasRelease.characters.find(character => character.id === id).alter_names.includes(alterName), `${alterName} should display under its base canonical character`);
}
const canonicalMerge = RhodesStats.validate({
  characters: [
    { id: "push", name: "推进之王", aliases: [], is_operator: true, stars: 6, home_episode_ids: ["ep1"] },
    { id: "phantom", name: "傀影", aliases: [], is_operator: true, stars: 6 },
  ],
  episodes: [
    { id: "ep1", name: "001_推进之王篇", order: 1, cast_character_ids: ["push"], official_url: "https://comic.hypergryph.com/comic/6253/ep1" },
    { id: "ep2", name: "002_维娜·维多利亚篇", order: 2, cast_character_ids: ["push"], official_url: "https://comic.hypergryph.com/comic/6253/ep2" },
  ],
  instances: [
    { id: "base-crop", character_id: "push", episode_id: "ep1", crop_url: "/media/crops/test.webp" },
    { id: "alter-crop", character_id: "push", episode_id: "ep2", crop_url: "/media/crops/test.webp" },
  ],
  operator_forms: [
    { character_id: "push", name: "推进之王", is_alter: false, implementation_date: "2019-04-30" },
    { character_id: "push", name: "维娜·维多利亚", is_alter: true, implementation_date: "2024-10-09" },
    { character_id: "phantom", name: "傀影", is_alter: false, implementation_date: "2020-04-21" },
    { character_id: "phantom", name: "酒神", is_alter: true, implementation_date: "2025-06-05" },
  ],
});
assert.deepEqual(canonicalMerge.characters.map(character => character.name), ["推进之王", "傀影"]);
assert.deepEqual(canonicalMerge.instances.map(item => item.character_id), ["push", "push"]);
assert.deepEqual(canonicalMerge.episodes.map(episode => episode.cast_character_ids), [["push"], ["push"]]);
assert(!canonicalMerge.characters[0].aliases.includes("维娜·维多利亚"));
assert.deepEqual(canonicalMerge.characters[0].alter_names, ["维娜·维多利亚"]);
assert.deepEqual(canonicalMerge.characters[1].alter_names, ["酒神"]);
assert.equal(RhodesStats.analyze(canonicalMerge).characters.get("push").count, 2);

const monsterHunterAlterMerge = RhodesStats.validate({
  characters: [
    { id: "sora", name: "空爆", aliases: [], is_operator: true, stars: 3, home_episode_ids: ["sora-home"] },
    { id: "zilan", name: "梓兰", aliases: [], is_operator: true, stars: 3, home_episode_ids: ["zilan-home"] },
  ],
  episodes: [
    { id: "sora-home", name: "001_空爆篇", order: 1, cast_character_ids: ["sora"], official_url: "https://comic.hypergryph.com/comic/6253/sora-home" },
    { id: "sora-collab", name: "002_空爆联动篇", order: 2, cast_character_ids: ["sora"], official_url: "https://comic.hypergryph.com/comic/6253/sora-collab" },
    { id: "zilan-home", name: "003_梓兰篇", order: 3, cast_character_ids: ["zilan"], official_url: "https://comic.hypergryph.com/comic/6253/zilan-home" },
    { id: "zilan-collab", name: "004_梓兰联动篇", order: 4, cast_character_ids: ["zilan"], official_url: "https://comic.hypergryph.com/comic/6253/zilan-collab" },
  ],
  instances: [
    { id: "sora-base-crop", character_id: "sora", episode_id: "sora-home", crop_url: "/media/crops/test.webp" },
    { id: "sora-alter-crop", character_id: "sora", episode_id: "sora-collab", crop_url: "/media/crops/test.webp" },
    { id: "zilan-base-crop", character_id: "zilan", episode_id: "zilan-home", crop_url: "/media/crops/test.webp" },
    { id: "zilan-alter-crop", character_id: "zilan", episode_id: "zilan-collab", crop_url: "/media/crops/test.webp" },
  ],
  operator_forms: [
    { character_id: "sora", name: "空爆", is_alter: false, implementation_date: "2019-05-23" },
    { character_id: "sora", name: "雷狼龙S空爆", is_alter: true, implementation_date: "2026-06-01" },
    { character_id: "zilan", name: "梓兰", is_alter: false, implementation_date: "2019-04-30" },
    { character_id: "zilan", name: "焰狐龙梓兰", is_alter: true, implementation_date: "2026-06-01" },
  ],
});
assert.deepEqual(monsterHunterAlterMerge.characters.map(character => character.name), ["空爆", "梓兰"]);
assert.deepEqual(monsterHunterAlterMerge.characters.map(character => character.alter_names), [["雷狼龙S空爆"], ["焰狐龙梓兰"]]);
assert.deepEqual(monsterHunterAlterMerge.instances.map(item => item.character_id), ["sora", "thunder-sora", "zilan", "fox-zilan"]);
assert.deepEqual(monsterHunterAlterMerge.episodes.map(episode => episode.cast_character_ids), [["sora"], ["thunder-sora"], ["zilan"], ["fox-zilan"]]);
assert.deepEqual(monsterHunterAlterMerge.operator_forms.map(form => form.character_id), ["sora", "sora", "zilan", "zilan"]);

const episodeMatches = find("aiyafala", "episodes");
assert(episodeMatches.some(item => item.id === "057" && item.kind === "episode"), "pinyin in episode mode should match episode titles");
assert(episodeMatches.some(item => item.id === "eyfl" && item.kind === "character"), "episode mode should retain character suggestions");
console.log("Search matching: typo, pinyin, two-character exact-pinyin, initials, normalization, and short-query guard passed");
