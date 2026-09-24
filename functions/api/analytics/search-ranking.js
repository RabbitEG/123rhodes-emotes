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
      `SELECT object_id AS id, SUM(event_count) AS searches
       FROM analytics_daily_counts
       WHERE event_type IN ('search_submit', 'suggestion_select')
         AND object_type = 'character' AND object_id <> ''
       GROUP BY object_id
       ORDER BY searches DESC, id ASC
       LIMIT 100`
    ).all();
    const items = (result.results || []).flatMap(row => {
      const id = typeof row.id === "string" ? row.id : "";
      const searches = Number(row.searches);
      return id && Number.isSafeInteger(searches) && searches > 0 ? [{ id, searches }] : [];
    });
    return response({ items });
  } catch {
    return response({ items: [] }, 503);
  }
}
