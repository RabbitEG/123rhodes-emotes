import { available, getOrCreateGuestbookUser, json, readSmallJson, sameOrigin, validMessage, verifyTurnstile } from "../../lib/guestbook.mjs";

export async function onRequestGet({ request, env }) {
  if (!env.GUESTBOOK_DB) return json({ enabled: false, messages: [], has_more: false });
  const sourceType = new URL(request.url).searchParams.get("source_type");
  const sourceId = new URL(request.url).searchParams.get("source_id") || "";
  if ((sourceType || sourceId) && (sourceType !== "instance" || !/^[\p{L}\p{N}][\p{L}\p{N}._~:-]{0,159}$/u.test(sourceId))) {
    return json({ error: "invalid_source" }, 400);
  }
  try {
    const fields = "m.body, m.created_at, COALESCE(u.display_name, '早期留言（未分配昵称）') AS author_name";
    const statement = sourceType === "instance"
      ? env.GUESTBOOK_DB.prepare(`SELECT ${fields} FROM guestbook_messages m LEFT JOIN guestbook_users u ON u.user_id = m.user_id WHERE m.status = 'approved' AND m.source_type = 'instance' AND m.source_id = ? ORDER BY m.created_at DESC, m.id DESC LIMIT 10`).bind(sourceId)
      : env.GUESTBOOK_DB.prepare(`SELECT ${fields} FROM guestbook_messages m LEFT JOIN guestbook_users u ON u.user_id = m.user_id WHERE m.status = 'approved' ORDER BY m.created_at DESC, m.id DESC LIMIT 10`);
    const result = await statement.all();
    return json({ enabled: available(env), messages: result.results || [], has_more: false });
  } catch { return json({ error: "unavailable" }, 503); }
}

export async function onRequestPost({ request, env }) {
  if (!available(env)) return json({ error: "unavailable" }, 503);
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  const input = await readSmallJson(request);
  const body = validMessage(input?.body);
  if (!body) return json({ error: "invalid_message" }, 400);
  const sourceType = input?.source_type ?? "home";
  const sourceId = input?.source_id ?? "";
  const validId = typeof sourceId === "string" && /^[\p{L}\p{N}][\p{L}\p{N}._~:-]{0,159}$/u.test(sourceId);
  if (sourceType !== "home" && sourceType !== "instance") return json({ error: "invalid_source" }, 400);
  if ((sourceType === "home" && sourceId !== "") || (sourceType === "instance" && !validId)) {
    return json({ error: "invalid_source" }, 400);
  }
  if (!(await verifyTurnstile(input?.turnstile_token, request, env.TURNSTILE_SECRET_KEY))) {
    return json({ error: "verification_failed" }, 400);
  }
  try {
    const user = await getOrCreateGuestbookUser(request, env);
    await env.GUESTBOOK_DB.prepare(
      "INSERT INTO guestbook_messages (id, body, created_at, status, source_type, source_id, user_id) VALUES (?, ?, ?, 'pending', ?, ?, ?)"
    ).bind(crypto.randomUUID(), body, new Date().toISOString(), sourceType, sourceId, user.userId).run();
    return json({ ok: true, status: "pending", author_name: user.displayName }, 201, { "Set-Cookie": user.cookie });
  } catch { return json({ error: "unavailable" }, 503); }
}
