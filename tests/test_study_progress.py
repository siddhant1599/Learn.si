"""Progress, mastery and study-time: pure functions and routes; no database."""

import json
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.api import app, study_storage
from app.config import settings
from app.storage import Conflict
from app.study.progress import (
    LEVELS,
    course_progress,
    lesson_mastery,
    module_mastery,
    overview,
    quiz_performance,
    summary,
)
from tests.test_study_lessons import MemoryLessons

T0 = datetime(2026, 11, 15, 9, tzinfo=timezone.utc)


def attempt(lesson_id, number, score, at=None, questions=None, answers=None):
    return {"id": uuid4(), "lesson_id": lesson_id, "attempt_number": number, "score": score,
            "passed": score >= 2, "submitted_at": at or T0 + timedelta(minutes=number),
            "questions": questions or [], "answers": answers or {}}


def row(position, status="locked", module=1, opened=False, minutes=5, completed=None):
    return {"id": f"l{position}", "module_id": f"m{module}", "module_title": f"Module {module}",
            "module_position": module, "position": position, "title": f"Lesson {position}",
            "estimated_minutes": minutes, "status": status,
            "opened_at": T0 if opened or status in ("in_progress", "completed") else None,
            "completed_at": completed or (T0 + timedelta(hours=position) if status == "completed" else None),
            "study_seconds": 60 * position, "last_study_at": None}


def test_mastery_matrix_reaches_every_level():
    lesson = row(1, "completed")
    assert lesson_mastery(row(1, "available"), [], []) == "not_started"
    assert lesson_mastery(row(1, "in_progress"), [], []) == "learning"
    assert lesson_mastery(row(1, "in_progress"), [attempt("l1", 1, 1), attempt("l1", 2, 0)], []) == "learning"
    assert lesson_mastery(lesson, [attempt("l1", 1, 1), attempt("l1", 2, 3)], ["correct"]) == "developing"
    assert lesson_mastery(lesson, [attempt("l1", 1, 2)], ["correct"]) == "proficient"
    assert lesson_mastery(lesson, [attempt("l1", 1, 3)], ["incorrect", "partial", "correct"]) == "proficient"
    assert lesson_mastery(lesson, [attempt("l1", 1, 3)], ["correct"]) == "mastered"
    assert lesson_mastery(lesson, [attempt("l1", 1, 3)], ["partial", "correct"]) == "mastered"
    # Order of stored attempts does not matter; the first submitted attempt does.
    assert lesson_mastery(lesson, [attempt("l1", 2, 3), attempt("l1", 1, 0)], []) == "developing"


def test_module_floor_rule():
    lessons = [row(1, "completed"), row(2, "completed")]
    levels = {"l1": "mastered", "l2": "developing"}
    assert module_mastery(lessons, levels) == "developing"  # Floor once all are completed.
    partial = [row(1, "completed"), row(2, "in_progress")]
    assert module_mastery(partial, {"l1": "mastered", "l2": "learning"}) == "developing"
    opened = [row(1, "in_progress"), row(2)]
    assert module_mastery(opened, {"l1": "learning", "l2": "not_started"}) == "learning"
    assert module_mastery([row(1, "available"), row(2)], {"l1": "not_started", "l2": "not_started"}) == "not_started"
    assert list(LEVELS) == ["not_started", "learning", "developing", "proficient", "mastered"]


def test_ten_lessons_four_completed_is_forty_percent_and_next_is_five():
    lessons = [row(i, "completed" if i <= 4 else "available" if i == 5 else "locked",
                   module=1 if i <= 5 else 2, minutes=6) for i in range(1, 11)]
    attempts = [attempt(f"l{i}", 1, 3) for i in range(1, 5)]
    progress = course_progress({"id": "c1", "title": "Guide"}, lessons, attempts,
                               {"l1": ["correct"]})
    assert progress["percent"] == 40 and progress["next_lesson_id"] == "l5"
    assert (progress["completed_lessons"], progress["lesson_count"]) == (4, 10)
    assert progress["estimated_minutes_remaining"] == 36
    assert progress["study_seconds"] == 60 * sum(range(1, 11))
    assert progress["mastery_distribution"] == {"not_started": 6, "learning": 0, "developing": 0,
                                                "proficient": 3, "mastered": 1}
    first, second = progress["modules"]
    assert (first["percent"], first["mastery"], second["mastery"]) == (80, "developing", "not_started")
    lesson_row = progress["lessons"][0]
    assert lesson_row["first_try_pass"] and lesson_row["best_score"] == 3 and lesson_row["mastery"] == "mastered"
    assert progress["last_activity"] == T0 + timedelta(hours=4)
    compact = summary(progress)
    assert compact["percent"] == 40 and "lessons" not in compact and "modules" not in compact


def test_quiz_performance_and_bloom_breakdown_without_keys():
    questions = [{"id": "q1", "bloom_level": "recall", "correct_option_id": "a"},
                 {"id": "q2", "bloom_level": "apply", "correct_option_id": "b"},
                 {"id": "q3", "bloom_level": "analyze", "correct_option_id": "c"}]
    attempts = [attempt("l1", 1, 1, questions=questions, answers={"q1": "a", "q2": "x", "q3": "x"}),
                attempt("l1", 2, 3, questions=questions, answers={"q1": "a", "q2": "b", "q3": "c"}),
                attempt("l2", 1, 2, questions=questions, answers={"q1": "a", "q2": "b", "q3": "x"})]
    perf = quiz_performance(attempts)
    assert perf["attempts"] == 3 and perf["passed"] == 2 and perf["pass_rate"] == 0.667
    assert perf["first_try_pass_rate"] == 0.5 and perf["average_score"] == 2.0
    assert perf["bloom"] == {"recall": {"questions": 3, "correct": 3},
                             "apply": {"questions": 3, "correct": 2},
                             "analyze": {"questions": 3, "correct": 1}}
    assert "correct_option_id" not in json.dumps(perf)
    assert quiz_performance([])["pass_rate"] is None


def test_overview_orders_by_activity_and_bounds_recent():
    older = course_progress({"id": "a", "title": "Old"}, [row(1, "completed", completed=T0)],
                            [attempt("l1", 1, 3, at=T0)], {})
    newer = course_progress({"id": "b", "title": "New"},
                            [row(i, "completed", completed=T0 + timedelta(days=1, minutes=i)) for i in range(1, 15)],
                            [attempt(f"l{i}", 1, 2, at=T0 + timedelta(days=1, minutes=i)) for i in range(1, 15)], {})
    result = overview([(older, [attempt("l1", 1, 3, at=T0)]),
                       (newer, [attempt(f"l{i}", 1, 2, at=T0 + timedelta(days=1, minutes=i)) for i in range(1, 15)])])
    assert [c["course_id"] for c in result["courses"]] == ["b", "a"]
    assert result["totals"] == {"courses": 2, "lessons_completed": 15, "lessons_total": 15,
                                "study_seconds": 60 + 60 * sum(range(1, 15)),
                                "quiz_attempts": 15, "quizzes_passed": 15}
    assert len(result["recent"]) == 20
    stamps = [item["at"] for item in result["recent"]]
    assert stamps == sorted(stamps, reverse=True)
    assert set(result["recent"][0]) <= {"kind", "course_id", "lesson_id", "title", "score", "passed", "at"}
    # Deleting a course removes its contribution.
    assert overview([(older, [])])["totals"]["lessons_completed"] == 1


# Routes ----------------------------------------------------------------------


class ProgressStudy(MemoryLessons):
    def __init__(self):
        super().__init__()
        self.entries: list = []
        self.beats: list = []
        self.last = None
        self.clock = T0

    async def courses(self):
        return []

    async def progress_data(self, course_ids=None):
        return [e for e in self.entries if course_ids is None or e["course"]["id"] in course_ids]

    async def add_study_time(self, lesson_id, seconds, max_seconds=60):
        """Mirrors the SQL clamp: min(seconds, max, elapsed since the last beat)."""
        row = self.rows[lesson_id]
        if row["progress"]["status"] not in ("in_progress", "completed"):
            raise Conflict("Open the lesson before recording study time")
        elapsed = max_seconds if self.last is None else int((self.clock - self.last).total_seconds())
        row.setdefault("study_seconds", 0)
        row["study_seconds"] += min(seconds, max_seconds, max(0, elapsed))
        self.last = self.clock
        return row["study_seconds"]


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "")
    settings.cache_clear()
    study = ProgressStudy()
    app.dependency_overrides[study_storage] = lambda: study
    with TestClient(app) as test_client:
        yield test_client, study
    app.dependency_overrides.clear()
    settings.cache_clear()


def test_heartbeats_cannot_inflate_study_time(client):
    test_client, study = client
    lesson_id = study.add(status="in_progress")
    total = 0
    # A 60 s heartbeat every 5 s for one minute credits at most the elapsed time.
    for beat in range(13):
        study.clock = T0 + timedelta(seconds=5 * beat)
        response = test_client.post(f"/lessons/{lesson_id}/study-time", json={"seconds": 60})
        assert response.status_code == 200
        total = response.json()["study_seconds"]
    assert total <= 60 + 60  # First beat (no previous) plus 60 s of elapsed time.
    for bad in (0, 61, -5):
        assert test_client.post(f"/lessons/{lesson_id}/study-time", json={"seconds": bad}).status_code == 422
    locked = study.add(status="locked")
    assert test_client.post(f"/lessons/{locked}/study-time", json={"seconds": 30}).status_code == 409
    assert test_client.post(f"/lessons/{uuid4()}/study-time", json={"seconds": 30}).status_code == 404


def test_progress_routes_return_ids_titles_counts_only(client):
    test_client, study = client
    course_id = uuid4()
    questions = [{"id": "q1", "stem": "SECRET STEM", "bloom_level": "recall", "correct_option_id": "a",
                  "explanations": {"b": "SECRET EXPLANATION"}}]
    study.entries = [{
        "course": {"id": course_id, "title": "Guide"},
        "lessons": [row(1, "completed"), row(2, "available")],
        "attempts": [attempt("l1", 1, 3, questions=questions, answers={"q1": "a"})],
        "your_turn": {"l1": ["correct"]},
    }]
    detail = test_client.get(f"/courses/{course_id}/progress")
    assert detail.status_code == 200
    body = detail.json()
    assert body["percent"] == 50 and body["next_lesson_id"] == "l2"
    assert body["lessons"][0]["mastery"] == "mastered"
    assert "SECRET" not in detail.text and "correct_option_id" not in detail.text
    assert test_client.get(f"/courses/{uuid4()}/progress").status_code == 404
    everything = test_client.get("/progress")
    assert everything.status_code == 200 and everything.json()["totals"]["lessons_completed"] == 1
    assert "SECRET" not in everything.text
    assert test_client.get("/courses").json() == []
