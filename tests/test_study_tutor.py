"""Lesson tutor scoping, Socratic prompt, conversation binding and Your turn review."""

import json
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

import app.api as api
from app.agents.evidence import grounded_citations
from app.agents.nodes import SearchService
from app.agents.synthesis import SynthesisAgent
from app.api import app, storage, study_storage
from app.config import settings
from app.providers import ProviderError
from app.study.review import FALLBACK_GUIDANCE, clip_sentences, leaks
from app.study.tutor import TUTOR_SYSTEM, asked_for_answer, lesson_summary, tutor_context
from tests.test_core import hit
from tests.test_study_lesson_writer import code_example, lesson, section
from tests.test_study_lessons import MemoryLessons, stored_content
from tests.test_study_planner import ScriptedProvider

# Units ------------------------------------------------------------------------


def test_answer_requests_are_detected():
    for text in ("Just tell me the answer", "what's the answer?", "give me the answer please",
                 "I give up", "no more hints"):
        assert asked_for_answer(text), text
    for text in ("Why does chunking help?", "Can you explain tokens?", "Tell me more about RAG"):
        assert not asked_for_answer(text), text


def test_lesson_summary_is_learner_safe_and_bounded():
    content = json.loads(json.dumps(stored_content()))
    from app.study.models import client_content

    summary = lesson_summary("Labels", client_content(content))
    assert "Labels" in summary and "Explain why labels help readers." in summary
    assert "SECRET" not in summary  # Reference answers and solutions never reach the tutor.
    assert len(lesson_summary("x", {"explanation": "word " * 5000})) <= 2400


def test_tutor_context_stays_within_the_history_cap():
    history = "\n".join(f"user: question {i} " + "x" * 200 for i in range(60))
    for cap in (6000, 2000, 300, 0):
        summary, kept = tutor_context("L" * 2400, history, cap)
        assert len(summary) + len(kept) <= cap
        assert len(summary) <= cap // 2
        if kept:
            assert kept.endswith(history.splitlines()[-1])  # Newest history survives.


def test_guidance_may_be_uncited_but_never_falsely_cited():
    sources = [{"citation": 1}]
    hint = "Look at the explanation again. What happens when the input exceeds the limit?"
    assert grounded_citations(hint, sources, allow_uncited=True) == (hint, [])
    assert grounded_citations(hint, sources)[1] == []  # Ask mode still rejects uncited text.
    assert "could not produce" in grounded_citations(hint, sources)[0]
    bad = grounded_citations("See [7].", sources, allow_uncited=True)
    assert "could not produce" in bad[0]


async def test_search_boost_ranks_lesson_sections_first_and_keeps_the_rest():
    class Store:
        async def search(self, query, docs, embedding):
            return [{**hit(i), "section_id": sid} for i, sid in enumerate(["9", "2", "9", "3"], 1)]

    class Provider:
        async def embed(self, text):
            return [1.0] * 768

    hits, _ = await SearchService(Provider(), Store(), frozenset({"2", "3"})).search(["q"], [uuid4()])
    assert [h["section_id"] for h in hits] == ["2", "3", "9", "9"]
    plain, _ = await SearchService(Provider(), Store()).search(["q"], [uuid4()])
    assert [h["section_id"] for h in plain] == ["9", "2", "9", "3"]


class Recorder:
    def __init__(self, reply):
        self.reply, self.calls = reply, []

    async def chat(self, system, prompt, max_tokens=1200):
        self.calls.append((system, json.loads(prompt)))
        return self.reply


def answer_state(**extra):
    return {"question": "Why chunk?", "history": "", "document_ids": [uuid4()],
            "context": "[1] {} Labels must be blue.", "sources": [{"citation": 1}], **extra}


async def test_socratic_instructions_only_for_lesson_scope():
    tutor = Recorder("Look at [1]. What does it say about colour?")
    result = await SynthesisAgent(tutor)(answer_state(lesson_context="Lesson: Labels",
                                                      answer_requested=True))
    system, payload = tutor.calls[0]
    assert system == TUTOR_SYSTEM and payload["lesson"] == "Lesson: Labels"
    assert payload["learner_asked_for_answer"] is True
    assert result["citations"] == [{"citation": 1}]
    ask = Recorder("Labels must be blue [1].")
    await SynthesisAgent(ask)(answer_state())
    assert ask.calls[0][0] != TUTOR_SYSTEM and "lesson" not in ask.calls[0][1]
    hint = Recorder("Which part of the lesson talks about colour?")
    guided = await SynthesisAgent(hint)(answer_state(lesson_context="Lesson: Labels"))
    assert guided["answer"].startswith("Which part") and guided["citations"] == []


def test_review_never_leaks_and_never_cuts_sentences():
    assert leaks("Try: return w * h", "return w * h")
    assert leaks("The answer is that labels help readers find parts quickly.", "Labels help readers find parts quickly")
    assert not leaks("Re-read [1]. What does the area formula multiply?", "return w * h")
    long = " ".join(["This sentence has exactly seven words here."] * 30)
    clipped = clip_sentences(long, 120)
    assert clipped.endswith(".") and len(clipped.split()) <= 120


# Routes ----------------------------------------------------------------------


class TutorStudy(MemoryLessons):
    def __init__(self):
        super().__init__()
        self.bindings: dict = {}
        self.attempts: list = []

    async def lesson_conversation(self, lesson_id):
        return self.bindings.get(lesson_id)

    async def bind_conversation(self, lesson_id, conversation_id):
        self.bindings.setdefault(lesson_id, conversation_id)

    async def your_turn_count(self, lesson_id):
        return sum(1 for a in self.attempts if a[0] == lesson_id)

    async def record_your_turn(self, lesson_id, answer, verdict, feedback, revealed):
        self.attempts.append((lesson_id, answer, verdict, feedback, revealed))
        return await self.your_turn_count(lesson_id)


class ChatStore:
    def __init__(self):
        self.threads: dict = {}
        self.saved = []

    async def conversation(self, thread_id, document_ids, signature, limit):
        if thread_id is None:
            thread_id = uuid4()
            self.threads[thread_id] = []
        return thread_id, 0, self.threads.get(thread_id, [])

    async def save_turn(self, thread_id, version, question, answer, citations, steps=None, warnings=None):
        self.saved.append((thread_id, question, answer))
        self.threads.setdefault(thread_id, []).extend(
            [{"role": "user", "content": question}, {"role": "assistant", "content": answer}])

    async def history(self, thread_id, before, limit):
        return [{"id": i, "role": m["role"], "content": m["content"], "citations": []}
                for i, m in enumerate(self.threads[thread_id], 1)]

    async def discard_empty(self, thread_id):
        pass


class FakeWorkflow:
    """Captures construction and initial state; answers like a grounded tutor."""

    created: list = []

    def __init__(self, providers, store, **kwargs):
        FakeWorkflow.created.append(kwargs)
        workflow = self

        class Graph:
            async def astream(self, state, stream_mode):
                workflow.state = state
                FakeWorkflow.created[-1]["state"] = state
                yield "updates", {"answer": {"status": "succeeded", "answer": "Look at [1].",
                                             "citations": [{"citation": 1, "document_id": "d"}]}}

        self.graph = Graph()


@pytest.fixture
def tutor_client(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "")
    settings.cache_clear()
    monkeypatch.setattr(api, "Workflow", FakeWorkflow)
    FakeWorkflow.created = []
    study, store = TutorStudy(), ChatStore()
    app.dependency_overrides[study_storage] = lambda: study
    app.dependency_overrides[storage] = lambda: store
    with TestClient(app) as client:
        app.state.study = study
        yield client, study, store
    app.dependency_overrides.clear()
    settings.cache_clear()


def ask(client, lesson_id, document_id, text="Why chunk?", thread=None):
    body = {"user_query": text, "document_ids": [str(document_id)], "lesson_id": str(lesson_id)}
    if thread:
        body["thread_id"] = thread
    return client.post("/query", json=body)


def test_lesson_query_is_scoped_web_free_and_bound(tutor_client):
    client, study, store = tutor_client
    lesson_id = study.add(status="in_progress", content_status="ready", content=stored_content())
    document_id = study.rows[lesson_id]["document_id"]
    first = ask(client, lesson_id, document_id)
    assert first.status_code == 200 and "event: result" in first.text
    created = FakeWorkflow.created[-1]
    assert created["web_client"] is None  # Master mode never searches the web.
    assert created["boost_sections"] == frozenset({"1"})
    state = created["state"]
    assert "Lesson: Labels" in state["lesson_context"] and state["answer_requested"] is False
    assert "SECRET" not in json.dumps(state, default=str)
    thread = study.bindings[lesson_id]
    assert store.saved[0][0] == thread
    # The next turn reuses the bound chat, with or without the thread id.
    ask(client, lesson_id, document_id, "Just tell me the answer")
    assert FakeWorkflow.created[-1]["state"]["answer_requested"] is True
    assert {s[0] for s in store.saved} == {thread}
    assert ask(client, lesson_id, document_id, thread=str(thread)).status_code == 200
    assert ask(client, lesson_id, document_id, thread=str(uuid4())).status_code == 409
    history = client.get(f"/lessons/{lesson_id}/conversation").json()
    assert history["thread_id"] == str(thread) and len(history["messages"]) == 6
    # Ask-mode queries are unchanged: web stays available, no lesson context.
    client.post("/query", json={"user_query": "q", "document_ids": [str(uuid4())]})
    assert "lesson_context" not in FakeWorkflow.created[-1]["state"]
    assert FakeWorkflow.created[-1]["boost_sections"] == frozenset()


def test_lesson_query_rejects_other_documents_and_locked_lessons(tutor_client):
    client, study, _ = tutor_client
    lesson_id = study.add(status="in_progress", content_status="ready", content=stored_content())
    locked = study.add(status="locked")
    document_id = study.rows[lesson_id]["document_id"]
    assert ask(client, lesson_id, uuid4()).status_code == 409
    both = client.post("/query", json={"user_query": "q", "lesson_id": str(lesson_id),
                                       "document_ids": [str(document_id), str(uuid4())]})
    assert both.status_code == 409
    assert ask(client, locked, study.rows[locked]["document_id"]).status_code == 409
    assert ask(client, uuid4(), document_id).status_code == 404
    assert not FakeWorkflow.created
    empty = client.get(f"/lessons/{lesson_id}/conversation").json()
    assert empty == {"thread_id": None, "messages": []}


def review_reply(verdict, feedback="Re-read the explanation. What does it say about labels?",
                 explanation="Labels name parts."):
    return json.dumps({"verdict": verdict, "feedback": feedback, "explanation": explanation})


def test_your_turn_verdicts_and_reveal_rules(tutor_client):
    client, study, _ = tutor_client
    lesson_id = study.add(status="in_progress", content_status="ready", content=stored_content())
    app.state.providers = ScriptedProvider([
        review_reply("correct", "Right: labels help readers find parts."),
        review_reply("incorrect"),
        review_reply("partial"),
        review_reply("incorrect"),
    ])
    right = client.post(f"/lessons/{lesson_id}/your-turn", json={"answer": "w * h"}).json()
    assert right["verdict"] == "correct" and right["reveal"] is None and right["attempt_number"] == 1
    wrong = client.post(f"/lessons/{lesson_id}/your-turn", json={"answer": "w + h"}).json()
    assert wrong["verdict"] == "incorrect" and wrong["reveal"] is None
    assert "SECRET" not in json.dumps(wrong)
    third = client.post(f"/lessons/{lesson_id}/your-turn", json={"answer": "w - h"}).json()
    assert third["verdict"] == "partial" and third["attempt_number"] == 3
    assert third["reveal"] == {"answer": "SECRET-SOLUTION", "explanation": "Labels name parts."}
    payload = json.loads(app.state.providers.calls[2][1])
    assert payload["reveal"] is True and payload["exercise"]["kind"] == "code_gap"
    assert payload["reference"] == "SECRET-SOLUTION"  # code_gap reviews the TODO(you) solution.
    # Explicit reveal on a fresh lesson's first attempt.
    other = study.add(status="in_progress", content_status="ready",
                      content=lesson_with_apply())
    asked = client.post(f"/lessons/{other}/your-turn", json={"answer": "idk", "reveal": True}).json()
    assert asked["reveal"]["answer"] == "SECRET-ANSWER"
    # Blank answer: reveal only on request, with no provider call.
    calls = len(app.state.providers.calls)
    blank = client.post(f"/lessons/{other}/your-turn", json={"answer": "  ", "reveal": True}).json()
    assert blank["verdict"] is None and blank["reveal"]["answer"] == "SECRET-ANSWER"
    assert len(app.state.providers.calls) == calls
    assert client.post(f"/lessons/{other}/your-turn", json={"answer": ""}).status_code == 422
    assert [a[4] for a in study.attempts] == [False, False, True, True, True]


def lesson_with_apply():
    from app.study.lesson_writer import build_evidence, review

    draft = review(json.dumps(lesson()), build_evidence([section()], 12000)[1], False, False)
    return draft.content.model_dump(mode="json")


def test_your_turn_hides_leaked_references_and_fails_safely(tutor_client):
    client, study, _ = tutor_client
    lesson_id = study.add(status="in_progress", content_status="ready", content=lesson_with_apply())
    app.state.providers = ScriptedProvider([
        review_reply("partial", "Close. The answer is SECRET-ANSWER, so add that."),
        "not json",
        ProviderError("down"),
    ])
    leaked = client.post(f"/lessons/{lesson_id}/your-turn", json={"answer": "labels"}).json()
    assert leaked["feedback"] == FALLBACK_GUIDANCE and leaked["reveal"] is None
    for _ in range(2):
        failed = client.post(f"/lessons/{lesson_id}/your-turn", json={"answer": "labels"})
        assert failed.status_code == 502
        assert failed.json()["detail"] == "Your answer could not be reviewed. Please retry."
    assert len(study.attempts) == 1  # Failed reviews are not counted as attempts.
    locked = study.add(status="locked", content_status="ready", content=lesson_with_apply())
    assert client.post(f"/lessons/{locked}/your-turn", json={"answer": "x"}).status_code == 409
    pending = study.add(status="in_progress")
    assert client.post(f"/lessons/{pending}/your-turn", json={"answer": "x"}).status_code == 409


def test_code_example_fixture_is_code_gap():
    content = stored_content()
    assert content["your_turn"]["kind"] == "code_gap"
    assert content["code_example"]["todo"]["reference_solution"] == code_example()["todo"]["reference_solution"]
    assert isinstance(UUID(str(uuid4())), UUID)
