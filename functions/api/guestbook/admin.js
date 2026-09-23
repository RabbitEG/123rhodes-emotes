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
      "SELECT id, body, created_at, status, reviewed_at FROM guestbook_messages WHERE status = ? ORDER BY created_at DESC, id DESC LIMIT 100"
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
