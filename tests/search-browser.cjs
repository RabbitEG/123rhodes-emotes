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
  ],
  episodes: [{ id: "e1", name: "001_测试篇", order: 1, official_url: "https://comic.hypergryph.com/comic/6253/test" }],
  instances: [
    { id: "i1", character_id: "eyfl", episode_id: "e1", image_id: "img1", crop_url: "/media/crops/test.webp", sort_key: "001" },
    { id: "i2", character_id: "star-source", episode_id: "e1", image_id: "img1", crop_url: "/media/crops/test.webp", sort_key: "002" },
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
    await page.locator("#site-search").fill("阿雅法拉");
    let candidate = page.locator(".search-suggestion").filter({ hasText: "艾雅法拉" });
    await candidate.waitFor({ timeout: 10000 });
    assert((await candidate.textContent()).includes("近似"), "Hanzi typo should be visibly marked as an approximate suggestion");
    await candidate.click();
    await page.waitForURL("**/search.html?*");
    await page.locator(".expression-card").waitFor();
    assert.equal(await page.locator("#result-count").textContent(), "1 张表情");

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
    await page.waitForFunction(() => new URLSearchParams(location.search).get("character") === "star-source");
    assert.equal(await page.locator("#result-count").textContent(), "1 张表情");
    assert.deepEqual(errors, []);
    console.log("Browser search: typo suggestion, pinyin initials, and direct pinyin query passed");
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
