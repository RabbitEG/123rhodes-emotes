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
    // The public heat list is intentionally action-based. Automatic result,
    // detail-load, and viewport-exposure events remain available in the admin
    // report but must not make a character look popular by merely being loaded.
    const result = await env.ANALYTICS_DB.prepare(
      `SELECT id, SUM(event_count) AS hot
       FROM (
         SELECT CASE WHEN character_id <> '' THEN character_id
                     WHEN object_type = 'character' THEN object_id ELSE '' END AS id,
                event_count
         FROM analytics_daily_counts
         WHERE event_type IN (
           'search_submit', 'suggestion_select', 'character_select',
           'instance_link_click', 'source_click'
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
