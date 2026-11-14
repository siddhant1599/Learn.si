"""Progress comes from real execution and never contains user/provider text."""

import asyncio
import json
from types import SimpleNamespace

import pytest

from app import progress as activity
from app.agents.nodes import RetrievalAgent
from app.progress import TrackedAgent


async def test_concurrent_tasks_emit_running_before_completion(monkeypatch):
    events, entered = [], []
    release = asyncio.Event()
    monkeypatch.setattr(activity, "get_stream_writer", lambda: events.append)

    async def search(queries, ids):
        entered.append(queries)
        await release.wait()
        return [], []

    agent = TrackedAgent("retrieve", RetrievalAgent(SimpleNamespace(search=search)))
    state = {
        "question": "PRIVATE QUESTION",
        "searches": ["PRIVATE QUERY"],
        "document_ids": [],
        "research_plan": [
            {"id": f"q{i}", "question": "PRIVATE QUERY", "dependencies": []} for i in (1, 2)
        ],
    }
    task = asyncio.create_task(agent(state))
    for _ in range(100):
        if len(entered) == 2:
            break
        await asyncio.sleep(0.001)
    assert len(entered) == 2 and not task.done()
    assert {e["id"] for e in events if e["status"] == "started"} == {
        "retrieve",
        "retrieve:q1",
        "retrieve:q2",
    }
    release.set()
    await task
    assert {e["id"] for e in events if e["status"] == "completed"} == {
        "retrieve",
        "retrieve:q1",
        "retrieve:q2",
    }
    assert [e["sequence"] for e in events] == list(range(1, len(events) + 1))
    assert "PRIVATE" not in json.dumps(events)
    assert all(e.get("count", 0) == 0 for e in events)


async def test_cancel_settles_active_children_without_success(monkeypatch):
    events = []
    monkeypatch.setattr(activity, "get_stream_writer", lambda: events.append)
    started = asyncio.Event()

    async def agent(state):
        activity.progress("started", "q1")
        started.set()
        await asyncio.Event().wait()

    task = asyncio.create_task(TrackedAgent("retrieve", agent)({}))
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert not any(e["status"] == "completed" for e in events)
    assert {e["id"] for e in events if e["status"] == "stopped"} == {"retrieve", "retrieve:q1"}


async def test_retry_identifiers_and_allowlisted_outcomes(monkeypatch):
    events = []
    monkeypatch.setattr(activity, "get_stream_writer", lambda: events.append)

    async def agent(state):
        activity.progress("started", "https://private.example")
        return {"route": "SECRET PROVIDER CONTENT"}

    tracked = TrackedAgent("triage", agent)
    await tracked({})
    await tracked({"recovery_attempts": 1})
    assert [e["attempt"] for e in events] == [0, 0, 4, 4]
    assert "SECRET" not in json.dumps(events) and "https://" not in json.dumps(events)
    assert activity.current.get() is None


async def test_graph_separates_activity_from_tokens():
    from app.workflow import Workflow
    from tests.test_core import FakeSearch, hit
    from tests.test_streaming import StreamingProvider

    provider = StreamingProvider(
        [
            '{"sub_questions":[{"id":"q1","question":"q","objective":"Find supporting evidence","dependencies":[]}]}',
            '{"sufficient":true}',
        ]
    )
    events = [
        event
        async for event in Workflow(
            provider, FakeSearch([hit()]), stream_answer=True
        ).graph.astream(
            {"question": "q", "history": "", "document_ids": [hit()["document_id"]]},
            stream_mode=["updates", "custom"],
        )
    ]
    custom = [value for mode, value in events if mode == "custom"]
    assert custom[0]["type"] == "progress" and custom[0]["status"] == "started"
    assert any(e.get("step") == "answer" and e["status"] == "started" for e in custom)
    assert all("delta" not in e for e in custom if e.get("type") == "progress")
    assert any("delta" in e for e in custom)


@pytest.mark.parametrize("sufficient", [True, False])
async def test_web_activity_is_conditional_and_has_no_web_content(sufficient):
    import httpx

    from app.web_search import TavilySearch
    from app.workflow import Workflow
    from tests.test_core import FakeSearch, hit
    from tests.test_web_search import EXCERPT, URL, Provider, initial, response

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda r: httpx.Response(200, json=response()))
    ) as client:
        workflow = Workflow(
            Provider(sufficient=sufficient),
            FakeSearch([hit()]),
            web_client=TavilySearch("fake", client),
        )
        events = [
            e async for e in workflow.graph.astream(initial(), stream_mode=["updates", "custom"])
        ]
    progress = [
        value for mode, value in events if mode == "custom" and value.get("type") == "progress"
    ]
    web = [e for e in progress if e["step"] == "web"]
    assert bool(web) is not sufficient
    assert URL not in json.dumps(progress) and EXCERPT not in json.dumps(progress)
    assert "PRIVATE HISTORY" not in json.dumps(progress)
    if web:
        assert any(e["id"] == "web:wq1" and e["status"] == "started" for e in web)
        assert any(e["id"] == "web:check-wq1" and e["status"] == "completed" for e in web)
