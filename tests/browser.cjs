/* Browser acceptance uses synthetic data intercepted in memory, never a release file. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
require("../stats.js");
const { validate, analyze } = globalThis.RhodesStats;
const base = process.env.SITE_TEST_URL || "http://127.0.0.1:4173";
const output = path.join(__dirname, "../test-results");
fs.mkdirSync(output, { recursive: true });
const characters = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "零"].map((name, i) => ({ id: "c" + i, name: "测试" + name, aliases: i === 0 ? ["别名甲"] : [] }));
const episodes = ["001_测试篇", "057_测试篇", "058_测试篇", "059_测试篇"].map((name, i) => ({ id: "e" + i, name, order: i + 1, cast_character_ids: [["c0"], ["c0", "c1"], ["c2"], []][i], official_url: "https://comic.hypergryph.com/comic/6253/test-" + i }));
const instances = [];
function add(c, e, count) { for (let i = 0; i < count; i++) instances.push({ id: "i" + instances.length, character_id: "c" + c, episode_id: "e" + e, image_id: "image" + e, crop_url: "/media/crops/test.webp", source_preview_url: "/media/source-previews/test.webp", sort_key: String(instances.length).padStart(3, "0") }); }
add(0, 0, 39); add(0, 1, 1); add(1, 0, 1); add(1, 1, 3); add(2, 0, 1); add(2, 2, 1); add(3, 1, 1); add(4, 1, 1); add(5, 2, 1); add(6, 3, 1);
const data = { release_id: "synthetic-test-only", generated_at: "2026-09-23T00:00:00Z", characters, episodes, instances, cast_complete: true };
const a = analyze(validate(data));
assert.equal(instances.length, 50);
assert.equal(a.imageCount, 4);
assert.equal(a.characters.get("c0").count, 40);
assert.deepEqual(a.rankings.searches, []);
assert.equal(a.characters.get("c0").episodes.size, 2);
assert.equal(a.commonPairs.find(p => p.first === "c0" && p.second === "c1").count, 2);
assert.equal(a.records[0].count, 39);
assert.equal(a.rankings.rare[0].count, 1);
assert(!a.rankings.rare.some(c => c.id === "c7"));
assert.equal(a.characters.get("c1").cameo, 1);
assert.equal(a.characters.get("c0").cameo, 0);
assert.equal(a.rankings.noHome.length, 4);
assert.equal(a.characters.get("c0").absence, 2);
assert.equal(a.chart.reduce((n, c) => n + c.count, 0), 50);
assert.equal(analyze(validate({ ...data, cast_complete: false })).rankings.cameo, null);
assert.equal(analyze(validate({ ...data, episodes: episodes.map(e => ({ ...e, order: undefined })) })).rankings.absence, null);
assert.throws(() => validate({ ...data, instances: [...instances, instances[0]] }));
assert.throws(() => validate({ ...data, instances: [{ ...instances[0], crop_url: "https://example.com/tracking.png" }] }));
assert.throws(() => validate({ ...data, episodes: [{ ...episodes[0], official_url: "javascript:alert(1)" }] }));
const publicationFixture = validate({
  characters: [{ id: "op", name: "测试干员", is_operator: true, aliases: [], home_episode_ids: ["e22"] }],
  episodes: [
    { id: "e22", name: "001_测试篇", order: 1, published_at: "2022-01-14", official_url: "https://comic.hypergryph.com/comic/6253/a" },
    { id: "e23", name: "002_测试篇", order: 2, published_at: "2022-01-15", official_url: "https://comic.hypergryph.com/comic/6253/b" },
    { id: "e24", name: "003_测试篇", order: 3, published_at: "2023-02-20", official_url: "https://comic.hypergryph.com/comic/6253/c" }
  ],
  instances: [],
  operator_forms: [
    { character_id: "op", is_alter: false, implementation_date: "2019-04-29" },
    { character_id: "op", is_alter: true, implementation_date: "2021-02-05" },
    { character_id: "op", is_alter: false, implementation_date: null }
  ]
});
const publicationFixtureStats = analyze(publicationFixture).publication;
assert.equal(publicationFixtureStats.episodeCount, 3);
assert.deepEqual(publicationFixtureStats.years.map(row => [row.label, row.count]), [["2022", 2], ["2023", 1]]);
assert.equal(publicationFixtureStats.months[0].count, 2);
assert.equal(publicationFixtureStats.weekdays[4].count, 1);
assert.equal(publicationFixtureStats.weekdays[5].count, 1);
assert.deepEqual(publicationFixtureStats.calendarYears.map(row => row.year), [2023, 2022]);
assert.equal(publicationFixtureStats.calendarYears.flatMap(row => row.weeks).reduce((sum, week) => sum + week.count, 0), 3);
assert.deepEqual(publicationFixtureStats.operatorCoverage.find(row => row.year === 2019), { year: 2019, total: 1, home: 1 });
assert.deepEqual(publicationFixtureStats.operatorCoverage.find(row => row.year === 2021), { year: 2021, total: 1, home: 1 });
const browserData = {
  ...data,
  characters: characters.map((character, index) => ({
    ...character,
    is_operator: index < 2,
    home_episode_ids: index === 0 ? ["e0"] : [],
  })),
  episodes: episodes.map((episode, index) => ({ ...episode, published_at: ["2022-01-14", "2022-01-15", "2023-02-20", "2026-09-05"][index] })),
  operator_forms: [
    { character_id: "c0", is_alter: false, implementation_date: "2019-04-29" },
    { character_id: "c0", is_alter: true, implementation_date: "2021-02-05" },
  ]
};
let servedData = browserData;
const selfCameo = analyze(validate({
  characters: [
    { id: "amiya", name: "阿米娅", aliases: [], home_episode_ids: [] },
    { id: "doctor", name: "博士", aliases: [], home_episode_ids: [] },
    { id: "skadi", name: "斯卡蒂", aliases: [], home_episode_ids: [] },
    { id: "black", name: "黑", aliases: [], home_episode_ids: [] }
  ],
  episodes: ["001_阿米娅篇", "002_阿米娅(医疗)篇", "003_博士篇", "004_浊心斯卡蒂篇", "005_罗小黑篇"].map((name, i) => ({ id: "home" + i, name, order: i + 1, official_url: "https://comic.hypergryph.com/comic/6253/home-" + i })),
  instances: ["amiya", "amiya", "amiya", "skadi", "black"].map((character_id, i) => ({ id: "home-instance-" + i, character_id, episode_id: "home" + i, crop_url: "/media/crops/test.webp" }))
}));
assert.equal(selfCameo.characters.get("amiya").cameo, 1);
assert.deepEqual([...selfCameo.characters.get("amiya").homeEpisodes].sort(), ["home0", "home1"]);
assert.equal(selfCameo.characters.get("skadi").cameo, 0);
assert.equal(selfCameo.characters.get("black").cameo, 1);
assert.deepEqual(selfCameo.guestRecords.map(row => row.episode).sort(), ["home2", "home4"]);
console.log("Statistics: counts, deduplication, cast, chronology, validation passed");

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE, args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    const page = await context.newPage();
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", message => { if (/violates.*(?:Security|policy)|Refused to/i.test(message.text())) errors.push(message.text()); });
    let csp = fs.readFileSync(path.join(__dirname, "../_headers"), "utf8").split("\n").find(line => line.includes("Content-Security-Policy:")).split("Content-Security-Policy: ")[1];
    await page.route(base + "/**", async route => {
      if (route.request().resourceType() !== "document") return route.continue();
      const pathname = new URL(route.request().url()).pathname;
      const filename = pathname === "/" ? "index.html" : pathname.slice(1);
      return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: fs.readFileSync(path.join(__dirname, "..", filename)), headers: { "content-security-policy": csp } });
    });
    await page.route(base + "/api/analytics/search-ranking", route => route.fulfill({ json: { items: [
      { id: "c1", hot: 37 }, { id: "c0", hot: 12 }, { id: "retired-id", hot: 99 },
    ] } }));
    await page.goto(base);
    await page.locator("#search-status:has-text('还没上架')").waitFor({ state: "attached" });
    assert.equal(await page.locator("#totals strong").allTextContents().then(x => x.join(",")), "—,—,—,—");
    await page.screenshot({ path: output + "/desktop-empty.png", fullPage: true });
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><rect x="10" y="10" width="160" height="160" rx="45" fill="#d7c7ee"/><circle cx="65" cy="75" r="7" fill="#665078"/><circle cx="115" cy="75" r="7" fill="#665078"/><path d="M70 115 Q90 135 110 115" stroke="#665078" stroke-width="5" fill="none"/></svg>';
    await page.route("**/media/**", route => route.fulfill({ contentType: "image/svg+xml", body: svg }));
    await page.route("**/data/release.json", route => route.fulfill({ json: servedData }));
    await page.reload();
    await page.locator("#totals article:first-child strong:has-text('4')").waitFor();
    assert.deepEqual(await page.locator("#totals strong").allTextContents(), ["4", "50", "8", "4"]);
    assert.equal(await page.locator(".legend-row").count(), 7);
    assert.equal(await page.locator(".ranking-panels > .ranking-card").count(), 3, "The ranking area should use three equal columns");
    assert.equal(await page.locator("#ranking-kind option").count(), 4, "The character ranking includes the rare view");
    assert.equal(await page.locator("#missing-ranking-kind option").count(), 2, "The missing-character ranking keeps two selectable views");
    assert.equal(await page.locator("#results-section").count(), 0);
    await page.screenshot({ path: output + "/desktop-data.png", fullPage: true });
    await page.locator("#site-search").fill("别名"); await page.locator("#site-search").press("Enter");
    await page.waitForURL("**/search.html?*"); await page.waitForSelector(".expression-card");
    assert.equal(await page.locator("#result-count").textContent(), "40 张表情");
    assert.equal(await page.locator(".expression-card").count(), 36);
    await page.locator("#load-more").click();
    assert.equal(await page.locator(".expression-card").count(), 40);
    assert.equal(await page.locator(".expression-card").first().locator(".episode-button").count(), 1, "The first search result should retain its episode label");
    await page.locator(".expression-card").first().hover();
    await page.locator(".source-peek img").first().waitFor({ state: "visible", timeout: 5000 });
    assert(await page.locator(".source-peek img").first().isVisible(), "Desktop hover must show original-source preview");
    assert.equal(await page.locator(".source-peek").first().evaluate(element => getComputedStyle(element).pointerEvents), "none", "The source preview must not intercept the pointer over adjacent cards");
    await page.locator("#site-search").fill("测试篇"); await page.locator('[data-mode="episodes"]').click();
    assert.equal(await page.locator("#site-search").inputValue(), "测试篇");
    assert.equal(await page.locator(".episode-card").count(), 4);
    await page.locator('.episode-card[data-episode="e1"] .episode-cover').click();
    await page.waitForURL("**/episode.html?id=e1");
    await page.locator(".episode-gallery .expression-card").waitFor();
    assert.equal(await page.locator(".episode-gallery .expression-card").count(), 6);
    assert.equal(await page.locator(".episode-profile h1").textContent(), "057_测试篇");
    assert.equal(await page.locator(".episode-profile [data-character]").count(), 4);
    assert.equal(await page.locator(".episode-gallery .crop-wrap").first().getAttribute("href"), "/instance.html?id=i39");
    await page.reload();
    await page.waitForSelector(".episode-gallery .expression-card");
    assert.equal(await page.locator(".episode-gallery .expression-card").count(), 6);
    servedData = {
      ...browserData,
      characters: browserData.characters.map(character => character.id === "c1" ? { ...character, home_episode_ids: ["e0"] } : character),
    };
    await page.goto(base + "/episode.html?id=e0");
    await page.waitForSelector(".episode-profile .character-episodes [data-character]");
    const episodeCharacterChips = page.locator(".episode-profile .character-episodes [data-character]");
    assert.deepEqual(await episodeCharacterChips.evaluateAll(elements => elements.slice(0, 2).map(element => element.dataset.character)), ["c1", "c0"], "Home character should precede other characters on episode profile");
    assert.equal(await episodeCharacterChips.first().locator(".home-association-label").textContent(), "本篇", "Home character should use the shared home styling");
    servedData = {
      ...browserData,
      characters: [...browserData.characters, { id: "push", name: "推进之王", aliases: [], home_episode_ids: [] }],
      episodes: browserData.episodes.map((episode, index) => index === 1 ? { ...episode, name: "057_维娜·维多利亚篇" } : episode),
      instances: [...browserData.instances,
        { id: "push-home", character_id: "push", episode_id: "e1", image_id: "image1", crop_url: "/media/crops/test.webp", source_preview_url: "/media/source-previews/test.webp", sort_key: "900" },
        { id: "push-away", character_id: "push", episode_id: "e0", image_id: "image0", crop_url: "/media/crops/test.webp", source_preview_url: "/media/source-previews/test.webp", sort_key: "901" },
      ],
    };
    await page.goto(base + "/character.html?id=push");
    await page.waitForSelector(".character-profile");
    const characterEpisodeChips = page.locator(".character-episodes [data-episode]");
    assert.deepEqual(await characterEpisodeChips.evaluateAll(elements => elements.map(element => element.dataset.episode)), ["e1", "e0"], "Canonical character's alter home episode should be listed first");
    assert.equal(await characterEpisodeChips.first().locator(".home-association-label").textContent(), "本篇", "Home episode should be visibly labeled and styled differently");
    assert.equal(await page.locator(".character-gallery .expression-card").first().locator(".episode-button").textContent(), "057_维娜·维多利亚篇", "The first character gallery card should show its episode");
    servedData = {
      ...browserData,
      characters: [...browserData.characters, { id: "chen", name: "陈", is_operator: true, aliases: ["假日威龙陈", "赤刃明霄陈"], home_episode_ids: [] }],
      operator_forms: [...browserData.operator_forms,
        { character_id: "chen", is_alter: false, implementation_date: "2019-07-09" },
        { character_id: "chen", is_alter: true, implementation_date: "2021-08-03" },
        { character_id: "chen", is_alter: true, implementation_date: "2026-02-10" },
      ],
      instances: [...browserData.instances, { id: "chen-instance", character_id: "chen", episode_id: "e0", image_id: "image0", crop_url: "/media/crops/test.webp", source_preview_url: "/media/source-previews/test.webp", sort_key: "999" }],
    };
    await page.goto(base + "/character.html?id=chen");
    await page.waitForSelector(".character-prts-links a");
    assert.equal(await page.locator(".character-profile h1").textContent(), "陈（假日威龙陈、赤刃明霄陈）", "Alter names should follow implementation order");
    const chenPrtsLinks = page.locator(".character-prts-links a");
    assert.deepEqual(await chenPrtsLinks.evaluateAll(elements => elements.map(element => element.getAttribute("href"))), ["陈", "假日威龙陈", "赤刃明霄陈"].map(name => "https://prts.wiki/w/" + encodeURIComponent(name)), "Each canonical/alter form should link to its PRTS entry in order");
    servedData = browserData;
    await page.goto(base + "/character.html?id=c2");
    await page.waitForSelector(".character-prts-links a");
    assert.deepEqual(await page.locator(".character-prts-links a").evaluateAll(elements => elements.map(element => element.getAttribute("href"))), ["https://prts.wiki/w/测试丙"], "Non-operator should link to its single character entry");
    await page.goto(base); await page.waitForSelector(".legend-row");
    await page.locator("#ranking-kind").selectOption("rare");
    assert(!(await page.locator("#character-ranking").textContent()).includes("测试零"));
    await page.locator("#ranking-kind").selectOption("searches");
    await page.waitForFunction(() => document.querySelector("#character-ranking")?.textContent.includes("37"));
    assert((await page.locator("#character-ranking .rank-row").first().textContent()).includes("测试乙"), "Search ranking should sort by aggregate counts");
    assert.equal(await page.locator("#character-ranking .rank-row").count(), 2, "Unknown/retired IDs should not appear in the public ranking");
    await page.locator("#missing-ranking-kind").selectOption("noRhodes");
    assert((await page.locator("#missing-rank-note").textContent()).includes("实装天数"));
    await page.locator("#pair-ranking .rank-row").first().click();
    await page.waitForURL("**/search.html?*"); await page.waitForSelector(".expression-card");
    assert.equal(await page.locator("#result-count").textContent(), "44 张表情");
    await page.goto(base); await page.waitForSelector(".legend-row");
    await page.locator("#record-ranking .rank-row").first().click();
    await page.waitForURL("**/search.html?*"); await page.waitForSelector(".expression-card");
    assert.equal(await page.locator("#result-count").textContent(), "39 张表情");
    await page.locator("#clear-search").click();
    assert.equal(await page.locator("#result-count").textContent(), "50 张表情");
    await page.goto(base); await page.waitForSelector(".legend-row");
    assert.equal(await page.locator(".ribbon-group").first().locator("[data-instance]").count(), 16);
    await page.locator(".site-header").hover();
    const beforeScroll = await page.locator("#ribbon").evaluate(e => e.scrollLeft);
    await page.waitForTimeout(600);
    const afterScroll = await page.locator("#ribbon").evaluate(e => e.scrollLeft);
    assert(afterScroll > beforeScroll && afterScroll - beforeScroll < 40, "Marquee must move continuously at slow speed");
    await page.locator("#ribbon").hover();
    const hoverScroll = await page.locator("#ribbon").evaluate(e => e.scrollLeft);
    await page.waitForTimeout(600);
    assert.equal(await page.locator("#ribbon").evaluate(e => e.scrollLeft), hoverScroll, "Hover should pause the marquee");
    await page.locator("#site-search").hover();
    const resumedScroll = await page.locator("#ribbon").evaluate(e => e.scrollLeft);
    await page.waitForTimeout(600);
    assert((await page.locator("#ribbon").evaluate(e => e.scrollLeft)) > resumedScroll, "Marquee should resume after pointer leaves");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForTimeout(100);
    const reducedMotionScroll = await page.locator("#ribbon").evaluate(e => e.scrollLeft);
    await page.waitForTimeout(600);
    assert.equal(await page.locator("#ribbon").evaluate(e => e.scrollLeft), reducedMotionScroll, "Reduced-motion preference should stop the marquee");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base);
    await page.waitForSelector(".legend-row");
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: output + "/mobile-data.png", fullPage: true });
    await page.locator("#site-search").fill("别名"); await page.locator("#site-search").press("Enter");
    await page.waitForURL("**/search.html?*"); await page.waitForSelector(".expression-card");
    await page.locator(".source-toggle").first().click();
    await page.locator(".source-peek img").first().waitFor({ state: "visible", timeout: 5000 });
    assert(await page.locator(".source-peek img").first().isVisible());
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".expression-card.preview-open").count(), 0);
    await page.route("**/data/release.json", route => route.fulfill({ json: { ...browserData, cast_complete: false, characters: browserData.characters.map(c => ({ ...c, home_episode_ids: undefined })), episodes: browserData.episodes.map(e => ({ ...e, order: undefined })) } }));
    await page.goto(base);
    await page.waitForSelector(".legend-row");
    assert((await page.locator("#guest-ranking").textContent()).includes("本篇关系"));
    await page.locator("#missing-ranking-kind").selectOption("noRhodes");
    assert((await page.locator("#missing-ranking").textContent()).includes("本篇关系"));
    await page.route("**/data/release.json", route => route.fulfill({ status: 500, body: "error" }));
    await page.reload(); await page.waitForSelector("#retry");
    await page.route("**/data/release.json", route => route.fulfill({ json: browserData }));
    await page.locator("#retry").click(); await page.waitForSelector(".legend-row");
    await page.route("**/data/release.json", route => route.fulfill({ json: { invalid: true } }));
    await page.reload(); await page.waitForSelector("#retry");
    for (const name of ["about", "privacy", "404"]) {
      await page.goto(base + "/" + name + ".html");
      assert(await page.locator("h1").isVisible());
      assert.equal(await page.locator(".site-header nav a").count(), 3);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    csp = csp.replace("img-src 'self' data:;", "img-src 'self' data: https://media.example.test;").replace("connect-src 'self';", "connect-src 'self' https://media.example.test;");
    await page.route("**/config/site.json", route => route.fulfill({ json: { publicDataBaseUrl: "https://media.example.test", pageSize: 36 } }));
    await page.route("https://media.example.test/data/release.json", route => route.fulfill({ json: browserData, headers: { "Access-Control-Allow-Origin": base } }));
    await page.goto(base); await page.waitForSelector(".legend-row");
    assert((await page.locator(".ribbon-group img").first().getAttribute("src")).startsWith("https://media.example.test/media/"));
    await page.locator("#site-search").fill("别名"); await page.locator("#site-search").press("Enter");
    await page.waitForURL("**/search.html?*"); await page.waitForSelector(".expression-card");
    assert.equal(await page.locator("#result-count").textContent(), "40 张表情");

    servedData = {
      ...browserData,
      characters: [...browserData.characters, { id: "eyfl", name: "艾雅法拉", aliases: [], is_operator: true, home_episode_ids: ["e0"] }],
      instances: [...instances, { id: "typo-hit", character_id: "eyfl", episode_id: "e0", image_id: "image0", crop_url: "/media/crops/test.webp", source_preview_url: "/media/source-previews/test.webp", sort_key: "999" }],
    };
    await page.route("**/config/site.json", route => route.fulfill({ json: { pageSize: 36 } }));
    await page.route(base + "/data/release.json", route => route.fulfill({ json: servedData }));
    await page.goto(base); await page.waitForSelector(".legend-row");
    await page.locator("#site-search").fill("阿雅法拉");
    const fuzzySuggestion = page.locator(".search-suggestion").filter({ hasText: "艾雅法拉" });
    await fuzzySuggestion.waitFor({ timeout: 10000 });
    assert((await fuzzySuggestion.textContent()).includes("近似"), "Fuzzy suggestions should be visibly marked");
    await fuzzySuggestion.click(); await page.waitForURL("**/character.html?id=eyfl"); await page.waitForSelector(".character-gallery .expression-card");
    assert.equal(await page.locator(".character-gallery .expression-card").count(), 1);
    await page.goto(base); await page.waitForSelector(".legend-row");
    await page.locator("#site-search").fill("阿雅法拉"); await page.locator("#search-form button[type=submit]").click();
    await page.waitForFunction(() => new URLSearchParams(location.search).get("q") === "阿雅法拉" && document.querySelector(".expression-card")?.dataset.character === "eyfl");
    assert.deepEqual(errors, []);
    console.log("Browser: desktop/mobile, CSP, separate result page, unified search, fuzzy Chinese suggestions/results, continuous marquee, aliases, episode numbers, paging, preview, reload/back, rankings, missing metadata, carousel, error/retry passed");
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
