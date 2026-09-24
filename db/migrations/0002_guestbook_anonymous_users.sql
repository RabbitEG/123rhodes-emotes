-- Apply once to an existing guestbook D1 after the source_type/source_id migration.
-- Existing comments keep their content/status/source and remain user_id=NULL.
CREATE TABLE IF NOT EXISTS guestbook_users (
  user_id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
ALTER TABLE guestbook_messages
  ADD COLUMN user_id INTEGER REFERENCES guestbook_users(user_id);
CREATE INDEX IF NOT EXISTS guestbook_user_time ON guestbook_messages (user_id, created_at DESC);
