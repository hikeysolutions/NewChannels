-- 001_batch_columns.sql
-- Channel A async stills pipeline (two-phase, Gemini Batch API).
-- Phase 1 submits a stills Batch job and persists its id + submit time, then
-- exits at status='awaiting_stills'. A cron poller (Phase 2) collects the job,
-- assembles, and publishes. New status values are plain TEXT (no enum change):
--   awaiting_stills   -- batch submitted, waiting for results
--   collecting_stills -- transient lock while a poller downloads + assembles
--   stills_failed     -- batch failed or exceeded max-age; alerted for review
-- Existing statuses (scripting, qa_pending, qa_blocked, generating, assembling,
-- pending_approval, dry_run_complete) are unchanged.

ALTER TABLE videos ADD COLUMN batch_job_id TEXT;
ALTER TABLE videos ADD COLUMN batch_submitted_at TEXT;
