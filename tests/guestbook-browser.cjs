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
    await page.route("**/config/site.json", route => route.fulfill({ json: { theme: { backgroundImages: covers }, guestbook: { turnstileSiteKey: "test-sitekey" } } }));
    await page.route("**/api/guestbook?*", route => route.fulfill({ json: { enabled: true, messages: [{ body: "你好 <script>alert(1)</script>", created_at: "2026-09-23T00:00:00.000Z" }], has_more: false } }));
    let submitted;
    await page.route("**/api/guestbook", async route => {
      submitted = route.request().postDataJSON();
      await route.fulfill({ status: 201, json: { ok: true, status: "pending" } });
    });
    await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js?*", route => route.fulfill({ contentType: "application/javascript", body: "window.turnstile={render:(_selector, options)=>{options.callback('test-token');return 1;},reset:()=>{}};" }));
    await page.goto(base);
    await page.locator("#guestbook-form").waitFor({ state: "visible" });
    assert.match(await page.locator("#guestbook-status").textContent(), /人工审核/);
    assert.equal(await page.locator(".guestbook-entry").count(), 1);
    assert.match(await page.locator(".guestbook-entry p").textContent(), /<script>/);
    assert.equal(await page.locator("script:not([src])").count() >= 1, true); // Copy JSON remains inert.
    await page.locator("#guestbook").screenshot({ path: path.join(__dirname, "../test-results/guestbook-home.png") });
    await page.locator("#guestbook-body").fill("这张表情好可爱");
    await page.locator("#guestbook-send").click();
    await page.getByText("收到了！审核通过后才会显示在这里。").waitFor();
    assert.equal(submitted.body, "这张表情好可爱");
    assert.equal(submitted.turnstile_token, "test-token");
    assert.equal(await page.locator(".guestbook-entry").count(), 1, "Pending submission must not auto-publish");
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

    await page.route("**/api/guestbook?*", route => route.fulfill({ json: { enabled: false, messages: [], has_more: false } }));
    await page.goto(base);
    await page.locator("#guestbook-status:has-text('准备中')").waitFor();
    assert.equal(await page.locator("#guestbook-form").isVisible(), false, "Unconfigured board stays closed");

    const pending = [{ id: "11111111-1111-1111-1111-111111111111", body: "请改错别字", created_at: "2026-09-23T00:00:00.000Z", status: "pending" }];
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
    await page.locator("#main").screenshot({ path: path.join(__dirname, "../test-results/guestbook-admin.png") });
    await page.getByRole("button", { name: "通过", exact: true }).click();
    await page.getByText("已保存审核结果。").waitFor();
    assert.equal(approval.status, "approved");
    assert.deepEqual(errors, []);
    console.log("Browser: public form, escaped list, pending submission, admin approval and cover rotation passed");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
