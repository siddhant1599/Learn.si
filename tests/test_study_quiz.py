"""Quiz generation, grading and gating routes with a scripted provider; no database."""

import json
from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from app.api import app, lesson_jobs, study_storage
from app.config import settings
from app.providers import ProviderError
from app.storage import Conflict, NotFound
from app.study.lesson_writer import build_evidence
from app.study.models import QuizAttemptSummary
from app.study.quiz import (
    QuizFailed,
    QuizWriter,
    answer_problem,
    check_question,
    emphasis,
    grade,
    similar,
)
from tests.test_study_lesson_writer import section
from tests.test_study_lessons import MemoryLessons, stored_content
from tests.test_study_planner import ScriptedProvider

NOW = datetime(2026, 11, 15, tzinfo=timezone.utc)
TOPICS = ["labels", "colors", "spacing", "contrast", "icons", "headings", "margins", "borders",
          "fonts", "grids", "badges", "tables", "charts", "legends", "tooltips"]


def raw_question(topic="labels", correct="b", citation=1, **overrides):
    body = {
        "stem": f"Why does the guide recommend clear {topic} for readers?",
        "options": [{"id": "a", "text": f"They decorate {topic}"},
                    {"id": "b", "text": f"They help readers find {topic} fast"},
                    {"id": "c", "text": f"They hide {topic}"},
                    {"id": "d", "text": f"They replace {topic}"}],
        "correct_option_id": correct,
        "explanations": {"a": "Decoration is not the goal.", "b": "The guide says so.",
                         "c": "Hiding defeats the purpose.", "d": "Nothing is replaced."},
        "citation": citation,
        "bloom_level": "recall",
    }
    body.update(overrides)
    return body


def reply(*topics, **overrides):
    return json.dumps({"questions": [raw_question(topic, **overrides) for topic in topics]})


def evidence():
    text, sources, _ = build_evidence([section()], 12000)
    return text, sources


async def write(provider, prior=(), attempt=1):
    text, sources = evidence()
    return await QuizWriter(provider).write(
        {"title": "Labels"}, {"objective": "Know labels."}, text, sources, list(prior), attempt
    )


def correct_text(question):
    return next(o.text for o in question.options if o.id == question.correct_option_id)


def test_question_validation_shuffles_and_keeps_the_key():
    sources = {1: evidence()[1][0]}
    seen = set()
    for _ in range(30):
        question, problem = check_question(raw_question(), sources)
        assert problem == "" and correct_text(question).startswith("They help readers")
        assert set(question.explanations) >= {o.id for o in question.options} - {question.correct_option_id}
        assert question.citation["citation"] == 1 and question.citation["number"] == "1"
        seen.add(question.correct_option_id)
    assert len(seen) > 1  # The key is not positional.
    bad = [
        (raw_question(options=raw_question()["options"][:3]), "four options"),
        (raw_question(correct="z"), "exactly one"),
        (raw_question(explanations={"b": "only right"}), "wrong option"),
        (raw_question(citation=7), "citation"),
        (raw_question(stem=" ".join(["word"] * 41) + "?"), "stems"),
        (raw_question(options=[{"id": i, "text": "Same"} for i in "abcd"]), "distinct"),
        (raw_question(options=[{"id": "a", "text": "All of the above"}] + raw_question()["options"][1:]),
         "of the above"),
    ]
    for item, expected in bad:
        assert check_question(item, sources)[0] is None
        assert expected in check_question(item, sources)[1]


def test_similarity_and_emphasis_rotation():
    assert similar("Why are labels clear for readers?", "Why are the labels clear for the readers")
    assert not similar("Why are labels clear?", "Which color marks a hazard?")
    assert [emphasis(n) for n in (1, 2, 3, 4)] == ["recall", "apply", "analyze", "recall"]


async def test_three_attempts_never_repeat_stems():
    prior: list[str] = []
    for attempt in range(1, 4):
        topics = TOPICS[(attempt - 1) * 3: attempt * 3]
        provider = ScriptedProvider([reply(*topics)])
        questions = await write(provider, prior, attempt)
        payload = json.loads(provider.calls[0][1])
        assert payload["avoid_stems"] == prior and payload["bloom_level"] == emphasis(attempt)
        assert [q.id for q in questions] == ["q1", "q2", "q3"]
        for stem in (q.stem for q in questions):
            assert not any(similar(stem, old) for old in prior)
        prior += [q.stem for q in questions]
    assert len(prior) == 9


async def test_duplicate_is_retried_then_only_the_offender_is_replaced():
    prior = [raw_question("labels")["stem"]]
    # Call 1 repeats a prior stem; the retry still repeats it; call 3 asks for one only.
    provider = ScriptedProvider([
        reply("labels", "colors", "spacing"),
        reply("labels", "colors", "spacing"),
        reply("contrast"),
    ])
    questions = await write(provider, prior, 2)
    assert len(provider.calls) == 3
    assert "repeats an earlier question" in provider.calls[1][0]
    assert "Write only 1 new question" in provider.calls[2][0]
    assert json.loads(provider.calls[2][1])["count"] == 1
    assert sorted(q.stem.split()[-3] for q in questions) == ["colors", "contrast", "spacing"]
    # A provider that corrects itself on the retry needs no third call.
    fixed = ScriptedProvider([reply("labels", "colors", "spacing"), reply("icons", "colors", "spacing")])
    assert len(await write(fixed, prior, 2)) == 3 and len(fixed.calls) == 2


async def test_generation_failures_are_bounded_and_typed():
    with pytest.raises(QuizFailed) as failed:
        await write(ScriptedProvider(["not json", reply("labels", citation=9)]))
    assert failed.value.code == "invalid"
    prior = [raw_question(t)["stem"] for t in ("labels", "colors", "spacing")]
    stuck = ScriptedProvider([reply("labels", "colors", "spacing")] * 3)
    with pytest.raises(QuizFailed) as failed:
        await write(stuck, prior)
    assert failed.value.code == "duplicate" and len(stuck.calls) == 3
    with pytest.raises(QuizFailed) as failed:
        await write(ScriptedProvider([ProviderError("down")]))
    assert failed.value.code == "provider"


def test_grading_math_and_answer_validation():
    sources = {1: evidence()[1][0]}
    questions = [check_question(raw_question(t), sources)[0].model_copy(update={"id": f"q{i}"})
                 for i, t in enumerate(("labels", "colors", "spacing"), 1)]
    stored = [q.model_dump(mode="json") for q in questions]
    right = {q.id: q.correct_option_id for q in questions}
    wrong = {q.id: next(o.id for o in q.options if o.id != q.correct_option_id) for q in questions}
    for correct_count, expected in ((3, True), (2, True), (1, False), (0, False)):
        answers = {q.id: (right if i < correct_count else wrong)[q.id] for i, q in enumerate(questions)}
        score, passed, results = grade(stored, answers)
        assert (score, passed) == (correct_count, expected)
        missed = [r for r in results if not r["correct"]]
        assert all(r["explanation_for_chosen"] and r["correct_option_id"] for r in missed)
        assert all(r["explanation_for_chosen"] is None for r in results if r["correct"])
    assert answer_problem(stored, {"q1": right["q1"]}) == "Answer every question before submitting."
    assert "one of the question's options" in answer_problem(stored, {**right, "q1": "z"})
    assert answer_problem(stored, right) is None


# Routes ---------------------------------------------------------------------


class QuizStudy(MemoryLessons):
    def __init__(self):
        super().__init__()
        self.attempts: dict = {}
        self.order: list = []  # Lessons in course order, for gating.

    def add_course(self, count=5):
        self.order = [self.add(status="locked", content_status="ready", content=stored_content())
                      for _ in range(count)]
        self.rows[self.order[0]]["progress"]["status"] = "in_progress"
        return self.order

    async def prior_stems(self, lesson_id):
        return [q["stem"] for a in self.attempts.values() if a["lesson_id"] == lesson_id
                for q in a["questions"]]

    async def quiz_attempts(self, lesson_id):
        return [QuizAttemptSummary.model_validate(a) for a in self.attempts.values()
                if a["lesson_id"] == lesson_id]

    async def create_quiz_attempt(self, lesson_id, questions):
        for attempt in self.attempts.values():
            if attempt["lesson_id"] == lesson_id and attempt["status"] == "open":
                attempt["status"] = "abandoned"
        number = len(await self.quiz_attempts(lesson_id)) + 1
        attempt = {"id": uuid4(), "lesson_id": lesson_id, "attempt_number": number,
                   "status": "open", "score": None, "passed": None, "created_at": NOW,
                   "submitted_at": None, "questions": questions, "answers": None}
        self.attempts[attempt["id"]] = attempt
        return QuizAttemptSummary.model_validate(attempt)

    async def quiz_attempt(self, attempt_id):
        if attempt_id not in self.attempts:
            raise NotFound("Quiz attempt does not exist")
        return dict(self.attempts[attempt_id])

    async def submit_quiz_attempt(self, attempt_id, answers, score, passed):
        attempt = self.attempts[attempt_id]
        if attempt["status"] != "open":
            raise Conflict(f"This attempt was already {attempt['status']}.")
        attempt.update(status="submitted", answers=answers, score=score, passed=passed,
                       submitted_at=NOW)
        progress = self.rows[attempt["lesson_id"]]["progress"]
        unlocked = None
        if passed:
            progress["status"] = "completed"
            index = self.order.index(attempt["lesson_id"])
            if index + 1 < len(self.order):
                nxt = self.rows[self.order[index + 1]]["progress"]
                if nxt["status"] == "locked":
                    nxt["status"] = "available"
                    unlocked = self.order[index + 1]
        return QuizAttemptSummary.model_validate(attempt), progress["status"], unlocked


class PrefetchJobs:
    def __init__(self):
        self.prefetched = []

    async def prefetch(self, lesson_id):
        self.prefetched.append(lesson_id)
        return True


@pytest.fixture
def client_for(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "")
    settings.cache_clear()
    created = []

    def make(study, provider):
        jobs = PrefetchJobs()
        app.dependency_overrides[study_storage] = lambda: study
        app.dependency_overrides[lesson_jobs] = lambda: jobs
        client = TestClient(app)
        client.__enter__()
        app.state.providers = provider
        created.append(client)
        return client, jobs

    yield make
    for client in created:
        client.__exit__(None, None, None)
    app.dependency_overrides.clear()
    settings.cache_clear()


def answers_for(study, attempt_id, correct_count):
    questions = study.attempts[attempt_id]["questions"]
    out = {}
    for i, q in enumerate(questions):
        wrong = next(o["id"] for o in q["options"] if o["id"] != q["correct_option_id"])
        out[q["id"]] = q["correct_option_id"] if i < correct_count else wrong
    return out


def scripted_sets(count):
    return ScriptedProvider([reply(*TOPICS[i * 3:(i + 1) * 3]) for i in range(count)])


def test_create_response_never_contains_keys_and_supersedes_open_attempts(client_for):
    study = QuizStudy()
    lessons = study.add_course()
    client, _ = client_for(study, scripted_sets(2))
    first = client.post(f"/lessons/{lessons[0]}/quiz-attempts")
    assert first.status_code == 201, first.text
    body = first.json()
    assert body["attempt_number"] == 1 and len(body["questions"]) == 3
    for key in ("correct_option_id", "explanations", "citation", "reference"):
        assert key not in first.text
    assert all(len(q["options"]) == 4 for q in body["questions"])
    resumed = client.get(f"/quiz-attempts/{body['attempt_id']}")
    assert resumed.json()["status"] == "open" and "correct_option_id" not in resumed.text
    second = client.post(f"/lessons/{lessons[0]}/quiz-attempts")
    assert second.json()["attempt_number"] == 2
    old = client.post(f"/quiz-attempts/{body['attempt_id']}/submit",
                      json={"answers": answers_for(study, UUID(body["attempt_id"]), 3)})
    assert old.status_code == 409 and "abandoned" in old.json()["detail"]
    assert client.get(f"/quiz-attempts/{body['attempt_id']}").json() == {
        "attempt_id": body["attempt_id"], "lesson_id": str(lessons[0]), "attempt_number": 1,
        "status": "abandoned"}


def test_pass_unlocks_only_the_next_lesson_and_retakes_change_nothing(client_for):
    study = QuizStudy()
    lessons = study.add_course(5)
    for lesson_id in lessons[:3]:
        study.rows[lesson_id]["progress"]["status"] = "in_progress"
    third, fourth = lessons[2], lessons[3]
    study.rows[fourth]["progress"]["status"] = "locked"
    client, jobs = client_for(study, scripted_sets(4))
    # Fail first: stays in progress, next stays locked, results explain the wrong answers.
    attempt = UUID(client.post(f"/lessons/{third}/quiz-attempts").json()["attempt_id"])
    failed = client.post(f"/quiz-attempts/{attempt}/submit", json={"answers": answers_for(study, attempt, 1)})
    assert failed.status_code == 200
    result = failed.json()
    assert (result["score"], result["passed"], result["lesson_status"]) == (1, False, "in_progress")
    assert result["unlocked_lesson_id"] is None
    wrong = [r for r in result["questions_with_results"] if not r["correct"]]
    assert len(wrong) == 2 and all(r["explanation_for_chosen"] and r["correct_option_id"] for r in wrong)
    assert study.rows[fourth]["progress"]["status"] == "locked"
    assert client.post(f"/quiz-attempts/{attempt}/submit",
                       json={"answers": answers_for(study, attempt, 3)}).status_code == 409
    # Retake: different stems; 2/3 passes and unlocks exactly lesson 4.
    retake = client.post(f"/lessons/{third}/quiz-attempts").json()
    first_stems = {q["stem"] for q in study.attempts[attempt]["questions"]}
    assert not first_stems & {q["stem"] for q in retake["questions"]}
    retake_id = UUID(retake["attempt_id"])
    passed = client.post(f"/quiz-attempts/{retake_id}/submit",
                         json={"answers": answers_for(study, retake_id, 2)}).json()
    assert passed["passed"] and passed["lesson_status"] == "completed"
    assert passed["unlocked_lesson_id"] == str(fourth) and jobs.prefetched == [fourth]
    assert [study.rows[i]["progress"]["status"] for i in lessons[3:]] == ["available", "locked"]
    # Retaking a passed lesson (even failing) keeps it completed and does not touch lesson 4.
    again = UUID(client.post(f"/lessons/{third}/quiz-attempts").json()["attempt_id"])
    kept = client.post(f"/quiz-attempts/{again}/submit", json={"answers": answers_for(study, again, 0)}).json()
    assert kept["lesson_status"] == "completed" and kept["unlocked_lesson_id"] is None
    assert study.rows[fourth]["progress"]["status"] == "available" and jobs.prefetched == [fourth]
    history = client.get(f"/lessons/{third}/quiz-attempts").json()
    assert [(h["attempt_number"], h["passed"]) for h in history] == [(1, False), (2, True), (3, False)]
    assert "questions" not in json.dumps(history)
    graded = client.get(f"/quiz-attempts/{retake_id}").json()
    assert graded["score"] == 2 and len(graded["questions_with_results"]) == 3


def test_submission_and_gating_errors(client_for):
    study = QuizStudy()
    lessons = study.add_course(3)
    pending = study.add(status="in_progress")
    client, _ = client_for(study, scripted_sets(1))
    assert client.post(f"/lessons/{lessons[1]}/quiz-attempts").status_code == 409  # Locked.
    assert client.post(f"/lessons/{pending}/quiz-attempts").status_code == 409  # No content.
    assert client.post(f"/lessons/{uuid4()}/quiz-attempts").status_code == 404
    attempt = UUID(client.post(f"/lessons/{lessons[0]}/quiz-attempts").json()["attempt_id"])
    full = answers_for(study, attempt, 3)
    partial = {"q1": full["q1"]}
    assert client.post(f"/quiz-attempts/{attempt}/submit", json={"answers": partial}).status_code == 422
    assert client.post(f"/quiz-attempts/{attempt}/submit", json={"answers": {**full, "q1": "zz"}}).status_code == 422
    assert client.post(f"/quiz-attempts/{attempt}/submit", json={}).status_code == 422
    assert client.post(f"/quiz-attempts/{uuid4()}/submit", json={"answers": full}).status_code == 404
    assert client.post(f"/quiz-attempts/{attempt}/submit", json={"answers": full}).status_code == 200
    assert client.post(f"/quiz-attempts/{attempt}/submit", json={"answers": full}).status_code == 409


def test_generation_failure_is_safe_and_bounded(client_for):
    study = QuizStudy()
    lessons = study.add_course(1)
    provider = ScriptedProvider(["no json", "still no json", "never asked"])
    client, _ = client_for(study, provider)
    response = client.post(f"/lessons/{lessons[0]}/quiz-attempts")
    assert response.status_code == 502 and response.json()["detail"] == "The quiz could not be generated. Please retry."
    assert len(provider.calls) == 2 and not study.attempts
    object.__setattr__(settings(), "quiz_call_limit", 1)  # Cleared by the fixture.
    study.attempts.clear()
    client.app.state.providers = ScriptedProvider(["bad", "bad"])
    assert client.post(f"/lessons/{lessons[0]}/quiz-attempts").status_code == 502
    assert len(client.app.state.providers.calls) == 1  # Budget stopped the retry.
