"""Ask chats are stored on the server: steps and warnings are saved with each answer,
the browser can choose a new chat's id, chats can be listed, and older browsers can
upload the steps they kept locally."""

import os
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient

import app.api as api
from app.api import app, record_step, storage
from app.config import settings
from app.storage import Storage
from scripts.migrate import migration_files


def test_record_step_keeps_latest_state_and_only_safe_fields():
    steps = {}
    record_step(steps, {"type": "progress", "version": 1, "step": "retrieve", "id": "retrieve",
                        "status": "started", "attempt": 0, "sequence": 1})
    record_step(steps, {"type": "progress", "version": 1, "step": "triage", "id": "triage",
                        "status": "completed", "attempt": 0, "sequence": 2, "outcome": "direct_retrieval"})
    record_step(steps, {"type": "progress", "version": 1, "step": "retrieve", "id": "retrieve",
                        "status": "completed", "attempt": 0, "sequence": 3, "count": 2,
                        "detail": "PRIVATE https://secret.example", "delta": "draft"})
    assert list(steps) == ["retrieve", "triage"]  # First-seen order, latest state.
    assert steps["retrieve"] == {"type": "progress", "version": 1, "step": "retrieve", "id": "retrieve",
                                 "status": "completed", "attempt": 0, "sequence": 3, "count": 2}


class ChatStore:
    def __init__(self):
        self.saved, self.conversation_calls, self.imported = [], [], []

    async def conversation(self, thread_id, document_ids, signature, limit, new_thread_id=None):
        self.conversation_calls.append((thread_id, new_thread_id))
        return thread_id or new_thread_id or uuid4(), 0, []

    async def save_turn(self, thread_id, version, question, answer, citations, steps=None, warnings=None):
        self.saved.append({"thread": thread_id, "answer": answer, "steps": steps, "warnings": warnings})

    async def discard_empty(self, thread_id):
        pass

    async def conversations(self, limit=200):
        return [{"id": UUID(int=1), "document_ids": [UUID(int=2)], "updated_at": "2026-11-17T10:00:00Z",
                 "first_question": "What is a Pod? " + "x" * 300, "message_count": 4}]

    async def import_steps(self, thread_id, answers):
        self.imported.append((thread_id, answers))
        return len(answers)


class FakeWorkflow:
    def __init__(self, providers, store, **kwargs):
        class Graph:
            async def astream(self, state, stream_mode):
                yield "custom", {"type": "progress", "version": 1, "step": "triage", "id": "triage",
                                 "status": "started", "attempt": 0, "sequence": 1}
                yield "custom", {"type": "progress", "version": 1, "step": "triage", "id": "triage",
                                 "status": "completed", "attempt": 0, "sequence": 2, "outcome": "direct_retrieval"}
                yield "updates", {"answer": {"status": "succeeded", "answer": "Blue [1].",
                                             "citations": [], "warnings": ["Evidence partial.", "Evidence partial."]}}

        self.graph = Graph()


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "")
    settings.cache_clear()
    monkeypatch.setattr(api, "Workflow", FakeWorkflow)
    store = ChatStore()
    app.dependency_overrides[storage] = lambda: store
    with TestClient(app) as test_client:
        yield test_client, store
    app.dependency_overrides.clear()
    settings.cache_clear()


def test_query_uses_the_browser_chosen_id_and_saves_steps_and_warnings(client):
    test_client, store = client
    chat = uuid4()
    response = test_client.post("/query", json={"user_query": "Q", "document_ids": [str(uuid4())],
                                                "new_thread_id": str(chat)})
    assert response.status_code == 200 and "event: result" in response.text
    assert store.conversation_calls == [(None, chat)]
    assert f'"thread_id": "{chat}"' in response.text
    saved = store.saved[-1]
    assert saved["steps"] == [{"type": "progress", "version": 1, "step": "triage", "id": "triage",
                               "status": "completed", "attempt": 0, "sequence": 2, "outcome": "direct_retrieval"}]
    assert saved["warnings"] == ["Evidence partial."]


def test_list_conversations_for_the_sidebar(client):
    test_client, _ = client
    [chat] = test_client.get("/conversations").json()
    assert chat["id"] == str(UUID(int=1)) and chat["document_ids"] == [str(UUID(int=2))]
    assert chat["title"].startswith("What is a Pod?") and len(chat["title"]) == 200
    assert chat["message_count"] == 4


def test_import_steps_keeps_only_known_short_fields(client):
    test_client, store = client
    chat = uuid4()
    body = {"answers": [{"content": "Blue [1].", "warnings": ["w"], "steps": [
        {"id": "triage", "kind": "search", "label": "Request routed", "status": "complete",
         "results": ["Direct document search"], "detail": "PRIVATE", "label2": "x"},
        {"id": "retrieve", "label": "x" * 400, "status": "complete"},
    ]}]}
    assert test_client.post(f"/conversations/{chat}/import-steps", json=body).json() == {"matched": 1}
    [(thread, [answer])] = store.imported
    assert thread == chat
    assert answer["steps"][0] == {"id": "triage", "kind": "search", "label": "Request routed",
                                  "status": "complete", "results": ["Direct document search"]}
    assert "label" not in answer["steps"][1]  # Overlong strings are dropped.


@pytest.mark.skipif(not os.getenv("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL not configured")
async def test_database_round_trip_list_and_import():
    dsn = os.environ["TEST_DATABASE_URL"]
    async with await psycopg.AsyncConnection.connect(dsn, prepare_threshold=None) as conn:
        for migration in migration_files():
            await conn.execute(migration.read_text())
        document, lesson_chat = uuid4(), uuid4()
        await conn.execute(
            "INSERT INTO rag.documents(id, title, edition, source_uri, embedding_signature) "
            "VALUES (%s, 'Chat history fixture', 'v1', '', 'sig')", (document,))
    store = Storage(dsn)
    await store.pool.open()
    try:
        chat = uuid4()
        thread, version, history = await store.conversation(None, [document], "sig", 8, new_thread_id=chat)
        assert (thread, version, history) == (chat, 0, [])
        # Retrying the first question with the same id continues the same chat.
        assert (await store.conversation(None, [document], "sig", 8, new_thread_id=chat))[0] == chat
        steps = [{"type": "progress", "version": 1, "step": "triage", "id": "triage", "status": "completed",
                  "attempt": 0, "sequence": 1, "outcome": "direct_retrieval"}]
        await store.save_turn(chat, 0, "What colour?", "Blue [1].", [], steps, ["Evidence partial."])
        await store.save_turn(chat, 1, "And red?", "No evidence.", [])
        [user, answer, *_] = await store.history(chat, 2**63 - 1, 20)
        assert user["steps"] == [] and answer["steps"] == steps and answer["warnings"] == ["Evidence partial."]
        # The list shows Ask chats with a completed turn, not empty chats or lesson tutor chats.
        empty, _, _ = await store.conversation(None, [document], "sig", 8, new_thread_id=uuid4())
        listed = {row["id"]: row for row in await store.conversations()}
        assert listed[chat]["first_question"] == "What colour?" and listed[chat]["message_count"] == 4
        assert empty not in listed
        # Older browsers' steps fill only answers that have none, matched by exact text.
        imported = [{"id": "answer", "label": "Answer prepared", "status": "complete"}]
        assert await store.import_steps(chat, [{"content": "No evidence.", "steps": imported},
                                               {"content": "Blue [1].", "steps": imported},
                                               {"content": "Unknown", "steps": imported}]) == 1
        history = await store.history(chat, 2**63 - 1, 20)
        assert history[3]["steps"] == imported and history[1]["steps"] == steps
    finally:
        async with await psycopg.AsyncConnection.connect(dsn, prepare_threshold=None) as conn:
            await conn.execute("DELETE FROM rag.conversations WHERE %s = ANY(document_ids)", (document,))
            await conn.execute("DELETE FROM rag.documents WHERE id=%s", (document,))
        await store.pool.close()
        del lesson_chat
