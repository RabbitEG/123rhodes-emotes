-- Apply after 0003_guestbook_first_nickname.sql.
-- Freeze each existing comment at the nickname visible immediately before this migration.
ALTER TABLE guestbook_messages ADD COLUMN display_name TEXT;
UPDATE guestbook_messages
SET display_name = COALESCE(
  (SELECT u.display_name FROM guestbook_users u WHERE u.user_id = guestbook_messages.user_id),
  '早期留言（未分配昵称）'
)
WHERE display_name IS NULL;
