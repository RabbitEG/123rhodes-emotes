import { available, json, readSmallJson, sameOrigin, validMessage, verifyTurnstile } from "../../lib/guestbook.mjs";

export async function onRequestGet({ request, env }) {
  if (!env.GUESTBOOK_DB) return json({ enabled: false, messages: [], has_more: false });
  const page = Number(new URL(request.url).searchParams.get("page") || "0");
  if (!Number.isSafeInteger(page) || page < 0 || page > 1000) return json({ error: "invalid_page" }, 400);
  try {
    const result = await env.GUESTBOOK_DB.prepare(
      "SELECT body, created_at FROM guestbook_messages WHERE status = 'approved' ORDER BY created_at DESC, id DESC LIMIT 21 OFFSET ?"
    ).bind(page * 20).all();
    const rows = result.results || [];
    return json({ enabled: available(env), messages: rows.slice(0, 20), has_more: rows.length > 20 });
  } catch { return json({ error: "unavailable" }, 503); }
}

export async function onRequestPost({ request, env }) {
  if (!available(env)) return json({ error: "unavailable" }, 503);
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  const input = await readSmallJson(request);
  const body = validMessage(input?.body);
  if (!body) return json({ error: "invalid_message" }, 400);
  if (!(await verifyTurnstile(input?.turnstile_token, request, env.TURNSTILE_SECRET_KEY))) {
    return json({ error: "verification_failed" }, 400);
  }
  try {
    await env.GUESTBOOK_DB.prepare(
      "INSERT INTO guestbook_messages (id, body, created_at, status) VALUES (?, ?, ?, 'pending')"
    ).bind(crypto.randomUUID(), body, new Date().toISOString()).run();
    return json({ ok: true, status: "pending" }, 201);
  } catch { return json({ error: "unavailable" }, 503); }
}
