import { normalizeAnalyticsEvent } from "../../lib/analytics.mjs";
import { json, readSmallJson, sameOrigin } from "../../lib/guestbook.mjs";

const RETAIN_EVENTS_DAYS = 90;
const RETAIN_SESSION_DAYS = 30;

function utcDaysAgo(days, now = Date.now()) {
  return new Date(now - days * 86_400_000).toISOString();
}

async function pruneOldEvents(db, today, now) {
  const claimed = await db.prepare(
    `INSERT INTO analytics_maintenance (key, value) VALUES ('last_prune_day', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value
     WHERE analytics_maintenance.value <> excluded.value
     RETURNING value`
  ).bind(today).all();
  if (!claimed.results?.length) return;
  await db.batch([
    db.prepare("UPDATE analytics_events SET session_id = NULL WHERE session_id IS NOT NULL AND received_at < ?")
      .bind(utcDaysAgo(RETAIN_SESSION_DAYS, now)),
    db.prepare("DELETE FROM analytics_events WHERE received_at < ?")
      .bind(utcDaysAgo(RETAIN_EVENTS_DAYS, now)),
  ]);
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  if (request.headers.get("DNT") === "1" || request.headers.get("Sec-GPC") === "1") {
    return json({ ok: true, recorded: false, reason: "privacy_signal" }, 202);
  }
  if (!env.ANALYTICS_DB) return json({ ok: true, enabled: false }, 202);
  const input = await readSmallJson(request);
  const inputs = Array.isArray(input) ? input : [input];
  if (!inputs.length || inputs.length > 8) return json({ error: "invalid_batch" }, 400);
  const country = request.cf?.country || "";
  const events = inputs.map(item => normalizeAnalyticsEvent(item, country));
  if (events.some(event => !event)) return json({ error: "invalid_event" }, 400);

  const receivedAt = new Date().toISOString();
  const day = receivedAt.slice(0, 10);
  try {
    const insertSql = `INSERT OR IGNORE INTO analytics_events (
        event_id, session_id, received_at, day, event_type, page_type, object_type, object_id,
        character_id, episode_id, context, search_mode, query_kind, result_count, result_bucket,
        screen_class, country_code, release_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const statements = events.map(event => env.ANALYTICS_DB.prepare(insertSql).bind(
      event.event_id, event.session_id, receivedAt, day, event.event_type, event.page_type, event.object_type,
      event.object_id, event.character_id, event.episode_id, event.context, event.search_mode, event.query_kind,
      event.result_count, event.result_bucket, event.screen_class, event.country_code, event.release_id,
    ));
    const inserted = await env.ANALYTICS_DB.batch(statements);
    const recorded = inserted.reduce((sum, result) => sum + (result.meta?.changes || 0), 0);

    if (recorded > 0) await pruneOldEvents(env.ANALYTICS_DB, day, Date.now());
    return json({ ok: true, recorded }, 202);
  } catch {
    // Keep analytics failures invisible to normal browsing; never log request contents.
    return json({ error: "analytics_unavailable" }, 503);
  }
}
