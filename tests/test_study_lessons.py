"""Lesson content jobs and routes with in-memory study storage and a scripted provider."""

import asyncio
import json
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import httpx
from fastapi.testclient import TestClient

from app.api import app, lesson_jobs, study_storage
from app.config import settings
from app.providers import ProviderError
from app.storage import Conflict, NotFound
from app.study.jobs import LessonJobs
from app.study.models import LessonView
from tests.test_study_lesson_writer import code_example, lesson, section
from tests.test_study_planner import ScriptedProvider

NOW = datetime(2026, 11, 15, tzinfo=timezone.utc)


class MemoryLessons:
    """Mirrors StudyStorage's generation-guarded content transitions."""

    def __init__(self, limit_hit=False):
        self.rows: dict = {}
        self.limit_hit = limit_hit

    def add(self, status="available", content_status="pending", content=None):
        lesson_id = uuid4()
        self.rows[lesson_id] = {
            "id": lesson_id, "course_id": uuid4(), "module_id": uuid4(), "document_id": uuid4(),
            "position": 1, "title": "Labels", "objective": "Know labels", "source_section_ids": ["1"],
            "estimated_minutes": 5, "content_status": content_status, "content": content,
            "content_failure_code": None, "content_generation": None, "regenerations_today": 0,
            "progress": {"status": status},
        }
        return lesson_id

    async def lesson(self, lesson_id):
        if lesson_id not in self.rows:
            raise NotFound("Lesson does not exist")
        return LessonView.model_validate(self.rows[lesson_id])

    async def lesson_evidence(self, lesson_id):
        row = self.rows[lesson_id]
        return {"title": row["title"], "objective": row["objective"]}, [section()]

    async def open_lesson(self, lesson_id):
        progress = self.rows[lesson_id]["progress"]
        if progress["status"] == "available":
            progress["status"] = "in_progress"
        return progress["status"]

    async def begin_content(self, lesson_id, generation):
        row = self.rows[lesson_id]
        if row["content_status"] != "pending":
            return False
        row.update(content_status="generating", content_generation=generation)
        return True

    async def begin_regeneration(self, lesson_id, generation, limit):
        row = self.rows[lesson_id]
        if row["content_status"] in ("pending", "generating"):
            return "busy"
        if self.limit_hit or row["regenerations_today"] >= limit:
            return "limit"
        row.update(content_status="generating", content_generation=generation,
                   content_failure_code=None, regenerations_today=row["regenerations_today"] + 1)
        return "started"

    async def write_content(self, lesson_id, generation, content):
        row = self.rows[lesson_id]
        if row["content_generation"] != generation or row["content_status"] != "generating":
            raise Conflict("A newer generation owns this lesson")
        row.update(content=content, content_status="ready", content_failure_code=None)

    async def fail_content(self, lesson_id, generation, code):
        row = self.rows[lesson_id]
        if row["content_generation"] != generation or row["content_status"] != "generating":
            return False
        row.update(content_failure_code=code,
                   content_status="ready" if row["content"] else "failed")
        return True


def config(**overrides):
    base = dict(lesson_generation_call_limit=2, lesson_generation_timeout_seconds=5,
                lesson_evidence_chars=12000)
    return SimpleNamespace(**{**base, **overrides})


def valid():
    return json.dumps(lesson())


async def finished(jobs, lesson_id):
    await asyncio.wait_for(jobs.tasks[lesson_id], 5)


async def test_job_writes_content_and_emits_v1_events():
    study = MemoryLessons()
    lesson_id = study.add()
    jobs = LessonJobs(study, ScriptedProvider([valid()]), config())
    generation = uuid4()
    assert await study.begin_content(lesson_id, generation)
    assert jobs.start(lesson_id, generation) and not jobs.start(lesson_id, generation)
    seen = [item async for item in jobs.subscribe(lesson_id)]
    await finished(jobs, lesson_id)
    assert [e["step"] for e in seen] == ["evidence", "evidence", "write", "write", "validate", "validate"]
    assert all(e["type"] == "progress" and e["version"] == 1 for e in seen)
    assert "SECRET" not in json.dumps(seen)
    row = study.rows[lesson_id]
    assert row["content_status"] == "ready" and row["content"]["your_turn"]["reference_answer"]


async def test_job_failures_are_recorded_and_retryable():
    study = MemoryLessons()
    lesson_id = study.add()
    bad = json.dumps(lesson(real_world_example="Exhibits [9]."))
    jobs = LessonJobs(study, ScriptedProvider([bad, bad]), config())
    generation = uuid4()
    await study.begin_content(lesson_id, generation)
    jobs.start(lesson_id, generation)
    await finished(jobs, lesson_id)
    row = study.rows[lesson_id]
    assert (row["content_status"], row["content_failure_code"]) == ("failed", "ungrounded")
    assert jobs.snapshot(lesson_id)[-1] == {**jobs.snapshot(lesson_id)[-1], "status": "failed",
                                            "outcome": "ungrounded"}
    # Provider failure during a regeneration keeps the previous content readable.
    row.update(content_status="ready", content={"previous": True})
    jobs.providers = ScriptedProvider([ProviderError("down")])
    regeneration = uuid4()
    assert await study.begin_regeneration(lesson_id, regeneration, 5) == "started"
    jobs.start(lesson_id, regeneration)
    await finished(jobs, lesson_id)
    assert row["content_status"] == "ready" and row["content"] == {"previous": True}
    assert row["content_failure_code"] == "provider"


async def test_stale_generation_cannot_overwrite_and_budget_bounds_calls():
    study = MemoryLessons()
    lesson_id = study.add()
    provider = ScriptedProvider([json.dumps(lesson(explanation="Short [1].")), valid()])
    jobs = LessonJobs(study, provider, config(lesson_generation_call_limit=1))
    generation = uuid4()
    await study.begin_content(lesson_id, generation)
    jobs.start(lesson_id, generation)
    await finished(jobs, lesson_id)
    assert len(provider.calls) == 1 and study.rows[lesson_id]["content_failure_code"] == "budget"
    # A job whose generation was superseded leaves the newer state alone.
    study.rows[lesson_id].update(content_status="generating", content_generation=uuid4())
    jobs.providers = ScriptedProvider([valid()])
    jobs.start(lesson_id, generation)
    await finished(jobs, lesson_id)
    assert study.rows[lesson_id]["content_status"] == "generating"


async def test_prefetch_runs_one_background_generation_at_a_time():
    study = MemoryLessons()
    first, second = study.add(status="available"), study.add(status="available")
    started = asyncio.Event()
    release = asyncio.Event()

    class Slow(ScriptedProvider):
        async def chat(self, *args, **kwargs):
            started.set()
            await release.wait()
            return await super().chat(*args, **kwargs)

    jobs = LessonJobs(study, Slow([valid(), valid()]), config())
    assert await jobs.prefetch(first)
    await started.wait()
    assert not await jobs.prefetch(second)  # One prefetch at a time.
    assert study.rows[second]["content_status"] == "pending"
    release.set()
    await finished(jobs, first)
    assert study.rows[first]["content_status"] == "ready"
    assert not await jobs.prefetch(first)  # Already ready: nothing to do.
    assert await jobs.prefetch(second)
    await finished(jobs, second)


# Routes ---------------------------------------------------------------------


class FakeJobs:
    def __init__(self):
        self.started = []

    def running(self, lesson_id):
        return any(key == lesson_id for key, _ in self.started)

    def start(self, lesson_id, generation):
        if self.running(lesson_id):
            return False
        self.started.append((lesson_id, generation))
        return True

    def snapshot(self, lesson_id):
        return [{"type": "progress", "version": 1, "step": "evidence", "id": "evidence",
                 "status": "started", "attempt": 0, "sequence": 1}] if self.running(lesson_id) else []

    async def subscribe(self, lesson_id):
        for item in self.snapshot(lesson_id):
            yield item


def client_with(study, jobs):
    app.dependency_overrides[study_storage] = lambda: study
    app.dependency_overrides[lesson_jobs] = lambda: jobs
    return TestClient(app)


def stored_content():
    gap = {"kind": "code_gap", "prompt": "Fill in the TODO(you) line.", "reference_answer": "SECRET-ANSWER"}
    from app.study.lesson_writer import build_evidence, review

    draft = review(json.dumps(lesson(code_example=code_example(), your_turn=gap)),
                   build_evidence([section()], 12000)[1], True, False)
    return draft.content.model_dump(mode="json")


def test_open_starts_one_generation_and_never_unlocks(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "")
    settings.cache_clear()
    study, jobs = MemoryLessons(), FakeJobs()
    lesson_id = study.add()
    locked = study.add(status="locked")
    try:
        with client_with(study, jobs) as client:
            first = client.get(f"/lessons/{lesson_id}")
            assert first.status_code == 202 and first.json()["content_status"] == "generating"
            assert first.json()["progress"]["status"] == "in_progress"
            assert first.json()["generation_progress"][0]["step"] == "evidence"
            again = client.get(f"/lessons/{lesson_id}")
            assert again.status_code == 202 and len(jobs.started) == 1
            closed = client.get(f"/lessons/{locked}")
            assert closed.status_code == 200 and closed.json()["progress"]["status"] == "locked"
            assert closed.json()["content"] is None and len(jobs.started) == 1
            assert client.post(f"/lessons/{locked}/regenerate").status_code == 409
            assert client.get(f"/lessons/{uuid4()}").status_code == 404
            assert client.get("/lessons/nope").status_code == 422
            with client.stream("GET", f"/lessons/{lesson_id}/events") as events:
                body = "".join(events.iter_text())
            assert "event: progress" in body and '"content_status": "generating"' in body
    finally:
        app.dependency_overrides.clear()
        settings.cache_clear()


async def test_concurrent_opens_start_exactly_one_generation(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "")
    settings.cache_clear()
    study = MemoryLessons()
    lesson_id = study.add()
    provider = ScriptedProvider([valid()])
    jobs = LessonJobs(study, provider, config())
    app.dependency_overrides[study_storage] = lambda: study
    app.dependency_overrides[lesson_jobs] = lambda: jobs
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            responses = await asyncio.gather(
                *(client.get(f"/lessons/{lesson_id}") for _ in range(5))
            )
            assert all(r.status_code in (200, 202) for r in responses)
            await finished(jobs, lesson_id)
            assert len(provider.calls) == 1
            ready = await client.get(f"/lessons/{lesson_id}")
            assert ready.status_code == 200 and ready.json()["content_status"] == "ready"
            assert "SECRET" not in ready.text
    finally:
        app.dependency_overrides.clear()
        settings.cache_clear()


def test_server_only_fields_are_never_serialized(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "")
    settings.cache_clear()
    study, jobs = MemoryLessons(), FakeJobs()
    lesson_id = study.add(status="in_progress", content_status="ready", content=stored_content())
    try:
        with client_with(study, jobs) as client:
            response = client.get(f"/lessons/{lesson_id}")
            assert response.status_code == 200 and not jobs.started
            body = response.json()
            text = response.text
            for secret in ("SECRET", "reference_answer", "reference_solution", "content_generation"):
                assert secret not in text
            assert body["content"]["code_example"]["todo"]["marker"] == "TODO(you)"
            assert body["content"]["your_turn"]["kind"] == "code_gap"
            assert body["content"]["citations"][0]["citation"] == 1
            assert body["regenerations_left"] == settings().lesson_regeneration_daily_limit
            regenerated = client.post(f"/lessons/{lesson_id}/regenerate")
            assert regenerated.status_code == 202 and "SECRET" not in regenerated.text
            # Previous content stays readable while the new version is written.
            assert regenerated.json()["content"] is not None
            assert regenerated.json()["regenerations_left"] == settings().lesson_regeneration_daily_limit - 1
    finally:
        app.dependency_overrides.clear()
        settings.cache_clear()


def test_regeneration_states_and_daily_limit(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "")
    settings.cache_clear()
    study, jobs = MemoryLessons(), FakeJobs()
    pending = study.add()
    failed = study.add(content_status="failed")
    try:
        with client_with(study, jobs) as client:
            assert client.post(f"/lessons/{pending}/regenerate").status_code == 409
            assert client.post(f"/lessons/{failed}/regenerate").status_code == 202
            assert client.post(f"/lessons/{failed}/regenerate").status_code == 409  # Busy now.
            study.rows[failed]["content_status"] = "failed"
            study.limit_hit = True
            limited = client.post(f"/lessons/{failed}/regenerate")
            assert limited.status_code == 429 and "limit" in limited.json()["detail"]
            assert client.post(f"/lessons/{uuid4()}/regenerate").status_code == 404
    finally:
        app.dependency_overrides.clear()
        settings.cache_clear()


def test_lesson_routes_require_database(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "")
    settings.cache_clear()
    try:
        with TestClient(app) as client:
            assert client.get(f"/lessons/{uuid4()}").status_code == 503
            assert client.post(f"/lessons/{uuid4()}/regenerate").status_code == 503
    finally:
        settings.cache_clear()
