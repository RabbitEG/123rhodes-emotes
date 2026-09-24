import { available, findGuestbookUser, getAvailableGuestbookAlias, json } from "../../../lib/guestbook.mjs";

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
