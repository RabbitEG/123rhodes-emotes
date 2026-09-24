import { adminAuthorized, json } from "../../../lib/guestbook.mjs";

const RETAIN_SESSION_DAYS = 30;

function daysAgo(days, now = Date.now()) {
  return new Date(now - days * 86_400_000).toISOString();
}

async function all(db, sql, ...values) {
  const result = await db.prepare(sql).bind(...values).all();
  return result.results || [];
}

function countByType(rows) {
  return Object.fromEntries(rows.map(row => [row.event_type, Number(row.count) || 0]));
}

export async function onRequestGet({ request, env }) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "forbidden" }, 403);
  if (!env.ANALYTICS_DB || typeof env.ANALYTICS_ADMIN_KEY !== "string" || env.ANALYTICS_ADMIN_KEY.length < 32) {
    return json({ error: "not_configured" }, 503);
  }
  if (!(await adminAuthorized(request, env.ANALYTICS_ADMIN_KEY))) return json({ error: "unauthorized" }, 401);

  const days = Number(new URL(request.url).searchParams.get("days") || "30");
  if (![7, 30, 90].includes(days)) return json({ error: "invalid_range" }, 400);
  const now = Date.now();
  const cutoff = daysAgo(days, now);
  const sessionCutoff = daysAgo(Math.min(days, RETAIN_SESSION_DAYS), now);

  try {
    const [rangeTotals, allTimeTotals, daily, topInstances, topCharacters, topEpisodes,
      allTimeInstances, allTimeCharacters, allTimeEpisodes, sources, searches, searchTargets,
      screens, countries, sessionCount] = await Promise.all([
      all(env.ANALYTICS_DB,
        "SELECT event_type, COUNT(*) AS count FROM analytics_events WHERE received_at >= ? GROUP BY event_type", cutoff),
      all(env.ANALYTICS_DB,
        "SELECT event_type, SUM(event_count) AS count FROM analytics_daily_counts GROUP BY event_type"),
      all(env.ANALYTICS_DB,
        `SELECT day,
          SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS page_views,
          SUM(CASE WHEN event_type IN ('search_submit', 'suggestion_select') THEN 1 ELSE 0 END) AS searches,
          SUM(CASE WHEN event_type = 'instance_open' THEN 1 ELSE 0 END) AS instance_opens,
          SUM(CASE WHEN event_type = 'source_click' THEN 1 ELSE 0 END) AS source_clicks
         FROM analytics_events WHERE received_at >= ? GROUP BY day ORDER BY day`, cutoff),
      all(env.ANALYTICS_DB,
        `SELECT object_id AS id, character_id, episode_id,
          SUM(CASE WHEN event_type = 'instance_open' THEN 1 ELSE 0 END) AS opens,
          SUM(CASE WHEN event_type = 'instance_impression' THEN 1 ELSE 0 END) AS impressions,
          SUM(CASE WHEN event_type = 'instance_link_click' THEN 1 ELSE 0 END) AS clicks,
          COUNT(DISTINCT CASE WHEN event_type = 'instance_open' THEN session_id END) AS unique_sessions
         FROM analytics_events WHERE received_at >= ? AND object_type = 'instance'
         GROUP BY object_id, character_id, episode_id
         HAVING SUM(CASE WHEN event_type = 'instance_open' THEN 1 ELSE 0 END) > 0
         ORDER BY opens DESC LIMIT 30`, cutoff),
      all(env.ANALYTICS_DB,
        `SELECT character_id AS id, COUNT(*) AS opens, COUNT(DISTINCT session_id) AS unique_sessions
         FROM analytics_events WHERE received_at >= ? AND event_type = 'instance_open' AND character_id <> ''
         GROUP BY character_id ORDER BY opens DESC LIMIT 30`, cutoff),
      all(env.ANALYTICS_DB,
        `SELECT episode_id AS id, COUNT(*) AS opens, COUNT(DISTINCT session_id) AS unique_sessions
         FROM analytics_events WHERE received_at >= ? AND event_type = 'instance_open' AND episode_id <> ''
         GROUP BY episode_id ORDER BY opens DESC LIMIT 30`, cutoff),
      all(env.ANALYTICS_DB,
        `SELECT object_id AS id, character_id, episode_id,
          SUM(CASE WHEN event_type = 'instance_open' THEN event_count ELSE 0 END) AS opens
         FROM analytics_daily_counts WHERE object_type = 'instance'
         GROUP BY object_id, character_id, episode_id
         HAVING SUM(CASE WHEN event_type = 'instance_open' THEN event_count ELSE 0 END) > 0
         ORDER BY opens DESC LIMIT 30`),
      all(env.ANALYTICS_DB,
        `SELECT character_id AS id, SUM(event_count) AS opens FROM analytics_daily_counts
         WHERE event_type = 'instance_open' AND character_id <> ''
         GROUP BY character_id ORDER BY opens DESC LIMIT 30`),
      all(env.ANALYTICS_DB,
        `SELECT episode_id AS id, SUM(event_count) AS opens FROM analytics_daily_counts
         WHERE event_type = 'instance_open' AND episode_id <> ''
         GROUP BY episode_id ORDER BY opens DESC LIMIT 30`),
      all(env.ANALYTICS_DB,
        `SELECT context, COUNT(*) AS count FROM analytics_events
         WHERE received_at >= ? AND event_type = 'instance_open' GROUP BY context ORDER BY count DESC`, cutoff),
      all(env.ANALYTICS_DB,
        `SELECT search_mode, query_kind, result_bucket, COUNT(*) AS count FROM analytics_events
         WHERE received_at >= ? AND event_type = 'search_results'
         GROUP BY search_mode, query_kind, result_bucket ORDER BY count DESC`, cutoff),
      all(env.ANALYTICS_DB,
        `SELECT object_type, object_id AS id, COUNT(*) AS count FROM analytics_events
         WHERE received_at >= ? AND event_type IN ('search_submit', 'suggestion_select')
           AND object_type IN ('character', 'episode') AND object_id <> ''
         GROUP BY object_type, object_id ORDER BY count DESC LIMIT 30`, cutoff),
      all(env.ANALYTICS_DB,
        `SELECT screen_class AS name, COUNT(*) AS count FROM analytics_events
         WHERE received_at >= ? AND event_type = 'page_view' GROUP BY screen_class ORDER BY count DESC`, cutoff),
      all(env.ANALYTICS_DB,
        `SELECT country_code AS name, COUNT(*) AS count FROM analytics_events
         WHERE received_at >= ? AND event_type = 'page_view' AND country_code <> ''
         GROUP BY country_code HAVING COUNT(DISTINCT session_id) >= 5 ORDER BY count DESC LIMIT 20`, cutoff),
      all(env.ANALYTICS_DB,
        `SELECT COUNT(DISTINCT session_id) AS count FROM analytics_events
         WHERE received_at >= ? AND event_type = 'page_view' AND session_id IS NOT NULL`, sessionCutoff),
    ]);

    return json({
      generated_at: new Date().toISOString(), days,
      retention: { event_detail_days: 90, session_linkage_days: RETAIN_SESSION_DAYS },
      totals: countByType(rangeTotals),
      all_time_totals: countByType(allTimeTotals),
      unique_sessions: Number(sessionCount[0]?.count) || 0,
      unique_sessions_days: Math.min(days, RETAIN_SESSION_DAYS),
      daily, top_instances: topInstances, top_characters: topCharacters, top_episodes: topEpisodes,
      all_time_instances: allTimeInstances, all_time_characters: allTimeCharacters, all_time_episodes: allTimeEpisodes,
      entry_sources: sources, searches, search_targets: searchTargets, screens, countries, configured: true,
    });
  } catch {
    return json({ error: "analytics_unavailable" }, 503);
  }
}
