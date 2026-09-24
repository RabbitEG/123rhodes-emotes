import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { onRequestGet as listPublic, onRequestPost as submit } from "../functions/api/guestbook.js";
import { onRequestGet as listAdmin, onRequestPost as moderate } from "../functions/api/guestbook/admin.js";
import { aliasForDraw, weightedSuffixForDraw } from "../lib/guestbook.mjs";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const rows = [];
const users = [];
let nextUserId = 0;
const roster = [
  { id: "amiya", name: "阿米娅", type: "canonical" },
  { id: "typhon", name: "提丰", type: "canonical" },
  { id: "npc", name: "路人甲", type: "npc" },
];
const db = {
  prepare(query) {
    let params = [];
    return {
      bind(...values) { params = values; return this; },
      async first() {
        if (query.includes("COUNT(*) AS total_users")) return { total_users: users.length };
        if (query.includes("FROM guestbook_users WHERE token_hash")) return users.find(user => user.token_hash === params[0]) || null;
        return null;
      },
      async all() {
        const publicList = query.includes("m.status = 'approved'");
        let selected = publicList
          ? rows.filter(row => row.status === "approved" && (!query.includes("m.source_id = ?") || (row.source_type === "instance" && row.source_id === params[0])))
          : rows.filter(row => row.status === params[0]);
        selected = selected.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
        if (publicList) selected = selected.slice(0, 10);
        else selected = selected.slice(0, 100);
        return { results: selected.map(row => publicList
          ? { body: row.body, created_at: row.created_at, author_name: users.find(user => user.user_id === row.user_id)?.display_name || "早期留言（未分配昵称）" }
          : { id: row.id, body: row.body, created_at: row.created_at, status: row.status, reviewed_at: row.reviewed_at, source_type: row.source_type, source_id: row.source_id, author_name: users.find(user => user.user_id === row.user_id)?.display_name || "早期留言（未分配昵称）" }) };
      },
      async run() {
        if (query.startsWith("INSERT OR IGNORE INTO guestbook_users")) {
          const [token_hash, display_name, created_at] = params;
          if (users.some(user => user.token_hash === token_hash || user.display_name === display_name)) return { meta: { changes: 0 } };
          users.push({ user_id: ++nextUserId, token_hash, display_name, created_at });
          return { meta: { changes: 1 } };
        }
        if (query.startsWith("INSERT INTO guestbook_messages")) {
          const [id, body, created_at, source_type, source_id, user_id] = params;
          rows.push({ id, body, created_at, status: "pending", reviewed_at: null, source_type, source_id, user_id });
          return { meta: { changes: 1 } };
        }
        const row = rows.find(item => item.id === params[2]);
        if (row) { row.status = params[0]; row.reviewed_at = params[1]; }
        return { meta: { changes: row ? 1 : 0 } };
      },
    };
  },
};
const secret = "a".repeat(48);
const env = {
  GUESTBOOK_DB: db, TURNSTILE_SECRET_KEY: "test-secret", GUESTBOOK_ADMIN_KEY: secret,
  media: { async get(key) { assert.equal(key, "data/release.json"); return { async json() { return { characters: roster }; } }; } },
};
const url = "https://123rhodes-emotes.pages.dev/api/guestbook";
const request = (path = "", method = "GET", body, adminKey = "", cookie = "") => new Request(url + path, {
  method,
  headers: { Origin: "https://123rhodes-emotes.pages.dev", ...(body ? { "Content-Type": "application/json" } : {}),
    ...(adminKey ? { Authorization: "Bearer " + adminKey } : {}), ...(cookie ? { Cookie: cookie } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});
const mockVerify = globalThis.fetch;
globalThis.fetch = async (_url, options) => new Response(JSON.stringify({ success: options.body.get("response") === "good", hostname: "123rhodes-emotes.pages.dev" }), { headers: { "Content-Type": "application/json" } });
try {
  assert.equal((await listPublic({ request: request(), env: {} })).status, 200);
  assert.equal((await (await listPublic({ request: request(), env: {} })).json()).enabled, false);
  assert.equal((await (await listPublic({ request: request(), env: { GUESTBOOK_DB: db, TURNSTILE_SECRET_KEY: "test-secret" } })).json()).enabled, false);
  assert.equal((await submit({ request: request("", "POST", { body: "你好", turnstile_token: "good" }), env: {} })).status, 503);
  assert.equal((await submit({ request: new Request(url, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example" }, body: JSON.stringify({ body: "你好", turnstile_token: "good" }) }), env })).status, 403);
  assert.equal((await submit({ request: request("", "POST", { body: "https://spam.example", turnstile_token: "good" }), env })).status, 400);
  assert.equal((await submit({ request: request("", "POST", { body: "你好", turnstile_token: "bad" }), env })).status, 400);
  assert.equal((await submit({ request: request("", "POST", { body: "你好", turnstile_token: "good", source_type: "instance", source_id: "bad id" }), env })).status, 400);
  const firstSubmission = await submit({ request: request("", "POST", { body: "你好 <script>", turnstile_token: "good" }), env });
  assert.equal(firstSubmission.status, 201);
  const firstSubmissionData = await firstSubmission.json();
  const visitorCookie = firstSubmission.headers.get("Set-Cookie").split(";", 1)[0];
  assert.match(visitorCookie, /^__Host-rhodes_guestbook=[0-9a-f]{64}$/);
  assert.match(firstSubmissionData.author_name, /^(阿米娅|提丰)#\d{3}$/);
  assert.equal(rows[0].status, "pending");
  assert.equal(rows[0].source_type, "home");
  assert.equal(rows[0].source_id, "");
  assert.equal(rows[0].user_id, users[0].user_id);
  assert.equal(users[0].token_hash.length, 64);
  assert.equal(users[0].token_hash.includes(visitorCookie.split("=")[1]), false, "Only a hash of the cookie token is stored");
  assert.deepEqual((await (await listPublic({ request: request(), env })).json()).messages, []);
  assert.equal((await listAdmin({ request: request("/admin", "GET", null, "bad"), env })).status, 401);
  const pendingMessages = (await (await listAdmin({ request: request("/admin", "GET", null, secret), env })).json()).messages;
  assert.equal(pendingMessages.length, 1);
  assert.equal(pendingMessages[0].source_type, "home");
  assert.equal(pendingMessages[0].author_name, firstSubmissionData.author_name);
  assert.equal("token_hash" in pendingMessages[0], false);
  assert.equal("user_id" in pendingMessages[0], false);
  assert.equal((await moderate({ request: request("/admin", "POST", { id: rows[0].id, status: "approved" }, secret), env })).status, 200);
  const approvedHomeMessage = (await (await listPublic({ request: request(), env })).json()).messages[0];
  assert.equal(approvedHomeMessage.body, "你好 <script>");
  assert.equal(approvedHomeMessage.author_name, firstSubmissionData.author_name);
  assert.equal("token_hash" in approvedHomeMessage, false);
  assert.equal("user_id" in approvedHomeMessage, false);
  await moderate({ request: request("/admin", "POST", { id: rows[0].id, status: "rejected" }, secret), env });
  assert.deepEqual((await (await listPublic({ request: request(), env })).json()).messages, []);

  const sameUserSubmission = await submit({ request: request("", "POST", { body: "详情页纠错", turnstile_token: "good", source_type: "instance", source_id: "instance-1" }, "", visitorCookie), env });
  assert.equal(sameUserSubmission.status, 201);
  assert.equal((await sameUserSubmission.json()).author_name, firstSubmissionData.author_name, "A browser keeps its anonymous name across pages");
  assert.equal(rows[1].source_type, "instance");
  assert.equal(rows[1].source_id, "instance-1");
  assert.equal(rows[1].user_id, rows[0].user_id);
  const instancePending = (await (await listAdmin({ request: request("/admin", "GET", null, secret), env })).json()).messages;
  assert.equal(instancePending[0].source_id, "instance-1");
  assert.deepEqual((await (await listPublic({ request: request(), env })).json()).messages, [], "Pending detail feedback stays private");
  await moderate({ request: request("/admin", "POST", { id: rows[1].id, status: "approved" }, secret), env });
  const detailPublic = (await (await listPublic({ request: request("?source_type=instance&source_id=instance-1"), env })).json()).messages;
  assert.equal(detailPublic.length, 1);
  assert.equal(detailPublic[0].body, "详情页纠错");
  assert.equal(detailPublic[0].author_name, firstSubmissionData.author_name);
  assert.deepEqual((await (await listPublic({ request: request("?source_type=instance&source_id=other-instance"), env })).json()).messages, []);
  await moderate({ request: request("/admin", "POST", { id: rows[1].id, status: "rejected" }, secret), env });
  const distinctUserResponse = await submit({ request: request("", "POST", { body: "另一位访客", turnstile_token: "good" }), env });
  const distinctUser = await distinctUserResponse.json();
  assert.equal(distinctUserResponse.status, 201);
  assert.notEqual(distinctUser.author_name, firstSubmissionData.author_name, "Distinct visitors cannot share an anonymous name");
  assert.equal(users.length, 2);
  assert.equal(new Set(users.map(user => user.display_name)).size, users.length);
  for (let index = 0; index < 12; index++) rows.push({
    id: `published-${index}`, body: `已公开 ${index}`, created_at: `2026-01-01T00:${String(index).padStart(2, "0")}:00.000Z`,
    status: "approved", reviewed_at: "2026-01-02T00:00:00.000Z", source_type: "home", source_id: "",
  });
  const latest = (await (await listPublic({ request: request(), env })).json()).messages;
  assert.equal(latest.length, 10, "Public board only returns ten approved messages");
  assert.equal(latest[0].body, "已公开 11");
  assert.equal(latest[9].body, "已公开 2");
} finally { globalThis.fetch = mockVerify; }

const weightedCounts = new Map();
for (let draw = 0; draw < 1065; draw++) {
  const suffix = weightedSuffixForDraw(draw);
  weightedCounts.set(suffix, (weightedCounts.get(suffix) || 0) + 1);
}
assert.equal(weightedCounts.get("325"), 10);
for (const suffix of ["799", "328", "174", "290", "310", "996", "007", "042", "083", "226", "114", "514", "886", "985"]) {
  assert.equal(weightedCounts.get(suffix), 5);
}
assert.equal(weightedCounts.get("000"), 1);
assert.equal(aliasForDraw(["A", "B", "C"], 9_999, 0, 0), "A#000");
assert.equal(aliasForDraw(["A", "B", "C"], 10_000, 0, 0), "B#000", "Registration 10,001 starts the next operator-name rotation");

const background = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const config = { theme: { backgroundImages: [
  "/media/backgrounds/1111111111111111-1111111111111111.webp",
  "/media/backgrounds/2222222222222222-2222222222222222.webp",
  "/media/backgrounds/3333333333333333-3333333333333333.webp",
] } };
const session = new Map();
async function loadBackground() {
  const applied = {};
  runInNewContext(background, {
    fetch: async () => ({ ok: true, json: async () => config }),
    sessionStorage: { getItem: key => session.get(key), setItem: (key, value) => session.set(key, value) },
    crypto: { getRandomValues: values => { values[0] = 0; } },
    location: { origin: "https://site.test" }, URL,
    document: { documentElement: { style: { setProperty: (key, value) => { applied[key] = value; } } } },
    window: {},
    Uint32Array,
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  return applied["--site-background"];
}
const first = await loadBackground();
const second = await loadBackground();
const third = await loadBackground();
assert.notEqual(first, second, "Refresh must pick a different cover");
assert.notEqual(second, third, "Navigation must pick a different cover");
console.log("Guestbook pending/approval/rejection/auth and per-page background rotation passed");
