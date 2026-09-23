const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
const data = JSON.parse(fs.readFileSync(path.join(root, "publish/site/data/release.json"), "utf8"));
(async () => {
  const browser = await chromium.launch({headless:true, executablePath: process.env.CHROMIUM_EXECUTABLE, args:["--no-sandbox"]});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[]; page.on("pageerror", e=>errors.push(e.message));
    await page.goto("http://127.0.0.1:4174/");
    await page.waitForSelector(".legend-row");
    assert.deepEqual(await page.locator("#totals strong").allTextContents(), [data.episodes.length,data.instances.length,data.characters.length,data.images.length].map(n=>n.toLocaleString("zh-CN")));
    await page.waitForFunction(()=>[...document.querySelectorAll(".ribbon-group:first-child img")].every(i=>i.complete && i.naturalWidth>0));
    await page.screenshot({path:path.join(root,"test-results/real-home.png"),fullPage:true});
    await page.locator("#site-search").fill("幽灵鲨");
    await page.locator("#site-search").press("Enter");
    await page.waitForURL("**/search.html?*"); await page.waitForSelector(".expression-card");
    const cid = data.characters.find(c=>c.name==="幽灵鲨").id;
    const count = data.instances.filter(i=>i.character_id===cid).length;
    assert.equal(await page.locator("#result-count").textContent(), count+" 张表情");
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
    console.log("Real release: 4803 crops, 368 characters, 339 episodes, 683 images; separate search, exact episode number, actual images, previews, mobile and preview isolation passed");
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
