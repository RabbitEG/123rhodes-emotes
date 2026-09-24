import { available, json, readSmallJson, sameOrigin, validMessage, verifyTurnstile } from "../../lib/guestbook.mjs";

export async function onRequestGet({ request, env }) {
  if (!env.GUESTBOOK_DB) return json({ enabled: false, messages: [], has_more: false });
  const sourceType = new URL(request.url).searchParams.get("source_type");
  const sourceId = new URL(request.url).searchParams.get("source_id") || "";
  if ((sourceType || sourceId) && (sourceType !== "instance" || !/^[\p{L}\p{N}][\p{L}\p{N}._~:-]{0,159}$/u.test(sourceId))) {
    return json({ error: "invalid_source" }, 400);
  }
  try {
    const statement = sourceType === "instance"
      ? env.GUESTBOOK_DB.prepare("SELECT body, created_at FROM guestbook_messages WHERE status = 'approved' AND source_type = 'instance' AND source_id = ? ORDER BY created_at DESC, id DESC LIMIT 10").bind(sourceId)
      : env.GUESTBOOK_DB.prepare("SELECT body, created_at FROM guestbook_messages WHERE status = 'approved' ORDER BY created_at DESC, id DESC LIMIT 10");
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
    await env.GUESTBOOK_DB.prepare(
      "INSERT INTO guestbook_messages (id, body, created_at, status, source_type, source_id) VALUES (?, ?, ?, 'pending', ?, ?)"
    ).bind(crypto.randomUUID(), body, new Date().toISOString(), sourceType, sourceId).run();
    return json({ ok: true, status: "pending" }, 201);
  } catch { return json({ error: "unavailable" }, 503); }
}
