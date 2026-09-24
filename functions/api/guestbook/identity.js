import { available, findGuestbookUser, getAvailableGuestbookAlias, json, rerollCurrentGuestbookName, sameOrigin, visitorCookie } from "../../../lib/guestbook.mjs";

export async function onRequestGet({ request, env }) {
  if (!available(env)) return json({ enabled: false, registered: false });
  try {
    const user = await findGuestbookUser(request, env);
    if (user) return json({ enabled: true, registered: true, author_name: user.display_name });
    const excludedName = new URL(request.url).searchParams.get("exclude") || "";
    const authorName = await getAvailableGuestbookAlias(env, excludedName.slice(0, 200));
    return json({ enabled: true, registered: false, author_name: authorName });
  } catch { return json({ error: "unavailable" }, 503); }
}

export async function onRequestPost({ request, env }) {
  if (!available(env)) return json({ error: "unavailable" }, 503);
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  try {
    const user = await rerollCurrentGuestbookName(request, env);
    return json({ enabled: true, registered: true, author_name: user.displayName }, 200, {
      "Set-Cookie": visitorCookie(user.token),
    });
  } catch (error) {
    if (error?.code === "not_registered") return json({ error: "not_registered" }, 409);
    if (error?.code === "nickname_changed") return json({ error: "nickname_changed" }, 409);
    return json({ error: "unavailable" }, 503);
  }
}
