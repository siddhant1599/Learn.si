import asyncio
import json
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from evals.e2e import citation_checks, consume, evaluate, run_case
from tests.test_golden import corpus as _corpus


@pytest.fixture
def corpus():
    return _corpus.__wrapped__()


def test_citation_scope_and_page_not_semantic_support(corpus):
    case, _, _, chunks = corpus
    citation = dict(document_id="doc", section_id="1", page=1, edition="v1")
    assert citation_checks(case, {"citations": [citation]}, chunks) == {
        "citation_identity_valid": True, "annotated_page_coverage": 1,
        "missing_expected_citations": False}
    assert not citation_checks(case, {"citations": [citation | {"document_id": "wrong"}]},
                               chunks)["citation_identity_valid"]
    assert not citation_checks(case, {"citations": [citation | {"edition": "v2"}]},
                               chunks)["citation_identity_valid"]


async def test_consume_sse_final_replacement():
    def handler(request):
        assert request.url.path == "/query"
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, text=(
            'event: token\ndata: {"delta":"old"}\n\n'
            'event: result\ndata: {"answer":"final", "citations":[]}\n\n'))
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler),
                                base_url="http://local") as client:
        check, timing = await consume(client, {})
    assert check.result["answer"] == "final"
    assert check.summary()["completed"]
    assert timing["first_token_seconds"] is not None


async def test_owned_conversation_cleaned_after_network_failure(corpus):
    case = corpus[0]
    case.document_id = "00000000-0000-0000-0000-000000000001"
    conn = SimpleNamespace(execute=AsyncMock())

    @asynccontextmanager
    async def connection():
        yield conn
    store = SimpleNamespace(pool=SimpleNamespace(connection=connection))

    def handler(request):
        raise httpx.ConnectError("secret exception")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler),
                                base_url="http://local") as client:
        row = await run_case(case, store, client, [], 1)
    calls = conn.execute.call_args_list
    assert "INSERT" in calls[0].args[0]
    assert "DELETE" in calls[1].args[0]
    assert calls[0].args[1][0] == calls[1].args[1][0]
    assert row["cleanup_ok"] and row["status"] == "error"
    assert "secret" not in str(row)


async def test_failed_insert_does_not_delete_other_thread(corpus):
    case = corpus[0]
    case.document_id = "00000000-0000-0000-0000-000000000001"
    conn = SimpleNamespace(execute=AsyncMock(side_effect=RuntimeError()))

    @asynccontextmanager
    async def connection():
        yield conn
    store = SimpleNamespace(pool=SimpleNamespace(connection=connection))
    row = await run_case(case, store, None, [], 1)
    assert conn.execute.await_count == 1
    assert not row["cleanup_ok"]


async def test_seeded_history_is_owned_and_cleaned(corpus):
    from evals.golden import HistoryTurn

    case = corpus[0]
    case.document_id = "00000000-0000-0000-0000-000000000001"
    case.history = [HistoryTurn(role="user", content="Prior private context")]
    conn = SimpleNamespace(execute=AsyncMock())

    @asynccontextmanager
    async def connection():
        yield conn

    def handler(request):
        raise httpx.ConnectError("offline")
    store = SimpleNamespace(pool=SimpleNamespace(connection=connection))
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler),
                                base_url="http://local") as client:
        row = await run_case(case, store, client, [], 1)
    calls = conn.execute.call_args_list
    assert len(calls) == 3
    assert "INSERT INTO rag.messages" in calls[1].args[0]
    assert calls[1].args[1][1:] == ("user", "Prior private context")
    assert calls[0].args[1][0] == calls[1].args[1][0] == calls[2].args[1][0]
    assert row["seeded_history_turns"] == 1 and row["cleanup_ok"]
    assert "Prior private" not in str(row)


def test_completed_answer_without_expected_sources_is_flagged(corpus):
    case, _, _, chunks = corpus
    result = citation_checks(case, {"answer": "Unsupported", "citations": []}, chunks)
    assert result["missing_expected_citations"]
    assert result["annotated_page_coverage"] == 0


@pytest.mark.parametrize("judge_fails", [False, True])
async def test_judge_keeps_app_completion_and_cleanup_separate(corpus, judge_fails):
    from tests.test_golden_grading import judgment

    case = corpus[0]
    case.document_id = "00000000-0000-0000-0000-000000000001"
    result = {"answer": "Port 1234 [1]", "citations": [{
        "document_id": case.document_id, "section_id": "1", "page": 1, "edition": "v1"}]}
    cursor = SimpleNamespace(fetchone=AsyncMock(return_value={
        "content": result["answer"], "citations": result["citations"]}))
    conn = SimpleNamespace(execute=AsyncMock(return_value=cursor))

    @asynccontextmanager
    async def connection():
        yield conn

    def handler(request):
        return httpx.Response(200, headers={"content-type": "text/event-stream"},
                              text=f"event: result\ndata: {json.dumps(result)}\n\n")

    provider = AsyncMock()
    provider.chat.return_value = judgment()
    if judge_fails:
        async def stall(*args):
            await asyncio.sleep(10)
        provider.chat.side_effect = stall
    store = SimpleNamespace(pool=SimpleNamespace(connection=connection))
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler),
                                base_url="http://local") as client:
        row = await run_case(case, store, client, corpus[3], .05, provider)
    assert row["status"] == "completed"
    assert row["cleanup_ok"] and row["persisted_view_matches"]
    assert row["semantic_judgment"]["status"] == ("error" if judge_fails else "scored")
    if judge_fails:
        assert row["semantic_judgment"]["reason"] == "judge_timeout"
    assert not row["semantic_judgment"]["release_gate"]
    assert "Port 1234" not in json.dumps(row)
    calls = conn.execute.call_args_list
    assert "DELETE" in calls[-1].args[0]
    assert calls[0].args[1][0] == calls[-1].args[1][0]


async def test_provider_reservations_stop_before_dispatch_and_judge_has_separate_budget(corpus):
    from tests.test_golden_reporting import row

    runner = AsyncMock(return_value=row())
    verify = AsyncMock()
    cap = dict(chat_calls=6, embedding_calls=13, web_calls=2)
    result = await evaluate([corpus[0]] * 4, runner, verify, max_requests=4,
                            per_request=cap, limits={k: v * 2 for k, v in cap.items()},
                            max_judge_calls=1)
    assert runner.await_count == 2
    assert verify.await_count == 4
    assert [c.args[1] for c in runner.call_args_list] == [True, False]
    assert result["judge_request_slots"] == 1
    assert result["summary"]["skip_reasons"] == {"provider_budget": 2}
    assert result["provider_attempts_reserved"]["chat_calls"] == 12


async def test_preflight_failure_makes_no_application_call(corpus):
    runner = AsyncMock()
    result = await evaluate([corpus[0]], runner, AsyncMock(side_effect=ValueError("private")),
                            max_requests=1, per_request={"chat_calls": 6},
                            limits={"chat_calls": 6})
    runner.assert_not_awaited()
    assert result["halted"] == "verification_failed"
    assert result["summary"]["attempted"] == 0
    assert "private" not in json.dumps(result)


@pytest.mark.parametrize("patch,expected", [
    ({"cleanup_ok": False}, "cleanup_failed"),
    ({"runtime_verified": False}, "runtime_mismatch"),
    ({"usage": {"chat_calls": 7}}, "provider_cap_exceeded"),
])
async def test_unsafe_outcomes_stop_remaining_requests(corpus, patch, expected):
    from tests.test_golden_reporting import row

    runner = AsyncMock(return_value=row(**patch))
    result = await evaluate([corpus[0], corpus[0]], runner, AsyncMock(), max_requests=2,
                            per_request={"chat_calls": 6}, limits={"chat_calls": 12})
    assert runner.await_count == 1
    assert result["halted"] == expected
    assert result["summary"]["skipped"] == 1


async def test_changed_binding_after_request_invalidates_outcome(corpus):
    from tests.test_golden_reporting import row

    runner = AsyncMock(return_value=row())
    result = await evaluate([corpus[0]], runner, AsyncMock(side_effect=[None, ValueError()]),
                            max_requests=1, per_request={"chat_calls": 6},
                            limits={"chat_calls": 6})
    assert result["summary"]["errors"] == 1
    assert result["summary"]["metrics"]["contract_pass_rate"] == 0
    assert not result["results"][0]["binding_verified"]


async def test_category_and_request_limits_have_explicit_skip_counts(corpus):
    from tests.test_golden_reporting import row

    runner = AsyncMock(return_value=row())
    cases = [corpus[0].model_copy(update={"category": "table"}), corpus[0], corpus[0]]
    result = await evaluate(cases, runner, AsyncMock(), max_requests=1, category="direct",
                            per_request={"chat_calls": 6}, limits={"chat_calls": 18})
    assert result["summary"]["skip_reasons"] == {"category_filter": 1, "request_budget": 1}
    assert result["categories"]["table"]["attempted"] == 0
