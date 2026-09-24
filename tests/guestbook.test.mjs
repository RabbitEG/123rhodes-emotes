import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { onRequestGet as listPublic, onRequestPost as submit } from "../functions/api/guestbook.js";
import { onRequestGet as listAdmin, onRequestPost as moderate } from "../functions/api/guestbook/admin.js";

const rows = [];
const db = {
  prepare(query) {
    const statement = params => ({
        async all() {
          if (query.includes("status = 'approved'")) {
            return { results: rows.filter(row => row.status === "approved" && (!query.includes("source_id = ?") || row.source_id === params[0]))
              .sort((a, b) => b.created_at.localeCompare(a.created_at))
              .slice(0, 10).map(({ body, created_at }) => ({ body, created_at })) };
          }
          return { results: rows.filter(row => row.status === params[0]) };
        },
        async run() {
          if (query.startsWith("INSERT")) {
            rows.push({ id: params[0], body: params[1], created_at: params[2], status: "pending", reviewed_at: null, source_type: params[3], source_id: params[4] });
            return { meta: { changes: 1 } };
          }
          const row = rows.find(item => item.id === params[2]);
          if (row) { row.status = params[0]; row.reviewed_at = params[1]; }
          return { meta: { changes: row ? 1 : 0 } };
        },
      });
    return { ...statement([]), bind: (...params) => statement(params) };
  },
};
const secret = "a".repeat(48);
const env = { GUESTBOOK_DB: db, TURNSTILE_SECRET_KEY: "test-secret", GUESTBOOK_ADMIN_KEY: secret };
const url = "https://123rhodes-emotes.pages.dev/api/guestbook";
const request = (path = "", method = "GET", body, adminKey = "") => new Request(url + path, {
  method,
  headers: { Origin: "https://123rhodes-emotes.pages.dev", ...(body ? { "Content-Type": "application/json" } : {}),
    ...(adminKey ? { Authorization: "Bearer " + adminKey } : {}) },
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
  assert.equal((await submit({ request: request("", "POST", { body: "你好 <script>", turnstile_token: "good" }), env })).status, 201);
  assert.equal(rows[0].status, "pending");
  assert.equal(rows[0].source_type, "home");
  assert.equal(rows[0].source_id, "");
  assert.deepEqual((await (await listPublic({ request: request(), env })).json()).messages, []);
  assert.equal((await listAdmin({ request: request("/admin", "GET", null, "bad"), env })).status, 401);
  const pendingMessages = (await (await listAdmin({ request: request("/admin", "GET", null, secret), env })).json()).messages;
  assert.equal(pendingMessages.length, 1);
  assert.equal(pendingMessages[0].source_type, "home");
  assert.equal((await moderate({ request: request("/admin", "POST", { id: rows[0].id, status: "approved" }, secret), env })).status, 200);
  assert.equal((await (await listPublic({ request: request(), env })).json()).messages[0].body, "你好 <script>");
  await moderate({ request: request("/admin", "POST", { id: rows[0].id, status: "rejected" }, secret), env });
  assert.deepEqual((await (await listPublic({ request: request(), env })).json()).messages, []);

  assert.equal((await submit({ request: request("", "POST", { body: "详情页纠错", turnstile_token: "good", source_type: "instance", source_id: "instance-1" }), env })).status, 201);
  assert.equal(rows[1].source_type, "instance");
  assert.equal(rows[1].source_id, "instance-1");
  const instancePending = (await (await listAdmin({ request: request("/admin", "GET", null, secret), env })).json()).messages;
  assert.equal(instancePending[0].source_id, "instance-1");
  assert.deepEqual((await (await listPublic({ request: request(), env })).json()).messages, [], "Pending detail feedback stays private");
  await moderate({ request: request("/admin", "POST", { id: rows[1].id, status: "approved" }, secret), env });
  const detailPublic = (await (await listPublic({ request: request("?source_type=instance&source_id=instance-1"), env })).json()).messages;
  assert.equal(detailPublic.length, 1);
  assert.equal(detailPublic[0].body, "详情页纠错");
  assert.deepEqual((await (await listPublic({ request: request("?source_type=instance&source_id=other-instance"), env })).json()).messages, []);
  await moderate({ request: request("/admin", "POST", { id: rows[1].id, status: "rejected" }, secret), env });
  for (let index = 0; index < 12; index++) rows.push({
    id: `published-${index}`, body: `已公开 ${index}`, created_at: `2026-01-01T00:${String(index).padStart(2, "0")}:00.000Z`,
    status: "approved", reviewed_at: "2026-01-02T00:00:00.000Z", source_type: "home", source_id: "",
  });
  const latest = (await (await listPublic({ request: request(), env })).json()).messages;
  assert.equal(latest.length, 10, "Public board only returns ten approved messages");
  assert.equal(latest[0].body, "已公开 11");
  assert.equal(latest[9].body, "已公开 2");
} finally { globalThis.fetch = mockVerify; }

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
