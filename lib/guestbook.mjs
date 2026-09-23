const noStore = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };

export function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: noStore });
}

export function available(env) {
  return Boolean(env.GUESTBOOK_DB && env.TURNSTILE_SECRET_KEY && typeof env.GUESTBOOK_ADMIN_KEY === "string" && env.GUESTBOOK_ADMIN_KEY.length >= 32);
}

export function sameOrigin(request) {
  return request.headers.get("Origin") === new URL(request.url).origin;
}

export function validMessage(value) {
  if (typeof value !== "string") return null;
  const body = value.replace(/\r\n?/g, "\n").trim();
  if (!body || [...body].length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body)) return null;
  if (/https?:\/\/|www\./i.test(body)) return null;
  return body;
}

export async function readSmallJson(request) {
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) return null;
  if (Number(request.headers.get("Content-Length")) > 4096) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return null; }
}

export async function verifyTurnstile(token, request, secret, fetcher = fetch) {
  if (typeof token !== "string" || !token || token.length > 2048) return false;
  try {
    const form = new FormData();
    form.set("secret", secret);
    form.set("response", token);
    const response = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    if (!response.ok) return false;
    const result = await response.json();
    return result.success === true && result.hostname === new URL(request.url).hostname;
  } catch { return false; }
}

export async function adminAuthorized(request, secret) {
  if (typeof secret !== "string" || secret.length < 32) return false;
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Bearer ")) return false;
  const provided = header.slice(7);
  if (provided.length < 32 || provided.length > 256) return false;
  const encoder = new TextEncoder();
  const [actual, expected] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(secret)),
  ]);
  const left = new Uint8Array(actual), right = new Uint8Array(expected);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}
