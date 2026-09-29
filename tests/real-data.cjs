const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
const data = JSON.parse(fs.readFileSync(path.join(root, "publish/site/data/release.json"), "utf8"));
const canonicalDuplicateNames = [["维娜·维多利亚", "推进之王"], ["酒神", "傀影"]];
const expectedCharacterCount = data.characters.filter(character => !canonicalDuplicateNames.some(([alias, owner]) =>
  character.name === alias && data.characters.some(candidate => candidate.name === owner))).length;
(async () => {
  const browser = await chromium.launch({headless:true, executablePath: process.env.CHROMIUM_EXECUTABLE, args:["--no-sandbox"]});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[]; page.on("pageerror", e=>errors.push(e.message));
    await page.goto("http://127.0.0.1:4174/");
    await page.waitForSelector(".legend-row");
    assert.equal(await page.locator(".ranking-panels > .ranking-card").count(), 3);
    assert.equal(await page.locator(".publication-mini-card").count(), 4);
    assert.equal(await page.locator(".publication-series-legend").count(), 0);
    assert.equal(await page.locator(".publication-calendar-svg .publication-year-label").count(), 5);
    assert.equal(await page.locator(".publication-calendar-svg rect").count(), 5 * 53);
    const firstWeeks = await page.locator(".publication-calendar-svg rect").evaluateAll(els => els.slice(0, 4).map(el => ({ x: el.getAttribute("x"), y: el.getAttribute("y") })));
    assert.equal(firstWeeks[0].x, firstWeeks[1].x, "Weeks 1–2 should share a column");
    assert.equal(firstWeeks[2].x, firstWeeks[3].x, "Weeks 3–4 should share a column");
    assert(Number(firstWeeks[2].x) > Number(firstWeeks[0].x));
    assert(Number(firstWeeks[1].y) > Number(firstWeeks[0].y));
    const datedEpisodeCount = data.episodes.filter(episode => /^\d{4}-\d{2}-\d{2}$/.test(episode.published_at || "")).length;
    assert.equal(await page.locator("#publication-total").textContent(), `${datedEpisodeCount} 篇`);
    assert((await page.locator(".publication-year-label").first().textContent()).includes("2026"));
    assert((await page.locator(".publication-year-label").last().textContent()).includes("2022"));
    assert.equal(await page.locator("#ranking-kind option").count(), 4);
    assert.equal(await page.locator("#missing-ranking-kind option").count(), 2);
    assert.deepEqual(await page.locator("#totals strong").allTextContents(), [data.episodes.length,data.instances.length,expectedCharacterCount,data.images.length].map(n=>n.toLocaleString("zh-CN")));
    await page.waitForFunction(()=>[...document.querySelectorAll(".ribbon-group:first-child img")].every(i=>i.complete && i.naturalWidth>0));
    await page.screenshot({path:path.join(root,"test-results/real-home.png"),fullPage:true});
    await page.locator("#site-search").fill("幽灵鲨");
    await page.locator("#site-search").press("Enter");
    await page.waitForURL("**/character.html?id=*"); await page.waitForSelector(".character-gallery .expression-card");
    const cid = data.characters.find(c=>c.name==="幽灵鲨").id;
    const count = data.instances.filter(i=>i.character_id===cid).length;
    assert.equal(await page.locator(".character-gallery .expression-card").count(), Math.min(count, 36));
    assert.equal(await page.locator(".character-gallery-heading").textContent(), `表情图库共 ${count.toLocaleString("zh-CN")} 次收录`);
    await page.waitForFunction(()=>[...document.querySelectorAll(".crop-wrap img")].every(i=>i.complete && i.naturalWidth>0));
    assert(await page.locator(".crop-wrap img").evaluateAll(images=>images.every(image=>{
      const a=image.getBoundingClientRect(), b=image.parentElement.getBoundingClientRect();
      return a.top>=b.top && a.bottom<=b.bottom && a.left>=b.left && a.right<=b.right;
    })), "Tall crops must stay inside their image area");
    await page.locator(".source-toggle").first().click();
    await page.locator(".source-peek img").first().waitFor({state:"visible"});
    await page.screenshot({path:path.join(root,"test-results/real-search.png"),fullPage:true});
    await page.goto("http://127.0.0.1:4174/search.html?mode=episodes&q=57");
    await page.waitForSelector(".episode-card");
    assert.equal(await page.locator(".episode-card").count(),1);
    assert((await page.locator(".episode-card").textContent()).includes("057_巡林者篇"));
    await page.setViewportSize({width:390,height:844});
    await page.goto("http://127.0.0.1:4174/");
    await page.waitForSelector(".legend-row");
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:path.join(root,"test-results/real-mobile.png"),fullPage:true});
    assert.deepEqual(errors,[]);
    for(const url of ["/.env","/tools/export_public.py","/publish/export-report.json","/../character_index/database/index.sqlite"]){
      const response=await page.request.get("http://127.0.0.1:4174"+url);assert.equal(response.status(),404);
    }
    console.log("Real release: canonical character totals/pages, rankings, exact episode number, images, previews, mobile and preview isolation passed");
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
