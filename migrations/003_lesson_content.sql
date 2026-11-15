-- Lesson content generation (#23): job ownership, failure codes and regeneration limits.
-- Additive and idempotent; run after 002_study.sql with the same owner account.

-- Active content generation; a stale background job must not overwrite a newer one.
ALTER TABLE study.lessons ADD COLUMN IF NOT EXISTS content_generation uuid;
-- Why the last generation failed: provider, budget, timeout, unreadable, invalid,
-- ungrounded or interrupted. Kept with ready content when a regeneration failed.
ALTER TABLE study.lessons ADD COLUMN IF NOT EXISTS content_failure_code text;
-- Per-lesson daily regeneration count (UTC day); bounded by settings.
ALTER TABLE study.lessons ADD COLUMN IF NOT EXISTS regeneration_day date;
ALTER TABLE study.lessons ADD COLUMN IF NOT EXISTS regeneration_count integer NOT NULL DEFAULT 0;
ALTER TABLE study.lessons DROP CONSTRAINT IF EXISTS lessons_regeneration_count_check;
ALTER TABLE study.lessons ADD CONSTRAINT lessons_regeneration_count_check
    CHECK (regeneration_count >= 0);
