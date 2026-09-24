const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ID = /^[\p{L}\p{N}][\p{L}\p{N}._~:-]{0,159}$/u;
const SAFE_RELEASE = /^[\p{L}\p{N}][\p{L}\p{N}._~:-]{0,79}$/u;
const EVENT_TYPES = new Set([
  "page_view", "search_submit", "search_results", "suggestion_select",
  "instance_impression", "instance_link_click", "instance_open",
  "episode_impression", "episode_select", "character_select", "source_click",
  "guestbook_submit", "release_error",
]);
const PAGE_TYPES = new Set(["home", "search", "instance", "about", "privacy", "notfound", "other"]);
const OBJECT_TYPES = new Set(["", "instance", "character", "episode"]);
const CONTEXTS = new Set([
  "", "direct", "external", "internal_home", "internal_search", "internal_instance",
  "home_ribbon", "search_grid", "episode_grid", "episode_results", "detail_related",
  "detail_source", "episode_card", "search_form", "suggestion", "ranking", "related",
  "not_found", "http_error", "invalid_data", "fetch_failed", "unknown",
]);
const SEARCH_MODES = new Set(["", "expressions", "episodes"]);
const QUERY_KINDS = new Set([
  "", "empty", "browse", "free_text", "known_character", "known_episode",
  "suggestion_character", "suggestion_episode",
]);
const SCREEN_CLASSES = new Set(["", "narrow", "wide", "unknown"]);

function safeId(value, pattern = SAFE_ID) {
  return typeof value === "string" && pattern.test(value) ? value : "";
}

function enumValue(value, values) {
  return typeof value === "string" && values.has(value) ? value : null;
}

export function normalizeAnalyticsEvent(input, countryCode = "") {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  if (!UUID.test(input.event_id || "") || !UUID.test(input.session_id || "")) return null;
  const eventType = enumValue(input.event_type, EVENT_TYPES);
  const pageType = enumValue(input.page_type, PAGE_TYPES);
  const objectType = enumValue(input.object_type ?? "", OBJECT_TYPES);
  const context = enumValue(input.context ?? "", CONTEXTS);
  const searchMode = enumValue(input.search_mode ?? "", SEARCH_MODES);
  const queryKind = enumValue(input.query_kind ?? "", QUERY_KINDS);
  const screenClass = enumValue(input.screen_class ?? "", SCREEN_CLASSES);
  if (!eventType || !pageType || objectType === null || context === null || searchMode === null || queryKind === null || screenClass === null) return null;

  const objectId = safeId(input.object_id);
  const characterId = safeId(input.character_id);
  const episodeId = safeId(input.episode_id);
  const releaseId = safeId(input.release_id, SAFE_RELEASE);
  const resultCount = input.result_count === null || input.result_count === undefined
    ? null
    : Number.isSafeInteger(input.result_count) && input.result_count >= 0 && input.result_count <= 1_000_000
      ? input.result_count : NaN;
  if (Number.isNaN(resultCount)) return null;
  if ((objectType && !objectId) || (!objectType && objectId)) return null;
  if (["instance_impression", "instance_link_click", "instance_open"].includes(eventType) && objectType !== "instance") return null;
  if (["episode_impression", "episode_select", "source_click"].includes(eventType) && objectType !== "episode") return null;
  if (eventType === "character_select" && objectType !== "character") return null;
  if (eventType === "suggestion_select" && !["character", "episode"].includes(objectType)) return null;
  if (eventType === "search_results" && (resultCount === null || !searchMode || !queryKind)) return null;

  const country = typeof countryCode === "string" && /^[A-Z]{2}$/.test(countryCode) ? countryCode : "";
  return {
    event_id: input.event_id.toLowerCase(),
    session_id: input.session_id.toLowerCase(),
    event_type: eventType,
    page_type: pageType,
    object_type: objectType,
    object_id: objectId,
    character_id: characterId,
    episode_id: episodeId,
    context,
    search_mode: searchMode,
    query_kind: queryKind,
    result_count: resultCount,
    result_bucket: resultBucket(resultCount),
    screen_class: screenClass || "unknown",
    country_code: country,
    release_id: releaseId,
  };
}

export function resultBucket(count) {
  if (!Number.isSafeInteger(count) || count < 0) return "";
  if (count === 0) return "zero";
  if (count <= 5) return "1_5";
  if (count <= 20) return "6_20";
  if (count <= 100) return "21_100";
  return "101_plus";
}

export const analyticsEventTypes = [...EVENT_TYPES];
