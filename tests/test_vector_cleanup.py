"""Cleanup transactions retain failed work and protect the active generation."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app import vector_cleanup as cleanup


class Connection:
    def __init__(self, rows):
        self.rows = iter(rows)
        self.calls = []
        self.failed = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, kind, value, traceback):
        self.failed = kind is not None

    async def execute(self, sql, params):
        self.calls.append((sql, params))
        rows = next(self.rows, [])
        return SimpleNamespace(
            fetchall=AsyncMock(return_value=rows),
            fetchone=AsyncMock(return_value=rows[0] if rows else None),
        )


@pytest.mark.parametrize("locked", [True, False])
async def test_cleanup_protects_active_generation_and_respects_writer_lock(monkeypatch, locked):
    doc, active, orphan = uuid4(), uuid4(), uuid4()
    listing = Connection([[(doc,)]])
    work = Connection([[(locked,)], [(active,)], [(active,), (orphan,)], [], []])
    monkeypatch.setattr(
        cleanup.psycopg.AsyncConnection, "connect", AsyncMock(side_effect=[listing, work])
    )
    vectors = SimpleNamespace(delete_generation=AsyncMock())
    config = SimpleNamespace(
        database_url=SimpleNamespace(get_secret_value=lambda: "unused"),
        pinecone_index="index",
        pinecone_namespace="namespace",
    )
    await cleanup.reconcile(config, vectors)
    if locked:
        vectors.delete_generation.assert_awaited_once_with(doc, orphan)
        assert sum(sql.startswith("DELETE") for sql, _ in work.calls) == 2
    else:
        vectors.delete_generation.assert_not_awaited()
        assert len(work.calls) == 1


async def test_failed_delete_rolls_back_journal_and_retry_succeeds(monkeypatch):
    doc, orphan = uuid4(), uuid4()
    first = Connection([[(True,)], [], [(orphan,)]])
    retry = Connection([[(True,)], [], [(orphan,)], []])
    monkeypatch.setattr(
        cleanup.psycopg.AsyncConnection,
        "connect",
        AsyncMock(side_effect=[Connection([[(doc,)]]), first, Connection([[(doc,)]]), retry]),
    )
    vectors = SimpleNamespace(
        delete_generation=AsyncMock(side_effect=[RuntimeError("offline"), None])
    )
    config = SimpleNamespace(
        database_url=SimpleNamespace(get_secret_value=lambda: "unused"),
        pinecone_index="index",
        pinecone_namespace="namespace",
    )
    await cleanup.attempt_cleanup(config, vectors)
    assert first.failed
    assert not any(sql.startswith("DELETE") for sql, _ in first.calls)
    await cleanup.attempt_cleanup(config, vectors)
    assert not retry.failed
    assert any(sql.startswith("DELETE") for sql, _ in retry.calls)
    assert vectors.delete_generation.await_count == 2


@pytest.mark.parametrize("failure", ["upsert", "visibility", "cancel", "none"])
async def test_ingestion_compensation_real_transactions(monkeypatch, failure):
    import asyncio
    import os
    from pathlib import Path

    import psycopg

    from app.config import Settings
    from app.models import Document
    from scripts import ingest as ingestion

    if not os.getenv("TEST_DATABASE_URL"):
        pytest.skip("TEST_DATABASE_URL not configured")
    dsn = os.environ["TEST_DATABASE_URL"]
    config = Settings(_env_file=None, database_url=dsn, vector_backend="pinecone")
    doc = Document(
        id=uuid4(),
        title="Disposable cleanup fixture",
        edition="v1",
        sections=[{"id": "1", "number": "1", "text": "Fixture evidence"}],
    )
    vectors = SimpleNamespace(
        upsert=AsyncMock(), wait_visible=AsyncMock(), delete_generation=AsyncMock()
    )
    monkeypatch.setattr(ingestion, "PineconeVectors", lambda *_: vectors)
    providers = SimpleNamespace(client=None, embed=AsyncMock(return_value=[1.0] + [0.0] * 767))
    async with await psycopg.AsyncConnection.connect(dsn, prepare_threshold=None) as conn:
        await conn.execute((Path(__file__).parents[1] / "migrations/001_initial.sql").read_text())
    try:
        await ingestion.ingest(doc, config, providers)
        async with await psycopg.AsyncConnection.connect(dsn) as conn:
            active = (
                await (
                    await conn.execute(
                        "SELECT vector_generation FROM rag.documents WHERE id=%s", (doc.id,)
                    )
                ).fetchone()
            )[0]
        vectors.delete_generation.reset_mock()
        error = (
            asyncio.CancelledError() if failure == "cancel" else RuntimeError("synthetic failure")
        )
        if failure == "upsert":
            vectors.upsert.side_effect = error
        elif failure in ("visibility", "cancel"):
            vectors.wait_visible.side_effect = error
        # Force compensation to fail first; the SQL journal must survive rollback.
        vectors.delete_generation.side_effect = RuntimeError("synthetic cleanup outage")
        if failure != "none":
            with pytest.raises(type(error)):
                await ingestion.ingest(doc, config, providers)
        else:
            await ingestion.ingest(doc, config, providers)
        async with await psycopg.AsyncConnection.connect(dsn) as conn:
            current = (
                await (
                    await conn.execute(
                        "SELECT vector_generation FROM rag.documents WHERE id=%s", (doc.id,)
                    )
                ).fetchone()
            )[0]
            queued = await (
                await conn.execute(
                    "SELECT generation FROM rag.vector_cleanup WHERE document_id=%s", (doc.id,)
                )
            ).fetchall()
        assert queued
        assert (current == active) == (failure != "none")
        vectors.delete_generation.side_effect = None
        vectors.delete_generation.reset_mock()
        await cleanup.reconcile(config, vectors, doc.id)
        assert vectors.delete_generation.await_count >= 1
        assert all(
            call.args[0] == doc.id and call.args[1] != current
            for call in vectors.delete_generation.await_args_list
        )
        async with await psycopg.AsyncConnection.connect(dsn) as conn:
            assert not await (
                await conn.execute(
                    "SELECT generation FROM rag.vector_cleanup WHERE document_id=%s", (doc.id,)
                )
            ).fetchall()
    finally:
        async with await psycopg.AsyncConnection.connect(dsn) as conn:
            await conn.execute("DELETE FROM rag.vector_cleanup WHERE document_id=%s", (doc.id,))
            await conn.execute("DELETE FROM rag.documents WHERE id=%s", (doc.id,))
