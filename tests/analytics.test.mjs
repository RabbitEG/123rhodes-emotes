import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { normalizeAnalyticsEvent, resultBucket } from "../lib/analytics.mjs";
import { onRequestPost } from "../functions/api/analytics.js";
import { onRequestGet } from "../functions/api/analytics/admin.js";

globalThis.crypto ||= webcrypto;

const eventId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const validEvent = (overrides = {}) => ({
  event_id: eventId, session_id: sessionId, event_type: "page_view", page_type: "home",
  object_type: "", object_id: "", character_id: "", episode_id: "", context: "direct",
  search_mode: "", query_kind: "", result_count: null, screen_class: "wide", release_id: "release-1",
  ...overrides,
});

const normalized = normalizeAnalyticsEvent({
  ...validEvent(), query_text: "private search phrase", ip: "203.0.113.8", user_agent: "private browser",
}, "CN");
assert.equal(normalized.country_code, "CN");
assert.equal("query_text" in normalized, false);
assert.equal("ip" in normalized, false);
assert.equal("user_agent" in normalized, false);
assert.equal(normalizeAnalyticsEvent(validEvent({ event_type: "arbitrary_text" })), null);
assert.equal(normalizeAnalyticsEvent(validEvent({ object_type: "instance", object_id: "../secret" })), null);
assert.deepEqual([0, 1, 5, 6, 20, 21, 100, 101].map(resultBucket), ["zero", "1_5", "1_5", "6_20", "6_20", "21_100", "21_100", "101_plus"]);

const insertedEvents = new Map();
const database = {
  prepare(sql) {
    return { sql, bind(...params) {
      return {
        sql, params,
        async all() { return { results: [] }; },
      };
    } };
  },
  async batch(statements) {
    return statements.map(statement => {
      const id = statement.params[0];
      if (insertedEvents.has(id)) return { meta: { changes: 0 } };
      insertedEvents.set(id, statement.params);
      return { meta: { changes: 1 } };
    });
  },
};
const secret = "analytics-secret-".padEnd(48, "x");
const env = { ANALYTICS_DB: database, ANALYTICS_ADMIN_KEY: secret };
const endpoint = "https://123rhodes-emotes.pages.dev/api/analytics";
const post = (body, headers = {}) => new Request(endpoint, {
  method: "POST",
  headers: { Origin: "https://123rhodes-emotes.pages.dev", "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});

assert.equal((await onRequestPost({ request: post(validEvent()), env: {} })).status, 202, "No D1 keeps browsing fail-open");
const crossOrigin = post(validEvent(), { Origin: "https://attacker.example" });
assert.equal((await onRequestPost({ request: crossOrigin, env })).status, 403);
const dntResponse = await onRequestPost({ request: post(validEvent(), { DNT: "1" }), env });
assert.equal(dntResponse.status, 202);
assert.equal(insertedEvents.size, 0, "DNT requests are not written");

const submitted = validEvent({ event_type: "search_submit", page_type: "search", object_type: "character", object_id: "char-1", character_id: "char-1", query_text: "must never persist" });
const second = validEvent({ event_id: "33333333-3333-4333-8333-333333333333", event_type: "instance_open", page_type: "instance", object_type: "instance", object_id: "instance-1", character_id: "char-1", episode_id: "episode-1" });
const firstResponse = await onRequestPost({ request: post([submitted, second]), env });
assert.equal(firstResponse.status, 202);
assert.equal((await firstResponse.json()).recorded, 2);
const duplicateResponse = await onRequestPost({ request: post([submitted]), env });
assert.equal((await duplicateResponse.json()).recorded, 0, "Event IDs are idempotent");
assert.equal(insertedEvents.size, 2);
assert.equal(JSON.stringify([...insertedEvents.values()]).includes("must never persist"), false);
assert.equal((await onRequestPost({ request: post(Array.from({ length: 9 }, (_, index) => validEvent({ event_id: `${index}1111111-1111-4111-8111-111111111111` }))), env })).status, 400);

const adminUrl = "https://123rhodes-emotes.pages.dev/api/analytics/admin?days=30";
const adminRequest = key => new Request(adminUrl, {
  headers: { Origin: "https://123rhodes-emotes.pages.dev", Authorization: "Bearer " + key },
});
assert.equal((await onRequestGet({ request: adminRequest("incorrect"), env })).status, 401);
const reportResponse = await onRequestGet({ request: adminRequest(secret), env });
assert.equal(reportResponse.status, 200);
assert.equal((await reportResponse.json()).configured, true);
console.log("Analytics: allowlist, privacy stripping, DNT, same-origin, batching, idempotency, and admin auth passed");
