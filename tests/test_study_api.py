"""Course routes with stand-in study storage and jobs; no database or provider."""

from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from app.api import app, course_jobs, study_storage
from app.config import settings
from app.storage import NotFound
from app.study.models import CourseSummary, CourseView

NOW = datetime(2026, 11, 15, tzinfo=timezone.utc)


def summary(course_id, document_id, status="generating", **extra):
    return CourseSummary(
        id=course_id, document_id=document_id, title="Guide", status=status, estimated_minutes=0,
        module_count=0, lesson_count=0, completed_lessons=0, created_at=NOW, updated_at=NOW, **extra,
    )


class FakeStudy:
    def __init__(self):
        self.rows: dict = {}
        self.deleted = []
        self.fail = False
        self.restarted = []

    async def create_course(self, document_id, generation):
        existing = next((c for c in self.rows.values() if c.document_id == document_id), None)
        if existing:
            return existing, False
        if document_id.int % 2:
            raise NotFound("Document does not exist")
        course = summary(uuid4(), document_id)
        self.rows[course.id] = course
        self.generations = {course.id: generation}
        return course, True

    async def begin_generation(self, course_id, generation):
        self.restarted.append((course_id, generation))
        self.rows[course_id] = self.rows[course_id].model_copy(update={"status": "generating", "failure_code": None})
        self.generations[course_id] = generation
        return True

    async def course(self, course_id):
        if course_id not in self.rows:
            raise NotFound("Course does not exist")
        base = self.rows[course_id]
        return CourseView(**base.model_dump(), generation=self.generations.get(course_id), modules=[])

    async def courses(self):
        return list(self.rows.values())

    async def delete_course(self, course_id):
        if self.fail:
            raise RuntimeError("private database detail")
        self.deleted.append(course_id)
        return {"status": "deleted", "id": str(course_id)}


class FakeJobs:
    def __init__(self):
        self.started = []
        self.events = {}

    def running(self, course_id):
        return any(c == course_id for c, *_ in self.started)

    def start(self, course_id, document_id, generation):
        self.started.append((course_id, document_id, generation))
        self.events[course_id] = [{"type": "progress", "version": 1, "step": "outline", "id": "outline", "status": "started", "attempt": 0, "sequence": 1}]
        return True

    def snapshot(self, course_id):
        return list(self.events.get(course_id, []))

    async def subscribe(self, course_id):
        for item in self.snapshot(course_id):
            yield item


def client_with(study, jobs):
    app.dependency_overrides[study_storage] = lambda: study
    app.dependency_overrides[course_jobs] = lambda: jobs
    return TestClient(app)


def test_course_creation_listing_detail_events_and_restart(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "")
    settings.cache_clear()
    study, jobs = FakeStudy(), FakeJobs()
    even = uuid4()
    even = even if even.int % 2 == 0 else uuid4().__class__(int=even.int - 1)
    try:
        with client_with(study, jobs) as client:
            created = client.post("/courses", json={"document_id": str(even)})
            assert created.status_code == 202 and created.json()["status"] == "generating"
            course_id = created.json()["id"]
            key = UUID(course_id)
            assert len(jobs.started) == 1
            # Idempotent: the same document returns the same course and starts nothing new.
            again = client.post("/courses", json={"document_id": str(even)})
            assert again.status_code == 202 and again.json()["id"] == course_id and len(jobs.started) == 1
            assert client.post("/courses", json={"document_id": str(uuid4().__class__(int=even.int + 1))}).status_code == 404
            assert client.post("/courses", json={"document_id": "nope"}).status_code == 422
            listing = client.get("/courses")
            assert listing.status_code == 200 and listing.json()[0]["id"] == course_id
            detail = client.get(f"/courses/{course_id}")
            assert detail.status_code == 200 and detail.json()["progress"][0]["step"] == "outline"
            assert client.get(f"/courses/{uuid4()}").status_code == 404
            with client.stream("GET", f"/courses/{course_id}/events") as events:
                body = "".join(events.iter_text())
            assert "event: progress" in body and '"step": "outline"' in body
            assert "event: status" in body and '"status": "generating"' in body
            # A failed course restarts with a fresh generation.
            study.rows[key] = study.rows[key].model_copy(update={"status": "failed", "failure_code": "provider"})
            jobs.started.clear()
            restarted = client.post("/courses", json={"document_id": str(even)})
            assert restarted.status_code == 202 and study.restarted and len(jobs.started) == 1
            # A ready course answers 200 without starting anything.
            study.rows[key] = study.rows[key].model_copy(update={"status": "ready"})
            jobs.started.clear()
            ready = client.post("/courses", json={"document_id": str(even)})
            assert ready.status_code == 200 and not jobs.started
    finally:
        app.dependency_overrides.clear()
        settings.cache_clear()


def test_course_deletion_route(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "")
    settings.cache_clear()
    study, jobs = FakeStudy(), FakeJobs()
    try:
        with client_with(study, jobs) as client:
            course_id = uuid4()
            response = client.delete(f"/courses/{course_id}")
            assert response.status_code == 200
            assert response.json() == {"status": "deleted", "id": str(course_id)}
            assert study.deleted == [course_id]
            assert client.delete("/courses/not-a-uuid").status_code == 422
            study.fail = True
            failed = client.delete(f"/courses/{uuid4()}")
            assert failed.status_code == 503
            assert "private" not in failed.text
    finally:
        app.dependency_overrides.clear()
        settings.cache_clear()


def test_course_routes_require_database(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "")
    settings.cache_clear()
    try:
        with TestClient(app) as client:
            assert client.delete(f"/courses/{uuid4()}").status_code == 503
            assert client.get("/courses").status_code == 503
            assert client.post("/courses", json={"document_id": str(uuid4())}).status_code == 503
    finally:
        settings.cache_clear()
