const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.SITE_TEST_URL || "http://127.0.0.1:4174";

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const covers = [1, 2, 3].map(n => `/media/backgrounds/${String(n).repeat(16)}-${String(n).repeat(16)}.webp`);
    let boardEnabled = true;
    const detailRelease = {
      release_id: "guestbook-browser-test",
      characters: [{ id: "amiya", name: "阿米娅", aliases: [] }],
      episodes: [{ id: "episode-1", name: "001_测试篇", order: 1, official_url: "https://comic.hypergryph.com/comic/6253/test" }],
      instances: [{ id: "instance-1", character_id: "amiya", episode_id: "episode-1", crop_url: "/media/crops/test.webp", source_preview_url: "/media/source-previews/test.webp" }],
    };
    const anonymousName = "提丰#799";
    await page.route("**/config/site.json", route => route.fulfill({ json: { theme: { backgroundImages: covers }, guestbook: { turnstileSiteKey: "test-sitekey" } } }));
    await page.route("**/data/release.json", route => route.fulfill({ json: detailRelease }));
    await page.route("**/api/guestbook*", async route => {
      if (route.request().method() === "GET") return route.fulfill({ json: { enabled: boardEnabled, messages: boardEnabled ? [{ body: "你好 <script>alert(1)</script>", created_at: "2026-09-23T00:00:00.000Z", author_name: anonymousName }] : [], has_more: false } });
      submitted = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { ok: true, status: "pending", author_name: anonymousName } });
    });
    let submitted;
    await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js?*", route => route.fulfill({ contentType: "application/javascript", body: "window.turnstile={render:(_selector, options)=>{options.callback('test-token');return 1;},reset:()=>{}};" }));
    await page.goto(base);
    await page.locator("#guestbook-form").waitFor({ state: "visible" });
    assert.match(await page.locator("#guestbook-status").textContent(), /人工审核/);
    assert.equal(await page.locator(".guestbook-entry").count(), 1);
    assert.match(await page.locator(".guestbook-entry p").textContent(), /<script>/);
    assert.equal(await page.locator(".guestbook-author").first().textContent(), anonymousName);
    assert.equal(await page.locator("script:not([src])").count() >= 1, true); // Copy JSON remains inert.
    await page.locator("#guestbook").screenshot({ path: path.join(__dirname, "../test-results/guestbook-home.png") });
    await page.locator("#guestbook-body").fill("这张表情好可爱");
    await page.locator("#guestbook-send").click();
    await page.getByText(/你的匿名名称是 提丰#799/).waitFor();
    assert.equal(submitted.body, "这张表情好可爱");
    assert.equal(submitted.turnstile_token, "test-token");
    assert.equal(submitted.source_type, "home");
    assert.equal(await page.locator(".guestbook-entry").count(), 1, "Pending submission must not auto-publish");
    await page.goto(base + "/instance.html?id=instance-1");
    await page.locator("#guestbook-form").waitFor({ state: "visible" });
    assert.match(await page.locator("#guestbook").textContent(), /角色、裁切或篇目信息有误/);
    await page.locator("#guestbook-body").fill("详情页的角色可能标错了");
    await page.locator("#guestbook-send").click();
    await page.getByText(/你的匿名名称是 提丰#799/).waitFor();
    assert.equal(submitted.source_type, "instance");
    assert.equal(submitted.source_id, "instance-1");
    const first = await page.locator("html").getAttribute("style");
    await page.reload();
    await page.locator("#guestbook-form").waitFor({ state: "visible" });
    const second = await page.locator("html").getAttribute("style");
    assert.notEqual(first, second, "Refresh rotates cover");
    await page.goto(base + "/search.html");
    await page.locator("html[style*='--site-background']").waitFor();
    const third = await page.locator("html").getAttribute("style");
    assert.notEqual(second, third, "Page navigation rotates cover");
    await page.locator("#site-search").fill("阿米娅");
    await page.locator("#site-search").press("Enter");
    const fourth = await page.locator("html").getAttribute("style");
    assert.notEqual(third, fourth, "Search within the results page rotates cover");

    boardEnabled = false;
    await page.goto(base);
    await page.locator("#guestbook-status:has-text('准备中')").waitFor();
    assert.equal(await page.locator("#guestbook-form").isVisible(), false, "Unconfigured board stays closed");
    assert.equal(await page.locator("#guestbook-list").textContent(), "", "Closed board should not invite an impossible submission");

    const pending = [{ id: "11111111-1111-1111-1111-111111111111", body: "请改错别字", created_at: "2026-09-23T00:00:00.000Z", status: "pending", source_type: "instance", source_id: "instance-1", author_name: anonymousName }];
    await page.route("**/api/guestbook/admin?*", route => route.fulfill({ json: { messages: pending } }));
    let approval;
    await page.route("**/api/guestbook/admin", route => {
      approval = route.request().postDataJSON();
      pending.length = 0;
      return route.fulfill({ json: { ok: true, changed: 1 } });
    });
    await page.goto(base + "/guestbook-admin.html");
    await page.locator("#moderator-key").fill("a".repeat(48));
    await page.locator("#moderator-login button").click();
    await page.locator(".moderator-entry").waitFor();
    assert((await page.locator(".moderator-meta").textContent()).includes("表情详情 · instance-1"));
    assert((await page.locator(".moderator-meta").textContent()).includes("状态：待审核"));
    assert.equal(await page.locator(".moderator-entry .guestbook-author").textContent(), anonymousName);
    await page.locator("#main").screenshot({ path: path.join(__dirname, "../test-results/guestbook-admin.png") });
    await page.getByRole("button", { name: "通过并公开", exact: true }).click();
    await page.getByText("已保存审核结果。").waitFor();
    assert.equal(approval.status, "approved");
    assert.deepEqual(errors, []);
    console.log("Browser: public form, escaped list, pending submission, admin approval and cover rotation passed");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
