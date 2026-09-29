const assert = require("node:assert/strict");
const RhodesSearch = require("../search-matching.js");
const pinyinPro = require("../assets/pinyin-pro-3.29.4.js");

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

const episodeMatches = find("aiyafala", "episodes");
assert(episodeMatches.some(item => item.id === "057" && item.kind === "episode"), "pinyin in episode mode should match episode titles");
assert(episodeMatches.some(item => item.id === "eyfl" && item.kind === "character"), "episode mode should retain character suggestions");
console.log("Search matching: typo, pinyin, initials, dash/case normalization, and short-query guard passed");
