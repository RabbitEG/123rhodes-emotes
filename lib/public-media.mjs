// Only the deliberately exported public bundle is accessible, never arbitrary bucket keys.
export async function servePublicMedia({request, env}) {
  const headers = new Headers({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cache-Control": "no-store",
  });
  const fail = (message, status) => new Response(request.method === "HEAD" ? null : message, {status, headers});
  if (!["GET", "HEAD"].includes(request.method)) {
    headers.set("Allow", "GET, HEAD");
    return fail("Method not allowed", 405);
  }
  const key = new URL(request.url).pathname.slice(1);
  const manifest = key === "data/release.json";
  if (!manifest && !/^media\/(crops|source-previews|backgrounds)\/[0-9a-f]{16}-[0-9a-f]{16}\.webp$/.test(key)) {
    return fail("Not found", 404);
  }
  if (!env.media) return fail("公开图库尚未连接", 503);
  try {
    const object = request.method === "HEAD" ? await env.media.head(key) : await env.media.get(key);
    if (!object) return fail("Not found", 404);
    headers.set("Content-Type", manifest ? "application/json; charset=utf-8" : "image/webp");
    headers.set("Cache-Control", manifest ? "public, max-age=60, must-revalidate" : "public, max-age=31536000, immutable");
    headers.set("ETag", object.httpEtag);
    const tags = (request.headers.get("If-None-Match") || "").split(",").map(tag=>tag.trim().replace(/^W\//, ""));
    if (tags.includes("*") || tags.includes(object.httpEtag)) {
      if (object.body) await object.body.cancel();
      return new Response(null, {status:304, headers});
    }
    headers.set("Content-Length", String(object.size));
    return new Response(request.method === "HEAD" ? null : object.body, {headers});
  } catch {
    return fail("公开图库暂时无法读取，请稍后重试", 503);
  }
}
