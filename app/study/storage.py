"""Study schema access on the shared PostgreSQL pool. SQL stays authoritative for ownership."""

from uuid import UUID, uuid4

from psycopg.types.json import Jsonb

from app.storage import Conflict, NotFound
from app.study.models import (
    CourseSummary,
    CourseView,
    LessonOutline,
    LessonPlan,
    LessonView,
    ModuleView,
    QuizAttemptSummary,
)

# scripts.ingest.chunks(size=2400, overlap=240): later chunks repeat the previous 240 chars.
CHUNK_OVERLAP = 240
# Regeneration limits count per UTC day, independent of the session time zone.
TODAY = "(now() AT TIME ZONE 'UTC')::date"

COURSE_SUMMARY = """
SELECT c.id, c.document_id, c.title, c.status, c.failure_code, c.generation,
       c.estimated_minutes, c.created_at, c.updated_at,
       (SELECT count(*) FROM study.modules m WHERE m.course_id=c.id)::int AS module_count,
       (SELECT count(*) FROM study.lessons l WHERE l.course_id=c.id)::int AS lesson_count,
       (SELECT count(*) FROM study.lessons l JOIN study.lesson_progress p ON p.lesson_id=l.id
         WHERE l.course_id=c.id AND p.status='completed')::int AS completed_lessons
FROM study.courses c
"""


async def tombstone_document_courses(conn, document_id):
    """Inside document deletion: record course tombstones and drop bound tutor chats.

    The course rows themselves disappear through the documents FK cascade.
    """
    await conn.execute(
        "INSERT INTO rag.deletions(kind,id) SELECT 'course', id FROM study.courses "
        "WHERE document_id=%s ON CONFLICT DO NOTHING",
        (document_id,),
    )
    await _delete_bound_conversations(
        conn,
        "SELECT lc.conversation_id FROM study.lesson_conversations lc "
        "JOIN study.lessons l ON l.id=lc.lesson_id JOIN study.courses c ON c.id=l.course_id "
        "WHERE c.document_id=%s",
        (document_id,),
    )


async def _complete(conn, lesson_id):
    """Inside a transaction: completed stays completed; only position+1 may unlock."""
    cur = await conn.execute(
        "SELECT l.course_id, l.position, p.status FROM study.lessons l "
        "JOIN study.lesson_progress p ON p.lesson_id=l.id WHERE l.id=%s FOR UPDATE",
        (lesson_id,),
    )
    row = await cur.fetchone()
    if not row:
        raise NotFound("Lesson does not exist")
    if row["status"] == "locked":
        raise Conflict("Pass the previous quiz before completing this lesson")
    await conn.execute(
        "UPDATE study.lesson_progress SET status='completed', "
        "completed_at=COALESCE(completed_at, now()) WHERE lesson_id=%s",
        (lesson_id,),
    )
    cur = await conn.execute(
        "UPDATE study.lesson_progress SET status='available' WHERE status='locked' AND "
        "lesson_id=(SELECT id FROM study.lessons WHERE course_id=%s AND position=%s) "
        "RETURNING lesson_id",
        (row["course_id"], row["position"] + 1),
    )
    unlocked = await cur.fetchone()
    return unlocked["lesson_id"] if unlocked else None


async def _delete_bound_conversations(conn, select_sql, params):
    cur = await conn.execute(select_sql, params)
    ids = [row["conversation_id"] for row in await cur.fetchall()]
    if not ids:
        return []
    await conn.execute(
        "INSERT INTO rag.deletions(kind,id) SELECT 'conversation', unnest(%s::uuid[]) "
        "ON CONFLICT DO NOTHING",
        (ids,),
    )
    await conn.execute("DELETE FROM rag.conversations WHERE id = ANY(%s)", (ids,))
    return ids


class StudyStorage:
    def __init__(self, pool):
        self.pool = pool

    # Documents -----------------------------------------------------------------

    async def document_outline(self, document_id: UUID) -> list[dict]:
        """Sections with their full text rebuilt from chunks (overlap removed), in reading order."""
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "SELECT title FROM rag.documents WHERE id=%s", (document_id,)
            )
            document = await cur.fetchone()
            if not document:
                raise NotFound("Document does not exist")
            cur = await conn.execute(
                "SELECT s.id, s.number, s.title, s.parent_id, s.kind, "
                "coalesce(string_agg(CASE WHEN c.chunk_index=0 THEN c.text "
                "ELSE substr(c.text, %s+1) END, '' ORDER BY c.chunk_index), '') AS text "
                "FROM rag.sections s LEFT JOIN rag.chunks c "
                "ON c.document_id=s.document_id AND c.section_id=s.id "
                "WHERE s.document_id=%s GROUP BY s.id, s.number, s.title, s.parent_id, s.kind "
                "ORDER BY min(c.id) NULLS LAST, s.number",
                (CHUNK_OVERLAP, document_id),
            )
            rows = await cur.fetchall()
        return [{**row, "document_title": document["title"]} for row in rows]

    # Courses -----------------------------------------------------------------

    async def create_course(self, document_id: UUID, generation: UUID):
        """Idempotent per document: returns (summary, created)."""
        async with self.pool.connection() as conn:
            cur = await conn.execute("SELECT title FROM rag.documents WHERE id=%s", (document_id,))
            document = await cur.fetchone()
            if not document:
                raise NotFound("Document does not exist")
            cur = await conn.execute(
                "INSERT INTO study.courses(id,document_id,title,status,generation) "
                "VALUES (%s,%s,%s,'generating',%s) ON CONFLICT (document_id) DO NOTHING "
                "RETURNING id",
                (uuid4(), document_id, document["title"], generation),
            )
            created = await cur.fetchone() is not None
            cur = await conn.execute(COURSE_SUMMARY + "WHERE c.document_id=%s", (document_id,))
            return CourseSummary.model_validate(await cur.fetchone()), created

    async def begin_generation(self, course_id: UUID, generation: UUID) -> bool:
        """Restart planning for a failed course; ready/generating courses are left alone."""
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "UPDATE study.courses SET status='generating', generation=%s, failure_code=NULL, "
                "updated_at=now() WHERE id=%s AND status='failed' RETURNING id",
                (generation, course_id),
            )
            return await cur.fetchone() is not None

    async def fail_course(self, course_id: UUID, generation: UUID, code: str) -> bool:
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "UPDATE study.courses SET status='failed', failure_code=%s, updated_at=now() "
                "WHERE id=%s AND generation=%s AND status='generating' RETURNING id",
                (code, course_id, generation),
            )
            return await cur.fetchone() is not None

    async def mark_interrupted(self) -> int:
        """At startup: no in-process job survived, so nothing can still be generating."""
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "UPDATE study.courses SET status='failed', failure_code='interrupted', "
                "updated_at=now() WHERE status='generating' RETURNING id"
            )
            courses = len(await cur.fetchall())
            cur = await conn.execute(
                "UPDATE study.lessons SET content_failure_code='interrupted', content_status="
                "CASE WHEN content IS NULL THEN 'failed' ELSE 'ready' END "
                "WHERE content_status='generating' RETURNING id"
            )
            return courses + len(await cur.fetchall())

    async def write_plan(self, course_id: UUID, generation: UUID, plan: LessonPlan) -> CourseView:
        """Replace the course outline atomically; only the active generation may write."""
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "SELECT generation FROM study.courses WHERE id=%s FOR UPDATE", (course_id,)
            )
            row = await cur.fetchone()
            if not row:
                raise NotFound("Course does not exist")
            if row["generation"] != generation:
                raise Conflict("A newer generation owns this course")
            await conn.execute("DELETE FROM study.modules WHERE course_id=%s", (course_id,))
            position = 0
            first_lesson = None
            for module_index, module in enumerate(plan.modules, 1):
                module_id = uuid4()
                await conn.execute(
                    "INSERT INTO study.modules(id,course_id,position,title,summary,estimated_minutes) "
                    "VALUES (%s,%s,%s,%s,%s,%s)",
                    (module_id, course_id, module_index, module.title, module.summary,
                     module.estimated_minutes),
                )
                for lesson in module.lessons:
                    position += 1
                    lesson_id = uuid4()
                    first_lesson = first_lesson or lesson_id
                    await conn.execute(
                        "INSERT INTO study.lessons(id,course_id,module_id,position,title,objective,"
                        "source_section_ids,estimated_minutes) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                        (lesson_id, course_id, module_id, position, lesson.title,
                         lesson.objective, lesson.source_section_ids, lesson.estimated_minutes),
                    )
                    await conn.execute(
                        "INSERT INTO study.lesson_progress(lesson_id,status) VALUES (%s,%s)",
                        (lesson_id, "available" if lesson_id == first_lesson else "locked"),
                    )
            await conn.execute(
                "UPDATE study.courses SET status='ready', failure_code=NULL, estimated_minutes=%s, "
                "updated_at=now() WHERE id=%s",
                (plan.estimated_minutes, course_id),
            )
        return await self.course(course_id)

    async def courses(self) -> list[CourseSummary]:
        async with self.pool.connection() as conn:
            cur = await conn.execute(COURSE_SUMMARY + "ORDER BY c.updated_at DESC, c.title")
            return [CourseSummary.model_validate(row) for row in await cur.fetchall()]

    async def course(self, course_id: UUID) -> CourseView:
        async with self.pool.connection() as conn:
            cur = await conn.execute(COURSE_SUMMARY + "WHERE c.id=%s", (course_id,))
            course = await cur.fetchone()
            if not course:
                raise NotFound("Course does not exist")
            cur = await conn.execute(
                "SELECT id, position, title, summary, estimated_minutes FROM study.modules "
                "WHERE course_id=%s ORDER BY position",
                (course_id,),
            )
            modules = await cur.fetchall()
            cur = await conn.execute(
                "SELECT l.id, l.module_id, l.position, l.title, l.objective, l.estimated_minutes, "
                "l.content_status, p.status FROM study.lessons l "
                "JOIN study.lesson_progress p ON p.lesson_id=l.id "
                "WHERE l.course_id=%s ORDER BY l.position",
                (course_id,),
            )
            lessons = [LessonOutline.model_validate(row) for row in await cur.fetchall()]
        return CourseView.model_validate({
            **course,
            "modules": [
                ModuleView.model_validate({
                    **module,
                    "lessons": [lesson for lesson in lessons if lesson.module_id == module["id"]],
                })
                for module in modules
            ],
        })

    async def delete_course(self, course_id: UUID):
        """Removes study data and bound tutor chats only; the source document stays."""
        async with self.pool.connection() as conn:
            await conn.execute(
                "INSERT INTO rag.deletions(kind,id) VALUES ('course',%s) ON CONFLICT DO NOTHING",
                (course_id,),
            )
            await _delete_bound_conversations(
                conn,
                "SELECT lc.conversation_id FROM study.lesson_conversations lc "
                "JOIN study.lessons l ON l.id=lc.lesson_id WHERE l.course_id=%s",
                (course_id,),
            )
            await conn.execute("DELETE FROM study.courses WHERE id=%s", (course_id,))
        return {"status": "deleted", "id": str(course_id)}

    # Lessons -----------------------------------------------------------------

    async def lesson(self, lesson_id: UUID) -> LessonView:
        """Full row including server-only content fields; serialize via client_view only."""
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "SELECT l.id, l.course_id, l.module_id, c.document_id, l.position, l.title, "
                "l.objective, l.source_section_ids, l.estimated_minutes, l.content_status, "
                "l.content_generated_at, l.content, l.content_failure_code, "
                "l.content_generation, CASE WHEN l.regeneration_day=" + TODAY + " "
                "THEN l.regeneration_count ELSE 0 END AS regenerations_today, "
                "p.status, p.opened_at, p.completed_at, "
                "p.study_seconds FROM study.lessons l JOIN study.courses c ON c.id=l.course_id "
                "JOIN study.lesson_progress p ON p.lesson_id=l.id WHERE l.id=%s",
                (lesson_id,),
            )
            row = await cur.fetchone()
        if not row:
            raise NotFound("Lesson does not exist")
        return LessonView.model_validate({**row, "progress": row})

    async def lesson_evidence(self, lesson_id: UUID) -> tuple[dict, list[dict]]:
        """The lesson and its source sections (full text, first page), in plan order."""
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "SELECT l.id, l.title, l.objective, l.source_section_ids, c.document_id, "
                "d.title AS document_title, d.edition FROM study.lessons l "
                "JOIN study.courses c ON c.id=l.course_id "
                "JOIN rag.documents d ON d.id=c.document_id WHERE l.id=%s",
                (lesson_id,),
            )
            lesson = await cur.fetchone()
            if not lesson:
                raise NotFound("Lesson does not exist")
            cur = await conn.execute(
                "SELECT s.id, s.number, s.title, s.kind, min(c.page) AS page, "
                "coalesce(string_agg(CASE WHEN c.chunk_index=0 THEN c.text "
                "ELSE substr(c.text, %s+1) END, '' ORDER BY c.chunk_index), '') AS text "
                "FROM rag.sections s LEFT JOIN rag.chunks c "
                "ON c.document_id=s.document_id AND c.section_id=s.id "
                "WHERE s.document_id=%s AND s.id = ANY(%s) "
                "GROUP BY s.id, s.number, s.title, s.kind",
                (CHUNK_OVERLAP, lesson["document_id"], lesson["source_section_ids"]),
            )
            rows = {row["id"]: row for row in await cur.fetchall()}
        shared = {key: lesson[key] for key in ("document_id", "document_title", "edition")}
        sections = [
            {**rows[sid], **shared} for sid in lesson["source_section_ids"] if sid in rows
        ]
        return lesson, sections

    async def begin_content(self, lesson_id: UUID, generation: UUID) -> bool:
        """pending -> generating for exactly one caller; concurrent opens start one job."""
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "UPDATE study.lessons SET content_status='generating', content_generation=%s, "
                "content_failure_code=NULL WHERE id=%s AND content_status='pending' RETURNING id",
                (generation, lesson_id),
            )
            return await cur.fetchone() is not None

    async def begin_regeneration(self, lesson_id: UUID, generation: UUID, daily_limit: int) -> str:
        """ready/failed -> generating within the per-lesson daily limit.

        Returns started, busy (pending or already generating) or limit. Existing content
        stays readable until the new generation replaces it.
        """
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "UPDATE study.lessons SET content_status='generating', content_generation=%s, "
                "content_failure_code=NULL, regeneration_count=CASE WHEN regeneration_day="
                + TODAY + " THEN regeneration_count+1 ELSE 1 END, regeneration_day=" + TODAY
                + " WHERE id=%s AND content_status IN ('ready','failed') AND "
                "(regeneration_day IS DISTINCT FROM " + TODAY + " OR regeneration_count < %s) "
                "RETURNING id",
                (generation, lesson_id, daily_limit),
            )
            if await cur.fetchone():
                return "started"
            cur = await conn.execute(
                "SELECT content_status FROM study.lessons WHERE id=%s", (lesson_id,)
            )
            row = await cur.fetchone()
        if not row:
            raise NotFound("Lesson does not exist")
        return "busy" if row["content_status"] in ("pending", "generating") else "limit"

    async def write_content(self, lesson_id: UUID, generation: UUID, content: dict) -> None:
        """Replace content atomically; only the active generation may write."""
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "UPDATE study.lessons SET content=%s, content_status='ready', "
                "content_failure_code=NULL, content_generated_at=now() "
                "WHERE id=%s AND content_generation=%s AND content_status='generating' "
                "RETURNING id",
                (Jsonb(content), lesson_id, generation),
            )
            if await cur.fetchone():
                return
            cur = await conn.execute("SELECT 1 FROM study.lessons WHERE id=%s", (lesson_id,))
            if not await cur.fetchone():
                raise NotFound("Lesson does not exist")
        raise Conflict("A newer generation owns this lesson")

    async def fail_content(self, lesson_id: UUID, generation: UUID, code: str) -> bool:
        """Record a failure; a failed regeneration keeps the previous content readable."""
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "UPDATE study.lessons SET content_failure_code=%s, content_status=CASE WHEN "
                "content IS NULL THEN 'failed' ELSE 'ready' END WHERE id=%s AND "
                "content_generation=%s AND content_status='generating' RETURNING id",
                (code, lesson_id, generation),
            )
            return await cur.fetchone() is not None

    async def open_lesson(self, lesson_id: UUID) -> str:
        """available -> in_progress. Never unlocks; returns the resulting status."""
        async with self.pool.connection() as conn:
            await conn.execute(
                "UPDATE study.lesson_progress SET status='in_progress', "
                "opened_at=COALESCE(opened_at, now()) WHERE lesson_id=%s AND status='available'",
                (lesson_id,),
            )
            cur = await conn.execute(
                "SELECT status FROM study.lesson_progress WHERE lesson_id=%s", (lesson_id,)
            )
            row = await cur.fetchone()
        if not row:
            raise NotFound("Lesson does not exist")
        return row["status"]

    async def complete_lesson(self, lesson_id: UUID) -> UUID | None:
        """Mark complete and unlock exactly the next lesson; returns its id when newly unlocked."""
        async with self.pool.connection() as conn:
            return await _complete(conn, lesson_id)

    async def add_study_time(self, lesson_id: UUID, seconds: int, max_seconds: int = 60) -> int:
        """Bounded heartbeat: credits at most min(seconds, max, time since last beat)."""
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                # COALESCE before GREATEST: GREATEST ignores NULLs, so a first beat would credit 0.
                "UPDATE study.lesson_progress SET study_seconds = study_seconds + LEAST(%s, %s, "
                "GREATEST(0, COALESCE(EXTRACT(EPOCH FROM (now()-last_study_at)), %s))::int), "
                "last_study_at=now() WHERE lesson_id=%s AND status IN ('in_progress','completed') "
                "RETURNING study_seconds",
                (max(0, seconds), max_seconds, max_seconds, lesson_id),
            )
            row = await cur.fetchone()
        if not row:
            raise Conflict("Open the lesson before recording study time")
        return row["study_seconds"]

    # Quizzes -----------------------------------------------------------------

    async def create_quiz_attempt(self, lesson_id: UUID, questions: list[dict]):
        """Supersedes any open attempt so fresh question sets cannot be farmed."""
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "SELECT 1 FROM study.lessons WHERE id=%s FOR UPDATE", (lesson_id,)
            )
            if not await cur.fetchone():
                raise NotFound("Lesson does not exist")
            await conn.execute(
                "UPDATE study.quiz_attempts SET status='abandoned' "
                "WHERE lesson_id=%s AND status='open'",
                (lesson_id,),
            )
            cur = await conn.execute(
                "INSERT INTO study.quiz_attempts(id,lesson_id,attempt_number,questions) VALUES "
                "(%s,%s,(SELECT count(*)+1 FROM study.quiz_attempts WHERE lesson_id=%s),%s) "
                "RETURNING id, lesson_id, attempt_number, status, score, passed, created_at, "
                "submitted_at",
                (uuid4(), lesson_id, lesson_id, Jsonb(questions)),
            )
            return QuizAttemptSummary.model_validate(await cur.fetchone())

    async def quiz_attempt(self, attempt_id: UUID) -> dict:
        """Full server-side row, including the key. Never return it to a client as is."""
        async with self.pool.connection() as conn:
            cur = await conn.execute("SELECT * FROM study.quiz_attempts WHERE id=%s", (attempt_id,))
            row = await cur.fetchone()
        if not row:
            raise NotFound("Quiz attempt does not exist")
        return row

    async def submit_quiz_attempt(self, attempt_id: UUID, answers: dict, score: int, passed: bool):
        """Grade-and-gate atomically: a passing submission completes the lesson and unlocks
        exactly the next one in the same transaction. Returns (summary, lesson_status,
        unlocked_lesson_id). Only an open attempt may be submitted."""
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "UPDATE study.quiz_attempts SET answers=%s, score=%s, passed=%s, "
                "status='submitted', submitted_at=now() WHERE id=%s AND status='open' "
                "RETURNING id, lesson_id, attempt_number, status, score, passed, created_at, "
                "submitted_at",
                (Jsonb(answers), score, passed, attempt_id),
            )
            row = await cur.fetchone()
            if row:
                unlocked = await _complete(conn, row["lesson_id"]) if passed else None
                cur = await conn.execute(
                    "SELECT status FROM study.lesson_progress WHERE lesson_id=%s",
                    (row["lesson_id"],),
                )
                lesson_status = (await cur.fetchone())["status"]
                return QuizAttemptSummary.model_validate(row), lesson_status, unlocked
            cur = await conn.execute(
                "SELECT status FROM study.quiz_attempts WHERE id=%s", (attempt_id,)
            )
            existing = await cur.fetchone()
        if not existing:
            raise NotFound("Quiz attempt does not exist")
        raise Conflict(f"This attempt was already {existing['status']}. Start a new attempt.")

    async def prior_stems(self, lesson_id: UUID) -> list[str]:
        """Every stem this lesson has asked before, oldest first (retakes must differ)."""
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "SELECT q->>'stem' AS stem FROM study.quiz_attempts a, "
                "jsonb_array_elements(a.questions) q WHERE a.lesson_id=%s "
                "ORDER BY a.attempt_number",
                (lesson_id,),
            )
            return [row["stem"] for row in await cur.fetchall() if row["stem"]]

    async def quiz_attempts(self, lesson_id: UUID) -> list[QuizAttemptSummary]:
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "SELECT id, lesson_id, attempt_number, status, score, passed, created_at, "
                "submitted_at FROM study.quiz_attempts WHERE lesson_id=%s ORDER BY attempt_number",
                (lesson_id,),
            )
            return [QuizAttemptSummary.model_validate(row) for row in await cur.fetchall()]

    # Your turn and tutor -------------------------------------------------------

    async def record_your_turn(self, lesson_id, answer, verdict, feedback, revealed) -> int:
        """Stores the learner's attempt and returns how many attempts exist now."""
        async with self.pool.connection() as conn:
            await conn.execute(
                "INSERT INTO study.your_turn_attempts(id,lesson_id,answer,verdict,feedback,revealed) "
                "VALUES (%s,%s,%s,%s,%s,%s)",
                (uuid4(), lesson_id, answer, verdict, feedback, revealed),
            )
            cur = await conn.execute(
                "SELECT count(*)::int AS n FROM study.your_turn_attempts WHERE lesson_id=%s",
                (lesson_id,),
            )
            return (await cur.fetchone())["n"]

    async def your_turn_count(self, lesson_id: UUID) -> int:
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "SELECT count(*)::int AS n FROM study.your_turn_attempts WHERE lesson_id=%s",
                (lesson_id,),
            )
            return (await cur.fetchone())["n"]

    async def bind_conversation(self, lesson_id: UUID, conversation_id: UUID) -> None:
        async with self.pool.connection() as conn:
            await conn.execute(
                "INSERT INTO study.lesson_conversations(lesson_id,conversation_id) VALUES (%s,%s) "
                "ON CONFLICT DO NOTHING",
                (lesson_id, conversation_id),
            )

    async def lesson_conversation(self, lesson_id: UUID) -> UUID | None:
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "SELECT lc.conversation_id FROM study.lesson_conversations lc "
                "JOIN rag.conversations c ON c.id=lc.conversation_id "
                "WHERE lc.lesson_id=%s ORDER BY c.created_at DESC LIMIT 1",
                (lesson_id,),
            )
            row = await cur.fetchone()
        return row["conversation_id"] if row else None
