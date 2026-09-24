-- Apply once after 0002_guestbook_anonymous_users.sql.
-- Existing users keep their current name as their immutable first nickname.
ALTER TABLE guestbook_users ADD COLUMN first_display_name TEXT;
UPDATE guestbook_users SET first_display_name = display_name WHERE first_display_name IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS guestbook_first_display_name_unique
  ON guestbook_users (first_display_name);
