"""Course deletion route with a stand-in study store; no database required."""

from uuid import uuid4

from fastapi.testclient import TestClient

from app.api import app, study_storage
from app.config import settings


class FakeStudy:
    def __init__(self, fail=False):
        self.fail = fail
        self.deleted = []

    async def delete_course(self, course_id):
        if self.fail:
            raise RuntimeError("private database detail")
        self.deleted.append(course_id)
        return {"status": "deleted", "id": str(course_id)}


def test_course_deletion_route(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "")
    settings.cache_clear()
    study = FakeStudy()
    app.dependency_overrides[study_storage] = lambda: study
    try:
        with TestClient(app) as client:
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


def test_course_deletion_requires_database(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "")
    settings.cache_clear()
    try:
        with TestClient(app) as client:
            assert client.delete(f"/courses/{uuid4()}").status_code == 503
    finally:
        settings.cache_clear()
