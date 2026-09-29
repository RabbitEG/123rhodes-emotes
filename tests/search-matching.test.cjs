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
assert.equal(find("aiyafala")[0]?.id, "eyfl", "full pinyin input should find a Chinese name");
assert.equal(find("ayfl")[0]?.id, "eyfl", "pinyin initials should find a Chinese name");
assert.equal(find("阿雅").length, 0, "short Chinese queries must not trigger fuzzy matches");

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
});
assert(alterAliasRelease.characters[0].aliases.includes("溯光星源"), "a reviewed alter name should search as its canonical person's alias");
for (const [id, alterName] of [["flame", "炎狱炎熔"], ["near-light", "耀骑士临光"], ["black-horn", "火龙S黑角"], ["night-blade", "麒麟R夜刀"]]) {
  assert(alterAliasRelease.characters.find(character => character.id === id).alter_names.includes(alterName), `${alterName} should display under its base canonical character`);
}
const canonicalMerge = RhodesStats.validate({
  characters: [
    { id: "push", name: "推进之王", aliases: [], is_operator: true, stars: 6, home_episode_ids: ["ep1"] },
    { id: "vina", name: "维娜·维多利亚", aliases: [], is_operator: true, stars: 6, home_episode_ids: ["ep2"] },
    { id: "phantom", name: "傀影", aliases: [], is_operator: true, stars: 6 },
    { id: "booze", name: "酒神", aliases: [], is_operator: true, stars: 6 },
  ],
  episodes: [
    { id: "ep1", name: "001_推进之王篇", order: 1, cast_character_ids: ["push", "vina"], official_url: "https://comic.hypergryph.com/comic/6253/ep1" },
    { id: "ep2", name: "002_维娜·维多利亚篇", order: 2, cast_character_ids: ["vina"], official_url: "https://comic.hypergryph.com/comic/6253/ep2" },
  ],
  instances: [
    { id: "base-crop", character_id: "push", episode_id: "ep1", crop_url: "/media/crops/test.webp" },
    { id: "alter-crop", character_id: "vina", episode_id: "ep2", crop_url: "/media/crops/test.webp" },
  ],
  operator_forms: [
    { character_id: "push", is_alter: false, implementation_date: "2019-04-30" },
    { character_id: "vina", is_alter: true, implementation_date: "2024-10-09" },
  ],
});
assert.deepEqual(canonicalMerge.characters.map(character => character.name), ["推进之王", "傀影"]);
assert.deepEqual(canonicalMerge.instances.map(item => item.character_id), ["push", "push"]);
assert.deepEqual(canonicalMerge.episodes.map(episode => episode.cast_character_ids), [["push"], ["push"]]);
assert(canonicalMerge.characters[0].aliases.includes("维娜·维多利亚"));
assert.deepEqual(canonicalMerge.characters[0].alter_names, ["维娜·维多利亚"]);
assert.equal(RhodesStats.analyze(canonicalMerge).characters.get("push").count, 2);
assert(canonicalMerge.canonical_id_redirects.vina === "push", "old public IDs should redirect to canonical IDs");

const episodeMatches = find("aiyafala", "episodes");
assert(episodeMatches.some(item => item.id === "057" && item.kind === "episode"), "pinyin in episode mode should match episode titles");
assert(episodeMatches.some(item => item.id === "eyfl" && item.kind === "character"), "episode mode should retain character suggestions");
console.log("Search matching: typo, pinyin, initials, dash/case normalization, and short-query guard passed");
