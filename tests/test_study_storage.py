"""Study schema lifecycle on TEST_DATABASE_URL only, with generated IDs and cleanup."""

import asyncio
import os
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import psycopg
import pytest

from app.config import Settings
from app.deletions import delete_document, state
from app.models import Document
from app.storage import Conflict, NotFound, Storage
from app.study.models import LessonPlan
from app.study.storage import StudyStorage
from scripts.ingest import ingest
from scripts.migrate import migration_files

pytestmark = pytest.mark.skipif(
    not os.getenv("TEST_DATABASE_URL"), reason="Dedicated test database required"
)


def plan():
    return LessonPlan(modules=[
        {"title": "Basics", "summary": "Start here", "lessons": [
            {"title": "Labels", "objective": "Know label rules", "source_section_ids": ["1"],
             "estimated_minutes": 5},
            {"title": "Colors", "source_section_ids": ["1"], "estimated_minutes": 4},
        ]},
        {"title": "Practice", "lessons": [
            {"title": "Review", "source_section_ids": ["1"], "estimated_minutes": 6},
        ]},
    ])


async def apply_migrations(dsn):
    async with await psycopg.AsyncConnection.connect(dsn, prepare_threshold=None) as conn:
        for path in migration_files():
            await conn.execute(path.read_text())


async def test_study_lifecycle_gating_and_deletion():
    dsn = os.environ["TEST_DATABASE_URL"]
    config = Settings(_env_file=None, database_url=dsn)
    assert [p.name for p in migration_files()] == ["001_initial.sql", "002_study.sql"]
    await apply_migrations(dsn)
    await apply_migrations(dsn)  # Idempotent re-run.
    provider = SimpleNamespace(embed=AsyncMock(return_value=[1.0] + [0.0] * 767))
    long_text = " ".join(f"token{i}" for i in range(900))  # Spans several overlapping chunks.
    doc = Document(id=uuid4(), title="Study fixture", edition="test",
                   sections=[{"id": "1", "number": "1", "text": "Synthetic evidence"},
                             {"id": "2", "number": "2", "title": "Long", "text": long_text}])
    other = doc.model_copy(update={"id": uuid4(), "title": "Other fixture"})
    store = Storage(dsn)
    await store.pool.open()
    study = StudyStorage(store.pool)
    thread = None
    try:
        await ingest(doc, config, provider)
        await ingest(other, config, provider)
        # Outline rebuilds each section's full text from its overlapping chunks.
        outline = await study.document_outline(doc.id)
        assert [o["id"] for o in outline] == ["1", "2"]
        assert outline[0]["text"] == "Synthetic evidence" and outline[1]["text"] == long_text
        assert outline[0]["document_title"] == "Study fixture"
        with pytest.raises(NotFound):
            await study.document_outline(uuid4())
        with pytest.raises(NotFound):
            await study.create_course(uuid4(), uuid4())
        # Concurrent creation yields one course.
        results = await asyncio.gather(
            study.create_course(doc.id, uuid4()), study.create_course(doc.id, uuid4())
        )
        assert sum(created for _, created in results) == 1
        course = results[0][0]
        assert course.status == "generating" and course.lesson_count == 0
        generation = (await study.course(course.id)).generation
        with pytest.raises(Conflict):
            await study.write_plan(course.id, uuid4(), plan())
        view = await study.write_plan(course.id, generation, plan())
        assert view.status == "ready" and view.estimated_minutes == 15
        assert [m.title for m in view.modules] == ["Basics", "Practice"]
        lessons = [lesson for module in view.modules for lesson in module.lessons]
        assert [lesson.position for lesson in lessons] == [1, 2, 3]
        assert [lesson.status for lesson in lessons] == ["locked"] * 0 + ["available", "locked", "locked"]
        first, second, third = (lesson.id for lesson in lessons)
        assert view.next_lesson_id == first
        assert (await study.courses())[0].id == course.id
        # Opening never unlocks; completing unlocks exactly the next lesson.
        assert await study.open_lesson(second) == "locked"
        with pytest.raises(Conflict):
            await study.complete_lesson(second)
        assert await study.open_lesson(first) == "in_progress"
        with pytest.raises(Conflict):
            await study.add_study_time(second, 30)
        assert await study.add_study_time(first, 500) == 60
        assert await study.add_study_time(first, 30) <= 61  # Clamped to elapsed time.
        assert await study.complete_lesson(first) == second
        assert (await study.course(course.id)).next_lesson_id == second
        assert await study.complete_lesson(first) is None  # Idempotent, no re-unlock.
        assert (await study.lesson(third)).progress.status == "locked"
        detail = await study.lesson(first)
        assert detail.document_id == doc.id and detail.progress.status == "completed"
        # Quiz attempts: superseding, grading guard, history without questions.
        questions = [{"id": "q1", "correct_option_id": "a"}]
        a1 = await study.create_quiz_attempt(second, questions)
        a2 = await study.create_quiz_attempt(second, questions)
        assert (a1.attempt_number, a2.attempt_number) == (1, 2)
        with pytest.raises(Conflict, match="abandoned"):
            await study.submit_quiz_attempt(a1.id, {"q1": "a"}, 3, True)
        submitted = await study.submit_quiz_attempt(a2.id, {"q1": "a"}, 2, True)
        assert submitted.status == "submitted" and submitted.passed is True
        with pytest.raises(Conflict, match="submitted"):
            await study.submit_quiz_attempt(a2.id, {"q1": "a"}, 2, True)
        with pytest.raises(NotFound):
            await study.submit_quiz_attempt(uuid4(), {}, 0, False)
        history = await study.quiz_attempts(second)
        assert [h.status for h in history] == ["abandoned", "submitted"]
        assert not any(hasattr(h, "questions") for h in history)
        assert (await study.quiz_attempt(a2.id))["questions"] == questions
        # Your turn and tutor binding.
        assert await study.record_your_turn(second, "my answer", "partial", "Re-read 1", False) == 1
        assert await study.your_turn_count(second) == 1
        thread, version, _ = await store.conversation(None, [doc.id], config.embedding_signature, 4)
        await store.save_turn(thread, version, "q", "a", [])
        await study.bind_conversation(second, thread)
        assert await study.lesson_conversation(second) == thread
        await study.set_content_status(third, "generating")
        await study.set_content(third, {"objective": "x"})
        assert (await study.lesson(third)).content_status == "ready"
        # Status transitions are generation-guarded.
        assert not await study.begin_generation(course.id, uuid4())  # Ready: untouched.
        assert not await study.fail_course(course.id, uuid4(), "provider")
        async with await psycopg.AsyncConnection.connect(dsn) as conn:
            with pytest.raises(psycopg.errors.CheckViolation):
                await conn.execute(
                    "UPDATE study.courses SET status='done' WHERE id=%s", (course.id,)
                )
        # Deleting the course keeps the document and removes bound tutor chats.
        assert (await study.delete_course(course.id))["status"] == "deleted"
        assert doc.id in {d["id"] for d in await store.documents()}
        with pytest.raises(NotFound):
            await study.course(course.id)
        with pytest.raises(NotFound):
            await store.history(thread, 2**63 - 1, 20)
        tombstones = {(d["kind"], d["id"]) for d in await state(store)}
        assert ("course", course.id) in tombstones and ("conversation", thread) in tombstones
        # Deleting a document cascades its course and leaves a course tombstone.
        again, created = await study.create_course(doc.id, uuid4())
        assert created and again.id != course.id
        unrelated, _ = await study.create_course(other.id, uuid4())
        assert (await delete_document(store, config, doc.id))["status"] == "deleted"
        with pytest.raises(NotFound):
            await study.course(again.id)
        assert (await study.course(unrelated.id)).id == unrelated.id
        assert ("course", again.id) in {(d["kind"], d["id"]) for d in await state(store)}
        # Interrupted generation is reported truthfully after a restart.
        assert await study.mark_interrupted() >= 1
        assert (await study.course(unrelated.id)).failure_code == "interrupted"
        assert await study.begin_generation(unrelated.id, uuid4())
    finally:
        async with await psycopg.AsyncConnection.connect(dsn) as conn:
            for d in (doc, other):
                await conn.execute("DELETE FROM rag.documents WHERE id=%s", (d.id,))
                await conn.execute(
                    "DELETE FROM rag.deletions WHERE id IN (SELECT id FROM study.courses "
                    "WHERE document_id=%s) OR id=%s", (d.id, d.id),
                )
            if thread:
                await conn.execute("DELETE FROM rag.conversations WHERE id=%s", (thread,))
                await conn.execute("DELETE FROM rag.deletions WHERE id=%s", (thread,))
        await store.pool.close()
