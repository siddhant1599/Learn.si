"""Lesson writer contract, budgets, grounding and Mermaid checks with a scripted provider."""

import json
from uuid import uuid4

import pytest

from app.agents.budget import BudgetedProvider, BudgetExceeded, CallBudget, current_budget
from app.providers import ProviderError
from app.study.lesson_writer import (
    COVERAGE_NOTE,
    LessonFailed,
    LessonWriter,
    build_evidence,
    complete,
    looks_like_code,
    mermaid_problem,
    review,
    visible_words,
    words,
)
from app.study.models import LessonContent, client_content
from tests.test_study_planner import ScriptedProvider

DOCUMENT = uuid4()
PROSE = " ".join(["Labels name each part so readers find it fast."] * 30)
CODE = "Use this function:\n```python\ndef area(w, h):\n    return w * h\n```\n" + PROSE


def section(text=PROSE, sid="1"):
    return {"id": sid, "number": sid, "title": "Labels", "kind": "section", "page": 3,
            "document_id": DOCUMENT, "document_title": "Guide", "edition": "test", "text": text}


def paragraph(n, cite="[1]"):
    return " ".join(["word"] * (n - 2)) + f" ends here {cite}."


def lesson(**overrides):
    body = {
        "objective": "Explain why labels help readers.",
        "explanation": paragraph(110) + "\n\n" + paragraph(110),
        "real_world_example": "A museum labels each exhibit so visitors can find it [1].",
        "diagram": {"kind": "mermaid", "source": "flowchart TD\n  A[Label] --> B[Reader]",
                    "caption": "Labels guide readers."},
        "code_example": None,
        "insights": [{"kind": "why_it_matters", "text": "Clear labels save time [1]."}],
        "your_turn": {"kind": "apply", "prompt": "Label the parts of a kitchen.",
                      "reference_answer": "SECRET-ANSWER"},
        "key_terms": [{"term": "Label", "definition": "A short name for a part."}],
    }
    body.update(overrides)
    return body


def code_example(**todo):
    return {"language": "python", "code": "def area(w, h):\n    return TODO(you)",
            "explanation": "Area multiplies the sides [1].",
            "todo": {"marker": "TODO(you)", "instruction": "Return the area.",
                     "reference_solution": "SECRET-SOLUTION", **todo}}


def sources():
    return build_evidence([section()], 12000)[1]


def test_word_counts_ignore_citations_and_budgets_bound_the_explanation():
    assert words("one [1] two [12]") == 2
    ok = review(json.dumps(lesson()), sources(), False, False)
    assert ok.content is not None and not ok.problems
    long = review(json.dumps(lesson(explanation=paragraph(150) + "\n\n" + paragraph(150))),
                  sources(), False, False)
    assert long.content is None and any("explanation has 300 words" in p for p in long.problems)
    short = review(json.dumps(lesson(explanation=paragraph(100))), sources(), False, False)
    assert short.content is None and any("write 200-250" in p for p in short.problems)
    # Accepts both ends of the range.
    for total in (200, 250):
        half = total // 2
        accepted = review(json.dumps(lesson(explanation=paragraph(half) + "\n\n" + paragraph(total - half))),
                          sources(), False, False)
        assert accepted.content is not None, accepted.problems


def test_total_and_field_budgets_are_enforced_without_truncation():
    terms = [{"term": f"Term {i}", "definition": " ".join(["defined"] * 24) + "."} for i in range(5)]
    insights = [{"kind": "trade_off", "text": " ".join(["costly"] * 55) + " [1]."}] * 2
    example = " ".join(["museum"] * 115) + " [1]."
    code = code_example()
    code["explanation"] = " ".join(["multiply"] * 55) + " [1]."
    draft = review(json.dumps(lesson(key_terms=terms, insights=insights, real_world_example=example,
                                     code_example=code,
                                     explanation=paragraph(125) + "\n\n" + paragraph(125))),
                   sources(), True, False)
    assert draft.content is None and any("learner-visible words; at most 650" in p for p in draft.problems)
    over = review(json.dumps(lesson(real_world_example=" ".join(["x"] * 130) + " [1].")),
                  sources(), False, False)
    assert any("real_world_example has 130 words" in p for p in over.problems)
    two = review(json.dumps(lesson(objective="Know labels. Use them well.")), sources(), False, False)
    assert any("exactly one sentence" in p for p in two.problems)
    cut = review(json.dumps(lesson(real_world_example="A museum labels each exhibit so")),
                 sources(), False, False)
    assert any("ends mid-sentence" in p for p in cut.problems)
    assert complete("Steps:\n- first\n- second") and not complete("It stops")


def test_mermaid_allowlist_accepts_known_types_and_rejects_html_and_script():
    assert mermaid_problem("flowchart TD\n  A[Start] --> B{Choice}") is None
    assert mermaid_problem("sequenceDiagram\n  A->>B: Hello") is None
    assert mermaid_problem("classDiagram\n  Animal <|-- Duck\n  class Shape{\n  <<interface>>\n  }") is None
    assert mermaid_problem("stateDiagram-v2\n  [*] --> Idle") is None
    assert mermaid_problem("mindmap\n  root((Labels))") is None
    assert mermaid_problem("pie\n  \"a\": 1") == "type"
    assert mermaid_problem("flowchart TD\n  A[<script>alert(1)</script>]") == "unsafe"
    assert mermaid_problem("flowchart TD\n  A[<img src=x onerror=1>]") == "unsafe"
    assert mermaid_problem("flowchart TD\n  A --> B\n  click A href \"javascript:alert(1)\"") == "unsafe"
    assert mermaid_problem("%%{init: {'theme':'dark'}}%%\nflowchart TD\n  A-->B") == "type"
    assert mermaid_problem("flowchart TD\n  A[Open --> B") == "syntax"
    invalid = review(json.dumps(lesson(diagram={"source": "flowchart TD\n  A[<b>x</b>]", "caption": "c"})),
                     sources(), False, False)
    assert invalid.content is not None and invalid.content.diagram is None
    assert invalid.content.warnings == ["diagram_dropped"]
    missing = review(json.dumps(lesson(diagram=None)), sources(), False, False)
    assert missing.content is not None and missing.content.diagram is None and not missing.content.warnings


def test_code_example_only_for_code_sources_and_code_gap_needs_a_todo():
    assert looks_like_code(CODE) and not looks_like_code(PROSE)
    gap = {"kind": "code_gap", "prompt": "Fill in the TODO(you) line.", "reference_answer": "w * h"}
    with_code = review(json.dumps(lesson(code_example=code_example(), your_turn=gap)), sources(), True, False)
    assert with_code.content is not None and with_code.content.code_example.todo is not None
    # Prose sources: a code example is dropped, and a code_gap exercise is sent back.
    dropped = review(json.dumps(lesson(code_example=code_example())), sources(), False, False)
    assert dropped.content is not None and dropped.content.code_example is None
    assert "code_dropped" in dropped.content.warnings
    refused = review(json.dumps(lesson(code_example=code_example(), your_turn=gap)), sources(), False, False)
    assert refused.content is None and "not about code" in refused.problems[0]
    no_code = review(json.dumps(lesson(your_turn=gap)), sources(), True, False)
    assert no_code.content is None and any("code_gap" in p for p in no_code.problems)
    unmarked = code_example()
    unmarked["code"] = "def area(w, h):\n    pass"
    assert review(json.dumps(lesson(code_example=unmarked)), sources(), True, False).content is None


def test_citations_must_resolve_and_cover_every_paragraph():
    bad = review(json.dumps(lesson(real_world_example="A museum labels exhibits [7].")), sources(), False, False)
    assert bad.content is None and bad.ungrounded
    uncited = review(json.dumps(lesson(explanation=paragraph(110) + "\n\n" + paragraph(110, cite=""))),
                     sources(), False, False)
    assert uncited.content is None and uncited.ungrounded
    assert any("paragraphs [2]" in p for p in uncited.problems)
    native = review(json.dumps(lesson(explanation=paragraph(110, "【1】") + "\n\n" + paragraph(110))),
                    sources(), False, False)
    assert native.content is not None and "[1]" in native.content.explanation
    cited = native.content.citations
    assert cited and cited[0]["citation"] == 1 and cited[0]["document_id"] == str(DOCUMENT)
    assert {"number", "kind", "page"} <= set(cited[0])


def test_limited_coverage_note_and_shorter_explanation():
    draft = review(json.dumps(lesson(explanation=paragraph(70))), sources(), False, True)
    assert draft.content is not None and draft.content.coverage_note == COVERAGE_NOTE
    flagged = review(json.dumps({**lesson(explanation=paragraph(70)), "limited_coverage": True}),
                     sources(), False, False)
    assert flagged.content is not None and flagged.content.coverage_note == COVERAGE_NOTE
    # Still no uncited claims.
    assert review(json.dumps(lesson(explanation=paragraph(70, cite=""))), sources(), False, True).ungrounded


def test_server_only_fields_never_reach_the_client_view():
    gap = {"kind": "code_gap", "prompt": "Fill in the TODO(you) line.", "reference_answer": "SECRET-ANSWER"}
    content = review(json.dumps(lesson(code_example=code_example(), your_turn=gap)), sources(), True, False).content
    stored = content.model_dump(mode="json")
    assert "SECRET-SOLUTION" in json.dumps(stored)
    view = client_content(stored)
    text = json.dumps(view)
    assert "SECRET" not in text and "reference_answer" not in text and "reference_solution" not in text
    assert view["code_example"]["todo"]["instruction"] == "Return the area."
    assert client_content({"objective": "corrupt"}) is None and client_content(None) is None
    assert visible_words(LessonContent.model_validate(stored)) <= 650


async def test_writer_retries_once_then_succeeds_with_bounded_calls():
    events = []
    provider = ScriptedProvider([
        json.dumps(lesson(explanation=paragraph(150) + "\n\n" + paragraph(150))),
        json.dumps(lesson()),
    ])
    writer = LessonWriter(provider, 12000, lambda step, status, **k: events.append((step, status, k)))
    content = await writer.write({"title": "Labels", "objective": "Know labels"}, [section()])
    assert content["your_turn"]["reference_answer"] == "SECRET-ANSWER"  # Stored server side.
    assert len(provider.calls) == 2
    retry_system, retry_prompt, _ = provider.calls[1]
    assert "explanation has 300 words" in retry_system and "previous_draft" in json.loads(retry_prompt)
    payload = json.loads(provider.calls[0][1])
    assert payload["code_allowed"] is False and "[1]" in payload["evidence"]
    assert ("validate", "completed", {"attempt": 0, "outcome": "retry"}) in events
    assert events[-1][:2] == ("validate", "completed")


async def test_writer_failure_codes_are_ungrounded_invalid_provider_and_unreadable():
    bad_cite = json.dumps(lesson(real_world_example="Exhibits [9]."))
    writer = LessonWriter(ScriptedProvider([bad_cite, bad_cite]), 12000)
    with pytest.raises(LessonFailed) as failed:
        await writer.write({"title": "Labels"}, [section()])
    assert failed.value.code == "ungrounded"
    writer = LessonWriter(ScriptedProvider(["not json", "{}"]), 12000)
    with pytest.raises(LessonFailed) as failed:
        await writer.write({"title": "Labels"}, [section()])
    assert failed.value.code == "invalid"
    writer = LessonWriter(ScriptedProvider([ProviderError("down")]), 12000)
    with pytest.raises(LessonFailed) as failed:
        await writer.write({"title": "Labels"}, [section()])
    assert failed.value.code == "provider"
    with pytest.raises(LessonFailed) as failed:
        await LessonWriter(ScriptedProvider([]), 12000).write({"title": "x"}, [section(text="")])
    assert failed.value.code == "unreadable"


async def test_writer_respects_the_call_budget():
    provider = ScriptedProvider([json.dumps(lesson(explanation="Short [1].")), json.dumps(lesson())])
    token = current_budget.set(CallBudget(chat_limit=1, embedding_limit=0))
    try:
        with pytest.raises(BudgetExceeded):
            await LessonWriter(BudgetedProvider(provider), 12000).write({"title": "x"}, [section()])
    finally:
        current_budget.reset(token)
    assert len(provider.calls) == 1


def test_evidence_is_bounded_and_flags_thin_sources():
    long = " ".join(["token"] * 3000)
    text, found, used = build_evidence([section(text=long), section(sid="2")], 4000)
    assert len(text) <= 4000 and found and all(s["section_id"] == "1" for s in found)
    _, thin, thin_words = build_evidence([section(text="Only a few words here.")], 12000)
    assert thin and thin_words < 150
