"""Deletion integration uses only generated IDs in TEST_DATABASE_URL."""

import asyncio
import os
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import psycopg
import pytest

from app.config import Settings
from app.deletions import delete_chat, delete_document, retry_documents, state
from app.models import Document
from app.storage import Conflict, NotFound, Storage
from scripts.ingest import ingest


@pytest.mark.skipif(not os.getenv("TEST_DATABASE_URL"), reason="Dedicated test database required")
async def test_deletion_lifecycle_and_races():
    dsn = os.environ["TEST_DATABASE_URL"]
    config = Settings(_env_file=None, database_url=dsn)
    store = Storage(dsn)
    await store.pool.open()
    doc = Document(
        id=uuid4(),
        title="Disposable deletion fixture",
        edition="test",
        sections=[{"id": "1", "number": "1", "text": "Synthetic evidence"}],
    )
    other = doc.model_copy(update={"id": uuid4()})
    provider = SimpleNamespace(embed=AsyncMock(return_value=[1.0] + [0.0] * 767))
    thread = None
    try:
        async with await psycopg.AsyncConnection.connect(dsn, prepare_threshold=None) as conn:
            await conn.execute(
                (Path(__file__).parents[1] / "migrations/001_initial.sql").read_text()
            )
        await ingest(doc, config, provider)
        await ingest(other, config, provider)
        thread, version, _ = await store.conversation(
            None, [doc.id], config.embedding_signature, 10
        )
        await store.save_turn(thread, version, "Synthetic question", "Saved answer", [])
        # A concurrent writer holds the same lock: deletion must fail clearly.
        async with await psycopg.AsyncConnection.connect(dsn) as writer:
            await writer.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended(%s,0))", (str(doc.id),)
            )
            with pytest.raises(Conflict, match="indexed"):
                await delete_document(store, config, doc.id)
        vectors = SimpleNamespace(
            delete_document=AsyncMock(side_effect=RuntimeError("private provider error"))
        )
        store.vectors = vectors
        result = await delete_document(store, config, doc.id)
        assert result["status"] == "cleanup_pending"
        assert any(d["id"] == doc.id and d["pending"] for d in await state(store))
        assert doc.id not in {d["id"] for d in await store.documents()}
        assert other.id in {d["id"] for d in await store.documents()}
        assert len(await store.history(thread, 2**63 - 1, 20)) == 2
        with pytest.raises(Conflict, match="source was deleted"):
            await store.save_turn(thread, 1, "Late question", "Late answer", [])
        with pytest.raises(NotFound):
            await store.conversation(thread, [doc.id], config.embedding_signature, 10)
        with pytest.raises(Conflict, match="deleted"):
            await ingest(doc, config, provider)
        vectors.delete_document.side_effect = None
        await retry_documents(store, config)
        vectors.delete_document.assert_awaited_with(doc.id)
        assert (await delete_document(store, config, doc.id))["status"] == "deleted"
        assert all(call.args == (doc.id,) for call in vectors.delete_document.await_args_list)
        await asyncio.gather(delete_chat(store, thread), delete_chat(store, thread))
        with pytest.raises(NotFound):
            await store.history(thread, 2**63 - 1, 20)
        with pytest.raises(Conflict):
            await store.save_turn(thread, 1, "late", "late", [])
        assert other.id in {d["id"] for d in await store.documents()}
        async with await psycopg.AsyncConnection.connect(dsn) as conn:
            assert not await (
                await conn.execute("SELECT 1 FROM rag.chunks WHERE document_id=%s", (doc.id,))
            ).fetchone()
            assert not await (
                await conn.execute("SELECT 1 FROM rag.messages WHERE conversation_id=%s", (thread,))
            ).fetchone()
    finally:
        async with await psycopg.AsyncConnection.connect(dsn) as conn:
            if thread:
                await conn.execute("DELETE FROM rag.conversations WHERE id=%s", (thread,))
            await conn.execute("DELETE FROM rag.documents WHERE id=ANY(%s)", ([doc.id, other.id],))
            await conn.execute(
                "DELETE FROM rag.deletions WHERE id=ANY(%s)",
                ([doc.id, other.id] + ([thread] if thread else []),),
            )
        await store.pool.close()


async def test_vector_deletion_exact_scope():
    from app.pinecone import PineconeVectors

    vectors = PineconeVectors(SimpleNamespace(), None)
    vectors.data = AsyncMock()
    doc = uuid4()
    await vectors.delete_document(doc)
    vectors.data.assert_awaited_once_with(
        "/vectors/delete", {"filter": {"document_id": {"$eq": str(doc)}}}
    )


async def test_delete_routes_validation_pending_and_safe_errors(monkeypatch):
    import httpx

    from app import api
    from app.api import app, storage

    store = SimpleNamespace()
    app.dependency_overrides[storage] = lambda: store
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            assert (await client.delete("/documents/not-a-uuid")).status_code == 422
            doc = uuid4()
            remove = AsyncMock(return_value={"status": "cleanup_pending", "id": str(doc)})
            monkeypatch.setattr(api.deletions, "delete_document", remove)
            response = await client.delete(f"/documents/{doc}")
            assert response.status_code == 202
            assert remove.await_args.args[2] == doc
            remove.side_effect = Conflict("Indexing in progress")
            assert (await client.delete(f"/documents/{doc}")).status_code == 409
            remove.side_effect = RuntimeError("secret-credential")
            response = await client.delete(f"/documents/{doc}")
            assert response.status_code == 503 and "secret-credential" not in response.text
            monkeypatch.setattr(
                api.deletions, "delete_chat", AsyncMock(return_value={"status": "deleted"})
            )
            assert (await client.delete(f"/conversations/{uuid4()}")).status_code == 200
    finally:
        app.dependency_overrides.clear()
