import { adminAuthorized, json } from "../../../lib/guestbook.mjs";

export async function onRequestGet({ request, env }) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "forbidden" }, 403);
  if (typeof env.SITE_ADMIN_KEY !== "string" || env.SITE_ADMIN_KEY.length < 32) {
    return json({ error: "not_configured" }, 503);
  }
  if (!(await adminAuthorized(request, env.SITE_ADMIN_KEY))) return json({ error: "unauthorized" }, 401);
  return json({ ok: true });
}
