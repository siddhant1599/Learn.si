from unittest.mock import AsyncMock
from uuid import UUID

import pytest

from evals.retrieval import binding_matches, evaluate, summarize
from tests.test_golden import corpus as _corpus


@pytest.fixture
def corpus():
    return _corpus.__wrapped__()


@pytest.mark.asyncio
async def test_budget_and_uuid_hits(corpus):
    case = corpus[0]
    case.document_id = "00000000-0000-0000-0000-000000000001"
    embed = AsyncMock(return_value=[1])
    search = AsyncMock(return_value=[dict(document_id=UUID(case.document_id), id=1)])
    check = AsyncMock()
    result = await evaluate([case, case], search, embed, check, limit=1, timeout=1)
    assert result["embedding_attempts"] == 1
    assert result["summary"]["skipped"] == 1
    assert result["summary"]["metrics"]["hit@1"] == 1
    assert check.await_count == 2


@pytest.mark.asyncio
async def test_provider_error_redacted(corpus):
    case = corpus[0]
    embed = AsyncMock(side_effect=RuntimeError("private question https://secret.test token"))
    result = await evaluate([case], AsyncMock(), embed, AsyncMock(), limit=1, timeout=1)
    assert result["summary"]["errors"] == 1
    assert result["summary"]["metrics"] is None
    assert "secret" not in str(result)
    assert result["embedding_attempts"] == 1


@pytest.mark.asyncio
async def test_stale_binding_prevents_embedding(corpus):
    embed = AsyncMock()
    result = await evaluate([corpus[0]], AsyncMock(), embed,
                            AsyncMock(side_effect=ValueError()), limit=1, timeout=1)
    embed.assert_not_called()
    assert result["summary"]["errors"] == 1


@pytest.mark.asyncio
async def test_changed_binding_after_search_not_scored(corpus):
    case = corpus[0]
    case.document_id = "00000000-0000-0000-0000-000000000001"
    result = await evaluate([case], AsyncMock(return_value=[]), AsyncMock(return_value=[1]),
                            AsyncMock(side_effect=[None, ValueError()]), limit=1, timeout=1)
    assert result["summary"]["scored"] == 0
    assert result["summary"]["errors"] == 1


def test_binding_requires_generation_and_all_chunks():
    doc = dict(id="doc", edition="v", vector_generation="g", embedding_signature="e")
    chunk = dict(id=1, section_id="1", chunk_index=0, page=1, text="private")
    audit = dict(document=doc)
    assert binding_matches(audit, doc, [chunk], [chunk])
    assert not binding_matches(audit, doc | {"vector_generation": "new"}, [chunk], [chunk])
    assert not binding_matches(audit, doc, [chunk], [])
    assert not binding_matches(audit, doc, [chunk], [chunk | {"text": "different"}])
    assert not binding_matches(audit, None, [chunk], [chunk])


def test_no_empty_perfect_score():
    assert summarize([]) == dict(total=0, scored=0, errors=0, skipped=0, skip_reasons={}, metrics=None)


@pytest.mark.asyncio
async def test_timeout_is_error_and_does_not_retry(corpus):
    import asyncio

    async def slow(_):
        await asyncio.sleep(1)
    embed = AsyncMock(side_effect=slow)
    result = await evaluate([corpus[0]], AsyncMock(), embed, AsyncMock(),
                            limit=1, timeout=.001)
    assert result["summary"]["errors"] == 1
    assert embed.await_count == 1


@pytest.mark.asyncio
async def test_history_and_negative_are_explicitly_skipped(corpus):
    case = corpus[0]
    followup = case.model_copy(update={"history": [{"role": "user", "content": "prior"}]})
    negative = case.model_copy(update={"expected_answerability": "not_in_document"})
    embed = AsyncMock()
    result = await evaluate([followup, negative], AsyncMock(), embed, AsyncMock(),
                            limit=2, timeout=1)
    embed.assert_not_called()
    assert result["summary"]["skip_reasons"] == {
        "requires_history": 1, "not_positive_retrieval": 1}
