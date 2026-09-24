import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { onRequestGet as listPublic, onRequestPost as submit } from "../functions/api/guestbook.js";
import { onRequestGet as identity, onRequestPost as rerollIdentity } from "../functions/api/guestbook/identity.js";
import { onRequestGet as listAdmin, onRequestPost as moderate } from "../functions/api/guestbook/admin.js";
import { aliasForDraw, weightedSuffixForDraw } from "../lib/guestbook.mjs";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const rows = [];
const users = [];
let nextUserId = 0;
let failNextMessageInsert = false;
const roster = [
  { id: "amiya", name: "阿米娅", type: "canonical" },
  { id: "typhon", name: "提丰", type: "canonical" },
  { id: "npc", name: "路人甲", type: "npc" },
];
const db = {
  prepare(query) {
    let params = [];
    const statement = {
      query,
      get params() { return params; },
      bind(...values) { params = values; return this; },
      async first() {
        if (query.includes("COUNT(*) AS total_users")) return { total_users: users.length };
        if (query.includes("FROM guestbook_users WHERE token_hash")) return users.find(user => user.token_hash === params[0]) || null;
        if (query.includes("FROM guestbook_users WHERE display_name")) return users.find(user => user.display_name === params[0]) || null;
        if (query.includes("FROM guestbook_users WHERE first_display_name")) return users.find(user => user.first_display_name === params[0]) || null;
        return null;
      },
      async all() {
        if (query === "SELECT display_name FROM guestbook_messages LIMIT 0") return { results: [] };
        const publicList = query.includes("m.status = 'approved'");
        let selected = publicList
          ? rows.filter(row => row.status === "approved" && (!query.includes("m.source_id = ?") || (row.source_type === "instance" && row.source_id === params[0])))
          : rows.filter(row => row.status === params[0]);
        selected = selected.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
        if (publicList) selected = selected.slice(0, 10);
        else selected = selected.slice(0, 100);
        return { results: selected.map(row => publicList
          ? { body: row.body, created_at: row.created_at, author_name: row.display_name || users.find(user => user.user_id === row.user_id)?.display_name || "早期留言（未分配昵称）" }
          : { id: row.id, body: row.body, created_at: row.created_at, status: row.status, reviewed_at: row.reviewed_at, source_type: row.source_type, source_id: row.source_id, author_name: row.display_name || "早期留言（未分配昵称）", visitor_name: users.find(user => user.user_id === row.user_id)?.first_display_name || users.find(user => user.user_id === row.user_id)?.display_name || "早期留言（未分配昵称）" }) };
      },
      async run() {
        if (query.startsWith("INSERT OR IGNORE INTO guestbook_users")) {
          const [token_hash, display_name, first_display_name, created_at] = params;
          if (users.some(user => user.token_hash === token_hash || user.display_name === display_name || user.first_display_name === first_display_name)) return { meta: { changes: 0 } };
          users.push({ user_id: ++nextUserId, token_hash, display_name, first_display_name, created_at });
          return { meta: { changes: 1 } };
        }
        if (query.startsWith("INSERT INTO guestbook_messages")) {
          const [id, body, created_at, source_type, source_id, user_id, display_name] = params;
          rows.push({ id, body, created_at, status: "pending", reviewed_at: null, source_type, source_id, user_id, display_name });
          return { meta: { changes: 1 } };
        }
        if (query.startsWith("UPDATE guestbook_users")) {
          const [display_name, user_id, old_display_name] = params;
          const user = users.find(item => item.user_id === user_id && item.display_name === old_display_name);
          if (!user || users.some(item => item.user_id !== user_id && item.display_name === display_name)) return { meta: { changes: 0 } };
          user.display_name = display_name;
          return { meta: { changes: 1 } };
        }
        const row = rows.find(item => item.id === params[2]);
        if (row) { row.status = params[0]; row.reviewed_at = params[1]; }
        return { meta: { changes: row ? 1 : 0 } };
      },
    };
    return statement;
  },
  async batch(statements) {
    const usersBefore = users.map(user => ({ ...user }));
    const rowsBefore = rows.map(row => ({ ...row }));
    const userIdBefore = nextUserId;
    const result = [];
    try {
      for (const statement of statements) {
        if (failNextMessageInsert && statement.query.includes("INSERT INTO guestbook_messages")) {
          failNextMessageInsert = false;
          throw new Error("simulated message write failure");
        }
        if (statement.query.startsWith("INSERT INTO guestbook_messages") && statement.query.includes("SELECT")) {
          const [id, body, created_at, source_type, source_id, display_name, token_hash] = statement.params;
          const user = users.find(item => item.token_hash === token_hash);
          if (user) {
            rows.push({ id, body, created_at, status: "pending", reviewed_at: null, source_type, source_id, user_id: user.user_id, display_name });
            result.push({ meta: { changes: 1 } });
          } else result.push({ meta: { changes: 0 } });
        } else result.push(await statement.run());
      }
      return result;
    } catch (error) {
      users.splice(0, users.length, ...usersBefore);
      rows.splice(0, rows.length, ...rowsBefore);
      nextUserId = userIdBefore;
      throw error;
    }
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
  const previewResponse = await identity({ request: request("/identity"), env });
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.equal(preview.registered, false);
  assert.match(preview.author_name, /^(阿米娅|提丰)#\d{3}$/);
  assert.equal(users.length, 0, "Previewing a nickname must not register or reserve it");
  assert.equal((await rerollIdentity({ request: request("/identity", "POST"), env })).status, 409, "Pre-send nickname rerolls stay previews and cannot register a user");
  const rerolled = await (await identity({ request: request("/identity?exclude=" + encodeURIComponent(preview.author_name)), env })).json();
  assert.notEqual(rerolled.author_name, preview.author_name, "Reroll excludes the current preview");
  assert.equal(users.length, 0, "Rerolling must not register a nickname");
  const firstSubmission = await submit({ request: request("", "POST", { body: "你好 <script>", display_name: preview.author_name, turnstile_token: "good" }), env });
  assert.equal(firstSubmission.status, 201);
  const firstSubmissionData = await firstSubmission.json();
  const visitorCookie = firstSubmission.headers.get("Set-Cookie").split(";", 1)[0];
  assert.match(visitorCookie, /^__Host-rhodes_guestbook=[0-9a-f]{64}$/);
  assert.equal(firstSubmissionData.author_name, preview.author_name, "The first successful send stores the previewed nickname");
  assert.equal(rows[0].status, "pending");
  assert.equal(rows[0].source_type, "home");
  assert.equal(rows[0].source_id, "");
  assert.equal(rows[0].user_id, users[0].user_id);
  assert.equal(rows[0].display_name, preview.author_name, "Each message stores its submitted display nickname");
  assert.equal(users[0].token_hash.length, 64);
  assert.equal(users[0].first_display_name, preview.author_name, "The first assigned nickname is kept separately");
  assert.equal(users[0].token_hash.includes(visitorCookie.split("=")[1]), false, "Only a hash of the cookie token is stored");
  const registeredIdentity = await identity({ request: request("/identity", "GET", null, "", visitorCookie), env });
  assert.deepEqual(await registeredIdentity.json(), { enabled: true, registered: true, author_name: firstSubmissionData.author_name });
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
  assert.equal("visitor_name" in approvedHomeMessage, false, "Public comments expose only the per-message display nickname");
  await moderate({ request: request("/admin", "POST", { id: rows[0].id, status: "rejected" }, secret), env });
  assert.deepEqual((await (await listPublic({ request: request(), env })).json()).messages, []);

  const otherPreviewName = firstSubmissionData.author_name.startsWith("阿米娅") ? "提丰#999" : "阿米娅#999";
  const sameUserSubmission = await submit({ request: request("", "POST", { body: "详情页纠错", display_name: otherPreviewName, turnstile_token: "good", source_type: "instance", source_id: "instance-1" }, "", visitorCookie), env });
  assert.equal(sameUserSubmission.status, 201);
  assert.equal((await sameUserSubmission.json()).author_name, firstSubmissionData.author_name, "A browser uses its current alias until it rerolls");
  assert.equal(rows[1].display_name, firstSubmissionData.author_name);
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
  const rerollResponse = await rerollIdentity({ request: request("/identity", "POST", undefined, "", visitorCookie), env });
  assert.equal(rerollResponse.status, 200);
  const rerolledIdentity = await rerollResponse.json();
  assert.notEqual(rerolledIdentity.author_name, firstSubmissionData.author_name);
  assert.equal(users[0].user_id, rows[0].user_id, "Reroll keeps the same anonymous user identity");
  assert.equal(users[0].first_display_name, firstSubmissionData.author_name, "Reroll preserves the first nickname");
  assert.equal(users[0].display_name, rerolledIdentity.author_name);
  const detailAfterReroll = (await (await listPublic({ request: request("?source_type=instance&source_id=instance-1"), env })).json()).messages;
  assert.equal(detailAfterReroll[0].author_name, firstSubmissionData.author_name, "Previously published comments keep the nickname used when sent");
  const approvedAdminMessages = (await (await listAdmin({ request: request("/admin?status=approved", "GET", null, secret), env })).json()).messages;
  assert.equal(approvedAdminMessages.find(message => message.id === rows[1].id).visitor_name, firstSubmissionData.author_name);
  assert.equal(approvedAdminMessages.find(message => message.id === rows[1].id).author_name, firstSubmissionData.author_name);
  const newAliasSubmission = await submit({ request: request("", "POST", { body: "换名后的新留言", display_name: rerolledIdentity.author_name, turnstile_token: "good", source_type: "instance", source_id: "instance-1" }, "", visitorCookie), env });
  assert.equal(newAliasSubmission.status, 201);
  assert.equal(rows[2].display_name, rerolledIdentity.author_name, "A rerolled alias is snapshotted on the next message");
  assert.equal(rows[2].user_id, rows[1].user_id, "Both aliases remain linked to the same visitor");
  await moderate({ request: request("/admin", "POST", { id: rows[2].id, status: "approved" }, secret), env });
  const twoNames = (await (await listPublic({ request: request("?source_type=instance&source_id=instance-1"), env })).json()).messages;
  assert.equal(twoNames.find(message => message.body === "详情页纠错").author_name, firstSubmissionData.author_name);
  assert.equal(twoNames.find(message => message.body === "换名后的新留言").author_name, rerolledIdentity.author_name);
  assert.equal(twoNames.some(message => "visitor_name" in message), false, "The stable visitor alias is private to the admin API");
  await moderate({ request: request("/admin", "POST", { id: rows[1].id, status: "rejected" }, secret), env });
  await moderate({ request: request("/admin", "POST", { id: rows[2].id, status: "rejected" }, secret), env });
  const userCountBeforeConflict = users.length, rowCountBeforeConflict = rows.length;
  const conflict = await submit({ request: request("", "POST", { body: "抢占失败的留言", display_name: firstSubmissionData.author_name, turnstile_token: "good" }), env });
  assert.equal(conflict.status, 409);
  assert.equal(users.length, userCountBeforeConflict, "A taken preview must not create a user record");
  assert.equal(rows.length, rowCountBeforeConflict, "A taken preview must not create a message");
  const failedSendPreview = await (await identity({ request: request("/identity"), env })).json();
  const usersBeforeFailedSend = users.length, rowsBeforeFailedSend = rows.length;
  failNextMessageInsert = true;
  const failedSend = await submit({ request: request("", "POST", { body: "写入失败", display_name: failedSendPreview.author_name, turnstile_token: "good" }), env });
  assert.equal(failedSend.status, 503);
  assert.equal(users.length, usersBeforeFailedSend, "A failed first send must not persist the nickname");
  assert.equal(rows.length, rowsBeforeFailedSend, "A failed first send must not persist a message");
  const distinctPreview = await (await identity({ request: request("/identity"), env })).json();
  assert.notEqual(distinctPreview.author_name, firstSubmissionData.author_name);
  const distinctUserResponse = await submit({ request: request("", "POST", { body: "另一位访客", display_name: distinctPreview.author_name, turnstile_token: "good" }), env });
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
