const noStore = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };
const visitorCookieName = "__Host-rhodes_guestbook";
const visitorCookieMaxAge = 34_560_000;
const favoredNumbers = new Set([799, 325, 328, 174, 290, 310, 996, 7, 42, 83, 226, 114, 514, 886, 985]);
const weightedNumberTotal = 1_065;
let rosterCache = null;
let rosterCacheUntil = 0;

export function json(value, status = 200, extraHeaders = {}) {
  const headers = new Headers(noStore);
  for (const [name, headerValue] of Object.entries(extraHeaders)) headers.set(name, headerValue);
  return new Response(JSON.stringify(value), { status, headers });
}

export function available(env) {
  return Boolean(env.GUESTBOOK_DB && env.TURNSTILE_SECRET_KEY && typeof env.GUESTBOOK_ADMIN_KEY === "string" && env.GUESTBOOK_ADMIN_KEY.length >= 32);
}

function randomBelow(max) {
  const range = 0x1_0000_0000;
  const limit = range - (range % max);
  const value = new Uint32Array(1);
  do { crypto.getRandomValues(value); } while (value[0] >= limit);
  return value[0] % max;
}

export function weightedSuffixForDraw(draw) {
  if (!Number.isInteger(draw) || draw < 0 || draw >= weightedNumberTotal) throw new RangeError("Invalid suffix draw");
  for (let number = 0; number < 1000; number++) {
    const weight = number === 325 ? 10 : favoredNumbers.has(number) ? 5 : 1;
    if (draw < weight) return String(number).padStart(3, "0");
    draw -= weight;
  }
  throw new RangeError("Invalid suffix draw");
}

export function aliasForDraw(names, registrationCount, nameDraw, suffixDraw) {
  if (!Array.isArray(names) || !names.length) throw new TypeError("Operator name list is empty");
  if (!Number.isSafeInteger(registrationCount) || registrationCount < 0) throw new RangeError("Invalid registration count");
  if (!Number.isInteger(nameDraw) || nameDraw < 0 || nameDraw >= names.length) throw new RangeError("Invalid operator draw");
  const rotation = Math.floor(registrationCount / 10_000) % names.length;
  const name = names[(rotation + nameDraw) % names.length];
  return `${name}#${weightedSuffixForDraw(suffixDraw)}`;
}

function readVisitorToken(request) {
  const cookies = request.headers.get("Cookie") || "";
  for (const part of cookies.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== visitorCookieName) continue;
    const value = part.slice(separator + 1).trim();
    if (/^[0-9a-f]{64}$/.test(value)) return value;
  }
  return null;
}

function newVisitorToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}

async function hashVisitorToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}

async function currentOperatorNames(env) {
  if (rosterCache && Date.now() < rosterCacheUntil) return rosterCache;
  if (!env.media?.get) throw new Error("Public operator roster unavailable");
  const object = await env.media.get("data/release.json");
  if (!object) throw new Error("Public operator roster unavailable");
  const release = await object.json();
  const names = [...new Set((release.characters || [])
    .filter(character => character?.type === "canonical" && typeof character.name === "string")
    .map(character => character.name.trim())
    .filter(Boolean))].sort();
  if (!names.length) throw new Error("Public operator roster is empty");
  rosterCache = names;
  rosterCacheUntil = Date.now() + 10 * 60 * 1000;
  return names;
}

export async function getOrCreateGuestbookUser(request, env) {
  const db = env.GUESTBOOK_DB;
  const token = readVisitorToken(request) || newVisitorToken();
  const tokenHash = await hashVisitorToken(token);
  const findUser = () => db.prepare(
    "SELECT user_id, display_name FROM guestbook_users WHERE token_hash = ?"
  ).bind(tokenHash).first();
  let user = await findUser();
  if (!user) {
    const countRow = await db.prepare("SELECT COUNT(*) AS total_users FROM guestbook_users").first();
    const registrationCount = Number(countRow?.total_users || 0);
    const names = await currentOperatorNames(env);
    for (let attempt = 0; attempt < 128; attempt++) {
      const displayName = aliasForDraw(names, registrationCount, randomBelow(names.length), randomBelow(weightedNumberTotal));
      await db.prepare(
        "INSERT OR IGNORE INTO guestbook_users (token_hash, display_name, created_at) VALUES (?, ?, ?)"
      ).bind(tokenHash, displayName, new Date().toISOString()).run();
      user = await findUser();
      if (user) break;
    }
  }
  if (!user) throw new Error("Unable to allocate a unique guestbook alias");
  const cookie = `${visitorCookieName}=${token}; Max-Age=${visitorCookieMaxAge}; Path=/; Secure; HttpOnly; SameSite=Lax`;
  return { userId: user.user_id, displayName: user.display_name, cookie };
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
