-- Master mode (Study Buddy): courses, lessons, quizzes and progress.
-- Additive and idempotent; run after 001_initial.sql with the same owner account.
CREATE SCHEMA IF NOT EXISTS study;
REVOKE ALL ON SCHEMA study FROM PUBLIC;

-- One course per source document. SQL ownership: deleting the document deletes the course.
CREATE TABLE IF NOT EXISTS study.courses (
    id uuid PRIMARY KEY,
    document_id uuid NOT NULL UNIQUE REFERENCES rag.documents ON DELETE CASCADE,
    title text NOT NULL,
    status text NOT NULL CHECK (status IN ('generating', 'ready', 'failed')),
    failure_code text,
    -- Active plan generation; stale background jobs must not write over a newer one.
    generation uuid,
    estimated_minutes integer NOT NULL DEFAULT 0 CHECK (estimated_minutes >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS study.modules (
    id uuid PRIMARY KEY,
    course_id uuid NOT NULL REFERENCES study.courses ON DELETE CASCADE,
    position integer NOT NULL CHECK (position >= 1),
    title text NOT NULL,
    summary text NOT NULL DEFAULT '',
    estimated_minutes integer NOT NULL DEFAULT 0 CHECK (estimated_minutes >= 0),
    UNIQUE (course_id, position)
);

-- Lessons are content-sized (one concept, readable in about six minutes); estimates are informational.
CREATE TABLE IF NOT EXISTS study.lessons (
    id uuid PRIMARY KEY,
    course_id uuid NOT NULL REFERENCES study.courses ON DELETE CASCADE,
    module_id uuid NOT NULL REFERENCES study.modules ON DELETE CASCADE,
    -- Course-wide teaching order; unlocking follows this sequence.
    position integer NOT NULL CHECK (position >= 1),
    title text NOT NULL,
    objective text NOT NULL DEFAULT '',
    source_section_ids text[] NOT NULL CHECK (cardinality(source_section_ids) >= 1),
    estimated_minutes integer NOT NULL DEFAULT 0 CHECK (estimated_minutes >= 0),
    content jsonb,
    content_status text NOT NULL DEFAULT 'pending'
        CHECK (content_status IN ('pending', 'generating', 'ready', 'failed')),
    content_generated_at timestamptz,
    UNIQUE (course_id, position)
);
CREATE INDEX IF NOT EXISTS lessons_module ON study.lessons(module_id, position);

CREATE TABLE IF NOT EXISTS study.lesson_progress (
    lesson_id uuid PRIMARY KEY REFERENCES study.lessons ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'locked'
        CHECK (status IN ('locked', 'available', 'in_progress', 'completed')),
    opened_at timestamptz,
    completed_at timestamptz,
    -- Passive accumulation from bounded heartbeats; never a limit.
    study_seconds integer NOT NULL DEFAULT 0 CHECK (study_seconds >= 0),
    last_study_at timestamptz
);

-- questions holds the answer key and explanations; the API never serializes them before submission.
CREATE TABLE IF NOT EXISTS study.quiz_attempts (
    id uuid PRIMARY KEY,
    lesson_id uuid NOT NULL REFERENCES study.lessons ON DELETE CASCADE,
    attempt_number integer NOT NULL CHECK (attempt_number >= 1),
    questions jsonb NOT NULL,
    answers jsonb,
    score integer CHECK (score BETWEEN 0 AND 3),
    passed boolean,
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'submitted', 'abandoned')),
    created_at timestamptz NOT NULL DEFAULT now(),
    submitted_at timestamptz
);
CREATE INDEX IF NOT EXISTS quiz_attempts_lesson ON study.quiz_attempts(lesson_id, created_at DESC);

CREATE TABLE IF NOT EXISTS study.your_turn_attempts (
    id uuid PRIMARY KEY,
    lesson_id uuid NOT NULL REFERENCES study.lessons ON DELETE CASCADE,
    answer text NOT NULL,
    verdict text NOT NULL CHECK (verdict IN ('correct', 'partial', 'incorrect')),
    feedback text NOT NULL,
    revealed boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS your_turn_attempts_lesson
    ON study.your_turn_attempts(lesson_id, created_at DESC);

-- Tutor chats reuse rag.conversations; deleting either side removes only the binding.
CREATE TABLE IF NOT EXISTS study.lesson_conversations (
    lesson_id uuid NOT NULL REFERENCES study.lessons ON DELETE CASCADE,
    conversation_id uuid NOT NULL REFERENCES rag.conversations ON DELETE CASCADE,
    PRIMARY KEY (lesson_id, conversation_id)
);

-- Course tombstones let browsers drop cached courses after document or course deletion.
ALTER TABLE rag.deletions DROP CONSTRAINT IF EXISTS deletions_kind_check;
ALTER TABLE rag.deletions ADD CONSTRAINT deletions_kind_check
    CHECK (kind IN ('document', 'conversation', 'course'));
