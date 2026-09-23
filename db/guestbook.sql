-- Public guestbook only. Keep the private character SQLite database separate.
CREATE TABLE IF NOT EXISTS guestbook_messages (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS guestbook_status_time ON guestbook_messages (status, created_at DESC, id DESC);
