"""Planner, windows and Markdown structure with a scripted provider; no database or network."""

import json

import pytest

from app.agents.budget import BudgetedProvider, BudgetExceeded, CallBudget, current_budget
from app.providers import ProviderError
from app.study.planner import (
    MAX_LESSON_MINUTES,
    MIN_LESSON_MINUTES,
    Planner,
    PlanningFailed,
    StructureDraft,
    TopicRecord,
    assemble,
    build_windows,
    estimate_minutes,
)
from app.uploads import extract_document, markdown_sections


class ScriptedProvider:
    """Replies in order; records prompts so tests can assert what the model saw."""

    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = []

    async def chat(self, system, prompt, max_tokens=1200):
        self.calls.append((system, prompt, max_tokens))
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


def sections(count=3, words_each=120):
    body = " ".join(["word"] * words_each)
    return [
        {"id": str(i), "number": str(i), "title": f"Section {i}", "text": f"S{i} {body}"}
        for i in range(1, count + 1)
    ]


def topics_reply(ids, per_window=1):
    return json.dumps({"topics": [
        {"title": f"Topic {sid}", "summary": "About it", "section_ids": [sid]} for sid in ids[:per_window] or ids
    ]})


def structure_reply(groups):
    return json.dumps({"modules": [
        {"title": f"Module {m}", "summary": "", "lessons": [
            {"title": f"Lesson {tid}", "objective": "Do it", "topic_ids": [tid]} for tid in tids
        ]} for m, tids in enumerate(groups, 1)
    ]})


def test_markdown_headings_become_hierarchical_sections():
    text = "Intro line\n\n# Build\nDockerfile text\n## Tags\nTag text\n# Deploy\n## Pods\nPod text\n## Services\n"
    result = markdown_sections("guide.md", text)
    assert [(s.id, s.title, s.parent_id, s.kind) for s in result] == [
        ("0", "guide.md", None, "section"),
        ("1", "Build", None, "chapter"),
        ("1.1", "Tags", "1", "section"),
        ("2", "Deploy", None, "chapter"),
        ("2.1", "Pods", "2", "section"),
        ("2.2", "Services", "2", "section"),
    ]
    assert result[-1].text == "Services"  # Empty body falls back to the title.
    assert markdown_sections("plain.txt", "# Only one heading\nbody") is None
    doc = extract_document("guide.md", text.encode())
    assert [s.id for s in doc.sections] == ["0", "1", "1.1", "2", "2.1", "2.2"]
    assert extract_document("notes.txt", b"Labels are blue.").sections[0].text == "Labels are blue."


def test_windows_group_sections_and_split_oversized_ones():
    small = sections(3, 10)
    windows = build_windows(small, max_chars=100)
    assert [w.section_ids for w in windows] == [["1"], ["2"], ["3"]]
    windows = build_windows(small, max_chars=10000)
    assert [w.section_ids for w in windows] == [["1", "2", "3"]]
    huge = [{"id": "9", "number": "9", "title": "Long", "text": "x" * 250}]
    windows = build_windows(huge, max_chars=100)
    assert len(windows) == 3 and all(w.section_ids == ["9"] for w in windows)
    assert build_windows([{"id": "e", "number": "e", "title": "", "text": "  "}], 100) == []


async def test_planner_maps_windows_reduces_and_estimates():
    events = []
    provider = ScriptedProvider([
        topics_reply(["1", "2"], per_window=2),
        topics_reply(["3"]),
        structure_reply([[1, 2], [3]]),
    ])
    planner = Planner(provider, window_chars=1700, emit=lambda *a, **k: events.append((a, k)))
    plan = await planner.plan(sections(3, 120))
    assert [m.title for m in plan.modules] == ["Module 1", "Module 2"]
    assert [[lesson.source_section_ids for lesson in m.lessons] for m in plan.modules] == [[["1"], ["2"]], [["3"]]]
    assert all(MIN_LESSON_MINUTES <= lesson.estimated_minutes <= MAX_LESSON_MINUTES for m in plan.modules for lesson in m.lessons)
    steps = [(a[0], a[1], k.get("task")) for a, k in events]
    assert steps[:3] == [("outline", "started", None), ("outline", "completed", None), ("topics", "started", None)]
    assert ("topics", "started", "w1") in steps and ("topics", "completed", "w2") in steps
    assert steps[-1] == ("estimate", "completed", None)
    # The model only ever sees allowed section IDs and bracketed text, as data.
    first = json.loads(provider.calls[0][1])
    assert first["allowed_section_ids"] == ["1", "2"] and "[1] 1 Section 1" in first["text"]


async def test_planner_drops_unknown_section_ids_and_repairs_one_bad_reply():
    provider = ScriptedProvider([
        "not json at all",
        json.dumps({"topics": [{"title": "Ghost", "section_ids": ["404"]}, {"title": "Real", "section_ids": ["1", "404"]}]}),
        structure_reply([[1]]),
    ])
    plan = await Planner(provider, window_chars=10000).plan(sections(1, 200))
    assert plan.modules[0].lessons[0].source_section_ids == ["1"]
    assert "not valid JSON" in provider.calls[1][0]


async def test_planner_fails_clearly_instead_of_fabricating():
    with pytest.raises(PlanningFailed) as unreadable:
        await Planner(ScriptedProvider([]), window_chars=1000).plan(sections(1, 5))
    assert unreadable.value.code == "unreadable"
    twice_bad = ScriptedProvider(["{", "{"])
    with pytest.raises(PlanningFailed) as bad:
        await Planner(twice_bad, window_chars=10000).plan(sections(1, 200))
    assert bad.value.code == "provider" and len(twice_bad.calls) == 2
    with pytest.raises(PlanningFailed) as provider_error:
        await Planner(ScriptedProvider([ProviderError("rate limited", retryable=True)]), window_chars=10000).plan(sections(1, 200))
    assert provider_error.value.code == "provider"
    unknown_topics = ScriptedProvider([topics_reply(["1"]), structure_reply([[99]]), structure_reply([[99]])])
    with pytest.raises(PlanningFailed):
        await Planner(unknown_topics, window_chars=10000).plan(sections(1, 200))


async def test_budget_caps_planner_calls():
    provider = ScriptedProvider([topics_reply(["1"])] * 10 + [structure_reply([[1]])])
    token = current_budget.set(CallBudget(chat_limit=3, embedding_limit=0))
    try:
        with pytest.raises(BudgetExceeded):
            await Planner(BudgetedProvider(provider), window_chars=50).plan(sections(10, 20))
    finally:
        current_budget.reset(token)
    assert len(provider.calls) == 3


def test_assemble_splits_long_lessons_and_merges_fragments():
    topics = [TopicRecord(1, "Big", "", ["a", "b"]), TopicRecord(2, "Tiny", "", ["c"]), TopicRecord(3, "Next", "", ["d"])]
    structure = StructureDraft.model_validate({"modules": [{"title": "M", "lessons": [
        {"title": "Big one", "topic_ids": [1]}, {"title": "Tiny", "topic_ids": [2]}, {"title": "Next", "topic_ids": [3]},
    ]}]})
    plan = assemble(structure, topics, {"a": 1200, "b": 1200, "c": 10, "d": 300})
    titles = [lesson.title for lesson in plan.modules[0].lessons]
    assert titles == ["Big one (1/2)", "Big one (2/2)", "Next"]
    # The fragment folded into its predecessor; its section travels with it.
    assert plan.modules[0].lessons[1].source_section_ids == ["b", "c"]
    assert plan.modules[0].lessons[0].estimated_minutes == estimate_minutes(1200)
    assert estimate_minutes(0) == MIN_LESSON_MINUTES and estimate_minutes(100000) == MAX_LESSON_MINUTES
