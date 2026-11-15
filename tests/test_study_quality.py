"""Offline quality checks: recorded Master-mode model outputs replayed through the
app's own validators, so contract regressions are caught without live calls.

Fixtures in tests/fixtures/master are synthetic (a fictional archive handbook).
"""

import json
from pathlib import Path

import pytest

from app.study.lesson_writer import (
    EXPLANATION_WORDS,
    TOTAL_WORDS,
    LessonWriter,
    build_evidence,
    review,
    visible_words,
    words,
)
from app.study.models import QUIZ_OPTIONS, QUIZ_QUESTIONS, LessonContent, client_content
from app.study.quiz import QuizFailed, QuizWriter, similar
from app.study.review import FEEDBACK_WORDS, YourTurnReviewer, leaks
from app.uploads import extract_document
from tests.test_study_planner import ScriptedProvider

FIXTURES = Path(__file__).parent / "fixtures" / "master"
DOCUMENT_ID = "00000000-0000-4000-8000-000000000001"
LESSON_SECTIONS = ("1.1", "1.2")  # Labels, Retention.


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text()


@pytest.fixture(scope="module")
def sections():
    document = extract_document("handbook.md", fixture("handbook.md").encode())
    return [
        {**s.model_dump(), "document_id": DOCUMENT_ID, "document_title": document.title,
         "edition": document.edition}
        for s in document.sections if s.id in LESSON_SECTIONS
    ]


@pytest.fixture(scope="module")
def evidence(sections):
    text, sources, used = build_evidence(sections, 12000)
    return text, sources, used


def test_recorded_lesson_meets_the_contract(evidence):
    _, sources, used = evidence
    assert [s["title"] for s in sources] == ["Labels", "Retention"]
    draft = review(fixture("lesson_reply.json"), sources, code_allowed=False, limited_evidence=used < 150)
    assert draft.problems == [] and draft.content is not None
    content = draft.content
    low, high = EXPLANATION_WORDS
    assert low <= words(content.explanation) <= high
    assert visible_words(content) <= TOTAL_WORDS
    assert 1 <= len(content.insights) <= 2 and content.your_turn.kind == "apply"
    assert content.diagram is not None and content.coverage_note is None
    cited = {c["citation"] for c in content.citations}
    assert cited == {1, 2} and all(c["document_id"] == DOCUMENT_ID for c in content.citations)
    view = client_content(content.model_dump(mode="json"))
    assert "reference_answer" not in json.dumps(view) and "HR-007" not in json.dumps(view)


async def test_recorded_lesson_through_the_writer_is_stored_with_server_fields(sections):
    provider = ScriptedProvider([fixture("lesson_reply.json")])
    stored = await LessonWriter(provider, 12000).write({"title": "Labels"}, sections)
    assert len(provider.calls) == 1  # No retry needed for a contract-valid reply.
    content = LessonContent.model_validate(stored)
    assert content.your_turn.reference_answer == "HR-007, 2015–2016, Standard"


async def test_recorded_quizzes_have_three_by_four_and_never_repeat(evidence):
    text, sources, _ = evidence
    content = json.loads(fixture("lesson_reply.json"))
    first = await QuizWriter(ScriptedProvider([fixture("quiz_reply.json")])).write(
        {"title": "Labels"}, content, text, sources, [], 1)
    assert len(first) == QUIZ_QUESTIONS
    for question in first:
        assert len(question.options) == QUIZ_OPTIONS
        wrong = {o.id for o in question.options} - {question.correct_option_id}
        assert wrong <= set(question.explanations)
        assert question.citation["citation"] in {s["citation"] for s in sources}
        view = question.client_view()
        assert "correct_option_id" not in view and "explanations" not in view
    assert sorted(q.bloom_level for q in first) == ["analyze", "apply", "recall"]
    prior = [q.stem for q in first]
    retake = await QuizWriter(ScriptedProvider([fixture("quiz_retake_reply.json")])).write(
        {"title": "Labels"}, content, text, sources, prior, 2)
    assert not any(similar(new.stem, old) for new in retake for old in prior)
    # Replaying the first set as a retake is rejected, never served twice.
    provider = ScriptedProvider([fixture("quiz_reply.json")] * 3)
    with pytest.raises(QuizFailed) as failed:
        await QuizWriter(provider).write({"title": "Labels"}, content, text, sources, prior, 2)
    assert failed.value.code == "duplicate"


async def test_recorded_review_guides_without_revealing(evidence):
    text, _, _ = evidence
    reference = json.loads(fixture("lesson_reply.json"))["your_turn"]["reference_answer"]
    result = await YourTurnReviewer(ScriptedProvider([fixture("review_reply.json")])).review(
        kind="apply", prompt="Write the label.", answer="Standard, HR, 7, 2015-2016",
        reference=reference, lesson={}, evidence=text, reveal=False)
    assert result["verdict"] == "partial"
    assert words(result["feedback"]) <= FEEDBACK_WORDS and not leaks(result["feedback"], reference)
