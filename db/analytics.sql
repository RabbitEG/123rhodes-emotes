-- First-party site analytics only. Never store visitor IPs, raw search text,
-- full request URLs, User-Agent strings, cookies, or request headers here.
CREATE TABLE IF NOT EXISTS analytics_events (
  event_id TEXT PRIMARY KEY,
  session_id TEXT,
  received_at TEXT NOT NULL,
  day TEXT NOT NULL,
  event_type TEXT NOT NULL,
  page_type TEXT NOT NULL,
  object_type TEXT NOT NULL DEFAULT '',
  object_id TEXT NOT NULL DEFAULT '',
  character_id TEXT NOT NULL DEFAULT '',
  episode_id TEXT NOT NULL DEFAULT '',
  context TEXT NOT NULL DEFAULT '',
  search_mode TEXT NOT NULL DEFAULT '',
  query_kind TEXT NOT NULL DEFAULT '',
  result_count INTEGER,
  result_bucket TEXT NOT NULL DEFAULT '',
  screen_class TEXT NOT NULL DEFAULT 'unknown',
  country_code TEXT NOT NULL DEFAULT '',
  release_id TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS analytics_events_time ON analytics_events(received_at, event_type);
CREATE INDEX IF NOT EXISTS analytics_events_day ON analytics_events(day, event_type);
CREATE INDEX IF NOT EXISTS analytics_events_session ON analytics_events(session_id, received_at);
CREATE INDEX IF NOT EXISTS analytics_events_instance ON analytics_events(object_type, object_id, event_type, received_at);
CREATE INDEX IF NOT EXISTS analytics_events_character ON analytics_events(character_id, event_type, received_at);
CREATE INDEX IF NOT EXISTS analytics_events_episode ON analytics_events(episode_id, event_type, received_at);

-- Long-term counts retain only daily aggregates, not a visitor-level trail.
CREATE TABLE IF NOT EXISTS analytics_daily_counts (
  day TEXT NOT NULL,
  event_type TEXT NOT NULL,
  page_type TEXT NOT NULL,
  object_type TEXT NOT NULL DEFAULT '',
  object_id TEXT NOT NULL DEFAULT '',
  character_id TEXT NOT NULL DEFAULT '',
  episode_id TEXT NOT NULL DEFAULT '',
  context TEXT NOT NULL DEFAULT '',
  search_mode TEXT NOT NULL DEFAULT '',
  query_kind TEXT NOT NULL DEFAULT '',
  result_bucket TEXT NOT NULL DEFAULT '',
  event_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(day, event_type, page_type, object_type, object_id, character_id, episode_id, context, search_mode, query_kind, result_bucket)
);

CREATE INDEX IF NOT EXISTS analytics_daily_event ON analytics_daily_counts(event_type, day);
CREATE INDEX IF NOT EXISTS analytics_daily_object ON analytics_daily_counts(object_type, object_id, event_type);
CREATE TABLE IF NOT EXISTS analytics_maintenance (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS analytics_event_to_daily_count
AFTER INSERT ON analytics_events
BEGIN
  INSERT INTO analytics_daily_counts (
    day, event_type, page_type, object_type, object_id, character_id, episode_id,
    context, search_mode, query_kind, result_bucket, event_count
  ) VALUES (
    NEW.day, NEW.event_type, NEW.page_type, NEW.object_type, NEW.object_id, NEW.character_id, NEW.episode_id,
    NEW.context, NEW.search_mode, NEW.query_kind, NEW.result_bucket, 1
  )
  ON CONFLICT(day, event_type, page_type, object_type, object_id, character_id, episode_id, context, search_mode, query_kind, result_bucket)
  DO UPDATE SET event_count = event_count + 1;
END;
