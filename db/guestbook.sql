-- Public guestbook only. Keep the private character SQLite database separate.
CREATE TABLE IF NOT EXISTS guestbook_users (
  user_id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL UNIQUE,
  first_display_name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS guestbook_messages (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_at TEXT,
  source_type TEXT NOT NULL DEFAULT 'home' CHECK (source_type IN ('home', 'instance')),
  source_id TEXT NOT NULL DEFAULT '',
  user_id INTEGER REFERENCES guestbook_users(user_id),
  display_name TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS guestbook_status_time ON guestbook_messages (status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS guestbook_user_time ON guestbook_messages (user_id, created_at DESC);
