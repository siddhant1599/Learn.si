"""Durable, generation-scoped compensation for external vector writes.

Writers and cleaners share the document advisory lock. A journal row is committed
on a separate connection before upsert, while the writer holds that lock. A
cleaner cannot race an in-flight writer or delete a generation committed after an
ambiguous connection failure. Entries contain IDs only, never source text/keys.
"""

import asyncio
import logging

import psycopg

from app.pinecone import PineconeVectors

logger = logging.getLogger(__name__)


async def journal(config, document_id, generations):
    async with await psycopg.AsyncConnection.connect(
        config.database_url.get_secret_value(), prepare_threshold=None
    ) as conn:
        for generation in generations:
            if generation:
                await conn.execute(
                    "INSERT INTO rag.vector_cleanup(document_id,generation,index_name,namespace) "
                    "VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                    (document_id, generation, config.pinecone_index, config.pinecone_namespace),
                )


async def reconcile(config, vectors, document_id=None):
    async with await psycopg.AsyncConnection.connect(
        config.database_url.get_secret_value(), prepare_threshold=None
    ) as conn:
        cur = await conn.execute(
            "SELECT DISTINCT document_id FROM rag.vector_cleanup "
            "WHERE index_name=%s AND namespace=%s "
            "AND (%s::uuid IS NULL OR document_id=%s) LIMIT 100",
            (config.pinecone_index, config.pinecone_namespace, document_id, document_id),
        )
        documents = [row[0] for row in await cur.fetchall()]
    for doc in documents:
        async with await psycopg.AsyncConnection.connect(
            config.database_url.get_secret_value(), prepare_threshold=None
        ) as conn:
            cur = await conn.execute(
                "SELECT pg_try_advisory_xact_lock(hashtextextended(%s, 0))", (str(doc),)
            )
            if not (await cur.fetchone())[0]:
                continue
            cur = await conn.execute(
                "SELECT vector_generation FROM rag.documents WHERE id=%s", (doc,)
            )
            row = await cur.fetchone()
            active = row[0] if row else None
            cur = await conn.execute(
                "SELECT generation FROM rag.vector_cleanup WHERE document_id=%s "
                "AND index_name=%s AND namespace=%s",
                (doc, config.pinecone_index, config.pinecone_namespace),
            )
            for (generation,) in await cur.fetchall():
                if generation != active:
                    await vectors.delete_generation(doc, generation)
                await conn.execute(
                    "DELETE FROM rag.vector_cleanup WHERE document_id=%s AND generation=%s "
                    "AND index_name=%s AND namespace=%s",
                    (doc, generation, config.pinecone_index, config.pinecone_namespace),
                )


async def attempt_cleanup(config, vectors, document_id=None):
    try:
        async with asyncio.timeout(10):
            await reconcile(config, vectors, document_id)
    except Exception:
        # Keep the journal for the next pass. Never hide the original ingest error.
        logger.warning("Vector cleanup pending; durable journal retained")


async def cleanup_loop(config, client):
    vectors = PineconeVectors(config, client)
    while True:
        await attempt_cleanup(config, vectors)
        await asyncio.sleep(60)
