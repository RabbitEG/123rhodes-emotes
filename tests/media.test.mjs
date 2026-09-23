import assert from "node:assert/strict";
import {servePublicMedia} from "../lib/public-media.mjs";
let calls = [];
const media = {
  async get(key) { calls.push(key); return {body:new Blob(["ok"]).stream(),size:2,httpEtag:'"v1"'}; },
  async head(key) { calls.push(key); return {size:2,httpEtag:'"v1"'}; },
};
const run = (path, options={}, env={media})=>servePublicMedia({request:new Request("https://site.test"+path,options),env});
let r = await run("/data/release.json");
assert.equal(await r.text(),"ok"); assert.equal(r.status,200);
assert.equal(r.headers.get("Content-Type"),"application/json; charset=utf-8");
assert(r.headers.get("Cache-Control").includes("max-age=60"));
r=await run("/media/crops/0123456789abcdef-0123456789abcdef.webp");
assert.equal(r.headers.get("Content-Type"),"image/webp");
assert(r.headers.get("Cache-Control").includes("immutable"));
r=await run("/media/backgrounds/0123456789abcdef-0123456789abcdef.webp");
assert.equal(r.headers.get("Content-Type"),"image/webp");
r=await run("/data/release.json",{method:"HEAD"}); assert.equal(await r.text(),"");
r=await run("/data/release.json",{headers:{"If-None-Match":'W/"v1"'}}); assert.equal(r.status,304);
const before=calls.length;
for(const path of ["/data/private.json","/media/index.sqlite","/media/crops/secret.webp","/media/backgrounds/secret.webp","/media/%2e%2e/private"]){
  assert.equal((await run(path)).status,404);
}
assert.equal((await run("/data/release.json",{method:"POST"})).status,405);
assert.equal(calls.length,before);
assert.equal((await run("/data/release.json",{},{})).status,503);
assert.equal((await run("/data/release.json",{},{media:{get:async()=>null}})).status,404);
assert.equal((await run("/data/release.json",{},{media:{get:async()=>{throw Error("secret");}}})).status,503);
console.log("R2 binding: GET, HEAD, ETag, whitelist, methods and safe errors passed");
