"""Single-owner deletion, durable tombstones and document-scoped compensation."""

import asyncio


async def delete_chat(store, thread_id):
    async with store.pool.connection() as conn:
        await conn.execute(
            "INSERT INTO rag.deletions(kind,id) VALUES ('conversation',%s) ON CONFLICT DO NOTHING",
            (thread_id,),
        )
        await conn.execute("DELETE FROM rag.conversations WHERE id=%s", (thread_id,))
    return {"status": "deleted", "id": str(thread_id)}


async def state(store):
    async with store.pool.connection() as conn:
        cur = await conn.execute("SELECT kind,id,pending FROM rag.deletions")
        return await cur.fetchall()


async def delete_document(store, config, document_id):
    async with store.pool.connection() as conn:
        # Fail clearly during indexing rather than waiting behind a long provider call.
        cur = await conn.execute(
            "SELECT pg_try_advisory_xact_lock(hashtextextended(%s,0)) AS locked",
            (str(document_id),),
        )
        if not (await cur.fetchone())["locked"]:
            from app.storage import Conflict

            raise Conflict("Document is being indexed. Retry deletion when indexing finishes.")
        await conn.execute(
            "INSERT INTO rag.deletions(kind,id,pending,index_name,namespace) "
            "VALUES ('document',%s,%s,%s,%s) ON CONFLICT DO NOTHING",
            (
                document_id,
                store.vectors is not None,
                config.pinecone_index,
                config.pinecone_namespace,
            ),
        )
        await conn.execute("DELETE FROM rag.documents WHERE id=%s", (document_id,))
    await retry_documents(store, config, document_id)
    async with store.pool.connection() as conn:
        cur = await conn.execute(
            "SELECT pending FROM rag.deletions WHERE kind='document' AND id=%s", (document_id,)
        )
        pending = (await cur.fetchone())["pending"]
    return {"id": str(document_id), "status": "cleanup_pending" if pending else "deleted"}


async def retry_documents(store, config, document_id=None):
    async with store.pool.connection() as conn:
        cur = await conn.execute(
            "SELECT id FROM rag.deletions WHERE kind='document' AND pending "
            "AND index_name=%s AND namespace=%s AND (%s::uuid IS NULL OR id=%s)",
            (config.pinecone_index, config.pinecone_namespace, document_id, document_id),
        )
        ids = [row["id"] for row in await cur.fetchall()]
    for doc in ids:
        try:
            async with asyncio.timeout(10):
                async with store.pool.connection() as conn:
                    cur = await conn.execute(
                        "SELECT pg_try_advisory_xact_lock(hashtextextended(%s,0)) AS locked",
                        (str(doc),),
                    )
                    if not (await cur.fetchone())["locked"]:
                        continue
                    if store.vectors is None:
                        continue  # Never claim remote cleanup when the provider is unavailable.
                    await store.vectors.delete_document(doc)
                    await conn.execute(
                        "DELETE FROM rag.vector_cleanup WHERE document_id=%s AND index_name=%s AND namespace=%s",
                        (doc, config.pinecone_index, config.pinecone_namespace),
                    )
                    await conn.execute(
                        "UPDATE rag.deletions SET pending=false WHERE kind='document' AND id=%s",
                        (doc,),
                    )
        except Exception:
            # The tombstone and pending flag survive; no sensitive provider errors escape.
            continue


async def cleanup_loop(store, config):
    while True:
        try:
            await retry_documents(store, config)
        except Exception:
            pass  # Database unavailable: retry without losing durable state.
        await asyncio.sleep(30)
