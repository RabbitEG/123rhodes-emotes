import { available, json, prepareGuestbookSubmission, readSmallJson, sameOrigin, validMessage, verifyTurnstile, visitorCookie } from "../../lib/guestbook.mjs";

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
    const user = await prepareGuestbookSubmission(request, env, input?.display_name);
    const messageId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const messageForUser = user.existing
      ? env.GUESTBOOK_DB.prepare(
        "INSERT INTO guestbook_messages (id, body, created_at, status, source_type, source_id, user_id) VALUES (?, ?, ?, 'pending', ?, ?, ?)"
      ).bind(messageId, body, createdAt, sourceType, sourceId, user.userId)
      : env.GUESTBOOK_DB.prepare(
        "INSERT INTO guestbook_messages (id, body, created_at, status, source_type, source_id, user_id) SELECT ?, ?, ?, 'pending', ?, ?, user_id FROM guestbook_users WHERE token_hash = ?"
      ).bind(messageId, body, createdAt, sourceType, sourceId, user.tokenHash);
    const statements = user.existing ? [messageForUser] : [
      env.GUESTBOOK_DB.prepare(
        "INSERT OR IGNORE INTO guestbook_users (token_hash, display_name, first_display_name, created_at) VALUES (?, ?, ?, ?)"
      ).bind(user.tokenHash, user.displayName, user.displayName, createdAt),
      messageForUser,
    ];
    const result = await env.GUESTBOOK_DB.batch(statements);
    const messageChanges = result?.at(-1)?.meta?.changes;
    if (messageChanges === 0) {
      if (!user.existing) {
        const racedUser = await env.GUESTBOOK_DB.prepare(
          "SELECT user_id, display_name FROM guestbook_users WHERE token_hash = ?"
        ).bind(user.tokenHash).first();
        if (!racedUser) {
          const error = new Error("Guestbook nickname was claimed");
          error.code = "nickname_taken";
          throw error;
        }
      }
      throw new Error("Guestbook message was not stored");
    }
    const persistedUser = user.existing ? user : await env.GUESTBOOK_DB.prepare(
      "SELECT user_id, display_name FROM guestbook_users WHERE token_hash = ?"
    ).bind(user.tokenHash).first();
    if (!persistedUser) throw new Error("Guestbook user was not stored");
    const cookie = visitorCookie(user.token);
    return json({ ok: true, status: "pending", author_name: user.existing ? user.displayName : persistedUser.display_name }, 201, { "Set-Cookie": cookie });
  } catch (error) {
    if (error?.code === "nickname_taken") return json({ error: "nickname_taken" }, 409);
    if (error?.code === "invalid_nickname") return json({ error: "invalid_nickname" }, 400);
    return json({ error: "unavailable" }, 503);
  }
}
