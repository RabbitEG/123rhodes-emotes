const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const base = process.env.SITE_TEST_URL || "http://127.0.0.1:4173";
const release = {
  release_id: "search-fuzzy-test",
  characters: [
    { id: "eyfl", name: "艾雅法拉", aliases: [], is_operator: true },
    { id: "star-source", name: "星源", aliases: [], is_operator: true },
    { id: "push", name: "推进之王", aliases: [], is_operator: true, stars: 6 },
    { id: "phantom", name: "傀影", aliases: [], is_operator: true, stars: 6 },
    { id: "lingzhi", name: "灵知", aliases: [], is_operator: true },
    { id: "sora", name: "空爆", aliases: [], is_operator: true, stars: 3 },
    { id: "empty-character", name: "暂无表情条目", aliases: [], is_operator: true },
    { id: "amiya", name: "阿米娅", aliases: [], is_operator: true, stars: 5 },
  ],
  episodes: [
    { id: "e1", name: "001_测试篇", order: 1, official_url: "https://comic.hypergryph.com/comic/6253/test" },
    { id: "e2", name: "002_空篇", order: 2, official_url: "https://comic.hypergryph.com/comic/6253/empty" },
  ],
  instances: [
    { id: "i1", character_id: "eyfl", episode_id: "e1", image_id: "img1", crop_url: "/media/crops/test.webp", sort_key: "001" },
    { id: "i2", character_id: "star-source", episode_id: "e1", image_id: "img1", crop_url: "/media/crops/test.webp", sort_key: "002" },
    { id: "i3", character_id: "push", episode_id: "e1", image_id: "img1", crop_url: "/media/crops/test.webp", sort_key: "003" },
    { id: "i4", character_id: "push", episode_id: "e1", image_id: "img1", crop_url: "/media/crops/test.webp", sort_key: "004" },
    { id: "i5", character_id: "phantom", episode_id: "e1", image_id: "img1", crop_url: "/media/crops/test.webp", sort_key: "005" },
    { id: "i6", character_id: "phantom", episode_id: "e1", image_id: "img1", crop_url: "/media/crops/test.webp", sort_key: "006" },
    { id: "i7", character_id: "lingzhi", episode_id: "e1", image_id: "img1", crop_url: "/media/crops/test.webp", sort_key: "007" },
    { id: "i8", character_id: "sora", episode_id: "e2", image_id: "img1", crop_url: "/media/crops/test.webp", sort_key: "008" },
  ],
  operator_forms: [
    { character_id: "push", name: "推进之王", is_alter: false, implementation_date: "2019-04-30" },
    { character_id: "push", name: "维娜·维多利亚", is_alter: true, implementation_date: "2024-10-09" },
    { character_id: "phantom", name: "傀影", is_alter: false, implementation_date: "2020-04-21" },
    { character_id: "phantom", name: "酒神", is_alter: true, implementation_date: "2025-06-05" },
    { character_id: "star-source", name: "星源", is_alter: false, implementation_date: "2021-11-01" },
    { character_id: "star-source", name: "溯光星源", is_alter: true, implementation_date: "2025-11-01" },
    { character_id: "sora", name: "空爆", is_alter: false, implementation_date: "2019-05-23" },
    { character_id: "sora", name: "雷狼龙S空爆", is_alter: true, implementation_date: "2026-06-01" },
    { character_id: "amiya", name: "阿米娅", is_alter: false, implementation_date: "2019-04-30" },
    { character_id: "amiya", name: "阿米娅（近卫）", is_alter: true, implementation_date: "2020-11-01" },
    { character_id: "amiya", name: "阿米娅（医疗）", is_alter: true, implementation_date: "2024-05-01" },
  ],
};

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const csp = fs.readFileSync(path.join(__dirname, "../_headers"), "utf8").split("\n").find(line => line.includes("Content-Security-Policy:")).split("Content-Security-Policy: ")[1];
    await page.route(base + "/**", async route => {
      if (route.request().resourceType() !== "document") return route.continue();
      const pathname = new URL(route.request().url()).pathname;
      const file = pathname === "/" ? "index.html" : pathname.slice(1);
      return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: fs.readFileSync(path.join(__dirname, "..", file)), headers: { "content-security-policy": csp } });
    });
    await page.route("**/config/site.json", route => route.fulfill({ json: { pageSize: 36, carousel: { enabled: false } } }));
    await page.route("**/api/analytics/search-ranking", route => route.fulfill({ json: { items: [] } }));
    await page.route("**/data/release.json", route => route.fulfill({ json: release }));
    await page.route("**/media/**", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><circle cx="40" cy="40" r="35" fill="#bba8df"/></svg>' }));

    await page.goto(base);
    await page.locator(".legend-row").first().waitFor();
    await page.locator("#site-search").fill("暂无表情条目");
    await page.locator("#search-suggestions").waitFor({ state: "hidden" });
    assert.equal(await page.locator(".search-suggestion").count(), 0, "Characters with no expression crops should not be suggested");

    await page.locator('[data-mode="episodes"]').click();
    await page.locator("#site-search").fill("002_空篇");
    await page.locator("#search-suggestions").waitFor({ state: "hidden" });
    assert.equal(await page.locator(".search-suggestion").count(), 0, "Episodes with no expression crops should not be suggested");

    await page.goto(base + "/character.html?id=amiya");
    await page.locator(".character-profile").waitFor();
    assert.equal(await page.locator(".character-heading h1").textContent(), "阿米娅（近卫、医疗）", "Amiya's alter names should be grouped in implementation order without repeating the canonical name");
    const amiyaPrtsLinks = page.locator(".character-prts-link");
    assert.deepEqual(await amiyaPrtsLinks.allTextContents(), ["阿米娅 ↗", "阿米娅（近卫） ↗", "阿米娅（医疗） ↗"]);
    assert((await amiyaPrtsLinks.nth(1).getAttribute("href")).endsWith("%28近卫%29"), "Guard Amiya should link to PRTS's ASCII-parenthesis page title");
    assert((await amiyaPrtsLinks.nth(2).getAttribute("href")).endsWith("%28医疗%29"), "Medic Amiya should link to PRTS's ASCII-parenthesis page title");

    await page.goto(base);
    await page.locator("#site-search").fill("阿雅法拉");
    let candidate = page.locator(".search-suggestion").filter({ hasText: "艾雅法拉" });
    await candidate.waitFor({ timeout: 10000 });
    assert((await candidate.textContent()).includes("近似"), "Hanzi typo should be visibly marked as an approximate suggestion");
    await candidate.click();
    await page.waitForURL("**/character.html?id=eyfl");
    await page.locator(".character-gallery .expression-card").waitFor();
    assert.equal(await page.locator(".character-gallery .expression-card").count(), 1);

    await page.goto(base);
    await page.locator("#site-search").fill("灵芝");
    candidate = page.locator(".search-suggestion").filter({ hasText: "灵知" });
    await candidate.waitFor({ timeout: 10000 });
    assert((await candidate.textContent()).includes("同音拼写"), "Two-character exact-pinyin match should appear in the live dropdown");
    await candidate.click();
    await page.waitForURL("**/character.html?id=lingzhi");

    await page.goto(base);
    await page.locator("#site-search").fill("雷狼龙");
    candidate = page.locator(".search-suggestion").filter({ hasText: "雷狼龙S空爆" });
    await candidate.waitFor({ timeout: 10000 });
    assert((await candidate.textContent()).includes("角色页：空爆"), "Exact alter-name matches should show the form name and canonical destination");
    await candidate.click();
    await page.waitForURL("**/character.html?id=sora");
    assert.equal(await page.locator(".character-heading h1").textContent(), "空爆（雷狼龙S空爆）");

    await page.goto(base);
    await page.locator("#site-search").fill("leilanglong");
    candidate = page.locator(".search-suggestion").filter({ hasText: "雷狼龙S空爆" });
    await candidate.waitFor({ timeout: 10000 });
    assert((await candidate.textContent()).includes("角色页：空爆"), "Pinyin matches for an alternate form should show the form and canonical destination");
    await candidate.click();
    await page.waitForURL("**/character.html?id=sora");

    await page.goto(base);
    await page.locator("#site-search").fill("雷狼龍");
    candidate = page.locator(".search-suggestion").filter({ hasText: "空爆" });
    await candidate.waitFor({ timeout: 10000 });
    assert.equal(await candidate.locator(".suggestion-primary strong").textContent(), "空爆", "Fuzzy alter-name matches should keep the canonical label");
    assert(!(await candidate.textContent()).includes("雷狼龙S空爆"), "Fuzzy matches should not expand into alternate-form display labels");

    await page.goto(base);
    await page.locator("#site-search").fill("ayfl");
    candidate = page.locator(".search-suggestion").filter({ hasText: "艾雅法拉" });
    await candidate.waitFor({ timeout: 10000 });
    assert((await candidate.textContent()).includes("拼音首字母"));

    await page.locator("#site-search").fill("aiyafala");
    await page.locator("#search-form button[type=submit]").click();
    await page.waitForFunction(() => new URLSearchParams(location.search).get("q") === "aiyafala" && document.querySelector(".expression-card")?.dataset.character === "eyfl");
    assert.equal(await page.locator("#result-count").textContent(), "1 张表情");

    await page.locator("#site-search").fill("溯光星源");
    candidate = page.locator(".search-suggestion").filter({ hasText: "星源" });
    await candidate.waitFor({ timeout: 10000 });
    assert((await candidate.textContent()).includes("星源"), "alter-form search should suggest its canonical character");
    await candidate.click();
    await page.waitForURL("**/character.html?id=star-source");
    assert.equal(await page.locator(".character-heading h1").textContent(), "星源（溯光星源）");
    assert.equal(await page.locator(".character-gallery .expression-card").count(), 1);

    await page.goto(base);
    await page.locator("#site-search").fill("维娜·维多利亚");
    const vinaSuggestion = page.locator(".search-suggestion").filter({ hasText: "维娜·维多利亚" });
    await vinaSuggestion.waitFor({ timeout: 10000 });
    assert((await vinaSuggestion.textContent()).includes("推进之王"), "the official alter name should be shown as a distinct form while linking to its canonical character");
    await page.locator("#search-form button[type=submit]").click();
    await page.waitForURL("**/character.html?id=push");
    assert.equal(await page.locator(".character-heading h1").textContent(), "推进之王（维娜·维多利亚）");
    assert.equal(await page.locator(".character-gallery .expression-card").count(), 2, "canonical page should include base and alter crops");

    await page.goto(base);
    await page.locator("#site-search").fill("酒神");
    await page.locator("#search-form button[type=submit]").click();
    await page.waitForURL("**/character.html?id=phantom");
    assert.equal(await page.locator(".character-heading h1").textContent(), "傀影（酒神）");
    assert.equal(await page.locator(".character-gallery .expression-card").count(), 2);

    await page.goto(base + "/character.html?id=60ae5aa63d1a0fbc");
    await page.waitForURL("**/character.html?id=push");
    await page.goto(base);
    await page.locator('[data-mode="episodes"]').click();
    await page.locator("#site-search").fill("001_测试篇");
    candidate = page.locator(".search-suggestion").filter({ hasText: "001_测试篇" });
    await candidate.waitFor({ timeout: 10000 });
    await candidate.click();
    await page.waitForURL("**/episode.html?id=e1");
    await page.locator(".episode-gallery .expression-card").waitFor();
    assert.equal(await page.locator(".episode-profile h1").textContent(), "001_测试篇");
    assert.equal(await page.locator(".episode-gallery .expression-card").count(), 6);
    assert.deepEqual(errors, []);
    console.log("Browser search: fuzzy and alter-name suggestions open canonical role pages; forms and legacy IDs resolve to earlier canonical names");
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
