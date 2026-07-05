-- 002_approval_columns.sql
-- Approval-reply-handler (Telegram getUpdates poller pushes approved videos to
-- YouTube). To match a human's Telegram reply back to the correct videos row,
-- the approval message's Telegram message id + chat id are persisted when the
-- video lands at status='pending_approval'. youtube_video_id is stored on a
-- successful upload (status='published').
--   tg_message_id    -- Telegram message_id of the sent approval message
--   tg_chat_id       -- Telegram chat_id the approval message was sent to
--   youtube_video_id -- YouTube video id returned by videos.insert on publish
-- New status values (plain TEXT, no enum change):
--   approved   -- human approved; upload pending or in progress
--   rejected   -- human rejected; tmp/ assets kept, reject_reason saved
--   published  -- upload confirmed; youtube_video_id set, tmp/ cleaned
-- Existing statuses are unchanged.

ALTER TABLE videos ADD COLUMN tg_message_id INTEGER;
ALTER TABLE videos ADD COLUMN tg_chat_id TEXT;
ALTER TABLE videos ADD COLUMN youtube_video_id TEXT;
