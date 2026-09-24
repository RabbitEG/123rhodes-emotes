import { adminAuthorized, json, readSmallJson, sameOrigin } from "../../../lib/guestbook.mjs";

async function authorized(request, env) {
  return env.GUESTBOOK_DB && await adminAuthorized(request, env.GUESTBOOK_ADMIN_KEY);
}

export async function onRequestGet({ request, env }) {
  if (!(await authorized(request, env))) return json({ error: "unauthorized" }, 401);
  const status = new URL(request.url).searchParams.get("status") || "pending";
  if (!["pending", "approved", "rejected"].includes(status)) return json({ error: "invalid_status" }, 400);
  try {
    const result = await env.GUESTBOOK_DB.prepare(
      "SELECT m.id, m.body, m.created_at, m.status, m.reviewed_at, m.source_type, m.source_id, COALESCE(u.display_name, '早期留言（未分配昵称）') AS author_name, COALESCE(u.first_display_name, u.display_name, '早期留言（未分配昵称）') AS first_author_name FROM guestbook_messages m LEFT JOIN guestbook_users u ON u.user_id = m.user_id WHERE m.status = ? ORDER BY m.created_at DESC, m.id DESC LIMIT 100"
    ).bind(status).all();
    return json({ messages: result.results || [] });
  } catch { return json({ error: "unavailable" }, 503); }
}

export async function onRequestPost({ request, env }) {
  if (!(await authorized(request, env))) return json({ error: "unauthorized" }, 401);
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  const input = await readSmallJson(request);
  if (!/^[0-9a-f-]{36}$/i.test(input?.id || "") || !["approved", "rejected", "pending"].includes(input?.status)) {
    return json({ error: "invalid_action" }, 400);
  }
  try {
    const result = await env.GUESTBOOK_DB.prepare(
      "UPDATE guestbook_messages SET status = ?, reviewed_at = ? WHERE id = ?"
    ).bind(input.status, input.status === "pending" ? null : new Date().toISOString(), input.id).run();
    return json({ ok: true, changed: result.meta?.changes || 0 });
  } catch { return json({ error: "unavailable" }, 503); }
}
