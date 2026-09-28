const cacheHeaders = {
  "Cache-Control": "public, max-age=60, s-maxage=300",
  "Content-Type": "application/json; charset=utf-8",
};

function response(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: cacheHeaders });
}

export async function onRequestGet({ env }) {
  if (!env.ANALYTICS_DB) return response({ items: [] });
  try {
    const result = await env.ANALYTICS_DB.prepare(
      `SELECT id, SUM(event_count) AS hot
       FROM (
         SELECT CASE WHEN character_id <> '' THEN character_id
                     WHEN object_type = 'character' THEN object_id ELSE '' END AS id,
                event_count
         FROM analytics_daily_counts
         WHERE event_type IN (
           'search_submit', 'search_results', 'suggestion_select', 'character_select',
           'instance_impression', 'instance_link_click', 'instance_open', 'source_click'
         )
           AND (character_id <> '' OR (object_type = 'character' AND object_id <> ''))
       )
       WHERE id <> ''
       GROUP BY id
       ORDER BY hot DESC, id ASC
       LIMIT 100`
    ).all();
    const items = (result.results || []).flatMap(row => {
      const id = typeof row.id === "string" ? row.id : "";
      const hot = Number(row.hot);
      return id && Number.isSafeInteger(hot) && hot > 0 ? [{ id, hot }] : [];
    });
    return response({ items });
  } catch {
    return response({ items: [] }, 503);
  }
}
