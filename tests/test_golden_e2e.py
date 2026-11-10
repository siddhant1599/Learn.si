from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from evals.e2e import citation_checks, consume, run_case
from tests.test_golden import corpus as _corpus


@pytest.fixture
def corpus():
    return _corpus.__wrapped__()


def test_citation_scope_and_page_not_semantic_support(corpus):
    case, _, _, chunks = corpus
    citation = dict(document_id="doc", section_id="1", page=1, edition="v1")
    assert citation_checks(case, {"citations": [citation]}, chunks) == {
        "citation_identity_valid": True, "annotated_page_coverage": 1}
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
