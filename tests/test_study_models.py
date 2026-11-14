"""Pure contract checks for Master mode models; no database or providers."""

import pytest
from pydantic import ValidationError

from app.study.models import MAX_LESSONS, LessonPlan, QuizQuestion, QuizSet


def lesson(**overrides):
    base = {"title": "Pump checks", "source_section_ids": ["3", "3.1"], "estimated_minutes": 6}
    return {**base, **overrides}


def question(**overrides):
    base = {
        "id": "q1",
        "stem": "Which check comes first?",
        "options": [{"id": "a", "text": "Oil"}, {"id": "b", "text": "Guard"},
                    {"id": "c", "text": "Valve"}, {"id": "d", "text": "Label"}],
        "correct_option_id": "b",
        "explanations": {"a": "Oil is second.", "c": "Valves follow.", "d": "Labels are last."},
    }
    return {**base, **overrides}


def test_lesson_plan_totals_and_bounds():
    plan = LessonPlan(modules=[
        {"title": "Start", "lessons": [lesson(), lesson(title="Guards", estimated_minutes=5)]},
        {"title": "Operate", "summary": "Running", "lessons": [lesson(title="Valves")]},
    ])
    assert plan.lesson_count == 3
    assert plan.estimated_minutes == 17
    assert plan.modules[0].estimated_minutes == 11
    with pytest.raises(ValidationError):
        LessonPlan(modules=[])
    with pytest.raises(ValidationError):
        LessonPlan(modules=[{"title": "Empty", "lessons": []}])
    with pytest.raises(ValidationError, match="unique"):
        LessonPlan(modules=[{"title": "Dup", "lessons": [lesson(source_section_ids=["3", "3"])]}])
    with pytest.raises(ValidationError, match="blank"):
        LessonPlan(modules=[{"title": "Blank", "lessons": [lesson(source_section_ids=[" "])]}])
    with pytest.raises(ValidationError):
        LessonPlan(modules=[{"title": "Long", "lessons": [lesson(estimated_minutes=61)]}])
    too_many = [{"title": f"M{i}", "lessons": [lesson()] * 30} for i in range(5)]
    with pytest.raises(ValidationError, match=str(MAX_LESSONS)):
        LessonPlan(modules=too_many)


def test_quiz_question_contract_and_client_view():
    q = QuizQuestion(**question())
    view = q.client_view()
    assert set(view) == {"id", "stem", "options", "bloom_level"}
    assert "correct_option_id" not in view and "explanations" not in view
    with pytest.raises(ValidationError, match="correct option"):
        QuizQuestion(**question(correct_option_id="z"))
    with pytest.raises(ValidationError, match="wrong option"):
        QuizQuestion(**question(explanations={"a": "only one"}))
    with pytest.raises(ValidationError, match="only reference"):
        QuizQuestion(**question(explanations={"a": "x", "c": "y", "d": "z", "zz": "stray"}))
    with pytest.raises(ValidationError, match="unique"):
        QuizQuestion(**question(options=[{"id": "a", "text": "1"}] * 4))
    with pytest.raises(ValidationError):
        QuizQuestion(**question(options=question()["options"][:3]))
    with pytest.raises(ValidationError):
        QuizSet(questions=[question(), question(id="q2")])
    with pytest.raises(ValidationError, match="unique"):
        QuizSet(questions=[question(), question(), question()])
    assert len(QuizSet(questions=[question(id=f"q{i}") for i in range(3)]).questions) == 3
