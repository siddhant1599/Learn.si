"""Bounded, read-only retrieval evaluation. Outputs aggregate metrics only."""
import argparse
import asyncio
import hashlib
import json
import subprocess
import time
from collections import Counter, defaultdict
from pathlib import Path
from uuid import UUID

import httpx

from app.config import settings
from app.pinecone import PineconeVectors
from app.providers import Providers
from app.storage import Storage
from app.uploads import extract_document
from evals.golden import Case, retrieval_score, validate


def summarize(rows):
    successful = [r["metrics"] for r in rows if r["status"] == "scored"]
    return {
        "total": len(rows), "scored": len(successful),
        "errors": sum(r["status"] == "error" for r in rows),
        "skipped": sum(r["status"] == "skipped" for r in rows),
        "skip_reasons": dict(Counter(r["reason"] for r in rows if r["status"] == "skipped")),
        "metrics": {key: (sum(values) / len(values) if values else None)
                    for key in set().union(*(r.keys() for r in successful))
                    if (values := [r[key] for r in successful if r.get(key) is not None])
                    or key == "fact_evidence_coverage"} if successful else None,
        "metric_denominators": {key: sum(r.get(key) is not None for r in successful)
                                for key in set().union(*(r.keys() for r in successful))},
    }


async def evaluate(cases, search, embed, check_binding, *, limit, timeout):
    """No retries; each eligible case consumes at most one embedding call.

    Follow-ups need orchestration/history resolution and are excluded here.
    """
    rows = []
    calls = 0
    for case in cases:
        row = {"category": case.category}
        if (case.history or not case.evidence or case.expected_answerability not in
                {"sufficient", "partial"} or calls >= limit):
            reason = ("requires_history" if case.history else
                      "not_positive_retrieval" if not case.evidence or
                      case.expected_answerability not in {"sufficient", "partial"} else
                      "call_budget")
            rows.append(row | {"status": "skipped", "reason": reason})
            continue
        try:
            async with asyncio.timeout(timeout):
                await check_binding()
                calls += 1
                vector = await embed(case.question)
                hits = await search(case.question, [UUID(case.document_id)], vector)
                await check_binding()
                metrics = retrieval_score(case, hits)
            rows.append(row | {"status": "scored", "metrics": metrics})
        except Exception:
            # Never include provider exceptions, questions, snippets or URLs in reports.
            rows.append(row | {"status": "error"})
    categories = defaultdict(list)
    for row in rows:
        categories[row["category"]].append(row)
    return {"summary": summarize(rows),
            "categories": {key: summarize(value) for key, value in categories.items()},
            "embedding_attempts": calls}


def binding_matches(audit, document, snapshot, current):
    if document is None:
        return False
    expected = audit["document"]
    if any(str(document[key]) != str(expected[key]) for key in
           ("id", "edition", "vector_generation", "embedding_signature")):
        return False
    fields = ("id", "section_id", "chunk_index", "page", "text")
    return sorted(tuple(c[k] for k in fields) for c in snapshot) == sorted(
        tuple(c[k] for k in fields) for c in current)


def implementation_fingerprint():
    files = sorted([*Path("evals").glob("*.py"), *Path("app").rglob("*.py")])
    return hashlib.sha256(b"".join(
        str(p).encode() + b"\0" + p.read_bytes() for p in files)).hexdigest()


async def run(args):
    implementation_hash = implementation_fingerprint()
    root = args.private_dir
    raw_cases = (root / args.dataset).read_bytes()
    cases = [Case.model_validate_json(line) for line in raw_cases.splitlines() if line.strip()]
    if not cases:
        raise ValueError("empty dataset")
    audit = json.loads((root / "source-audit.json").read_text())
    pdf = args.pdf.read_bytes()
    if hashlib.sha256(pdf).hexdigest() != audit["pdf_sha256"]:
        raise ValueError("stale source")
    document = extract_document(args.pdf.name, pdf)
    snapshot = json.loads((root / "sql-chunks.json").read_text())
    pages = [{"page": s.page, "text": s.text} for s in document.sections]
    if validate(cases, audit, pages, snapshot, release=not args.allow_draft):
        raise ValueError("invalid or unapproved dataset")
    config = settings()
    if config.embedding_signature != audit["document"]["embedding_signature"]:
        raise ValueError("embedding version mismatch")
    async with httpx.AsyncClient(timeout=min(args.timeout, 45)) as client:
        vectors = PineconeVectors(config, client) if config.vector_backend == "pinecone" else None
        store = Storage(config.database_url.get_secret_value(), vectors)
        providers = Providers(config, client)
        await store.pool.open()
        try:
            async def check():
                async with store.pool.connection() as conn:
                    cur = await conn.execute(
                        "SELECT id,edition,vector_generation,embedding_signature "
                        "FROM rag.documents WHERE id=%s", (UUID(audit["document"]["id"]),))
                    doc = await cur.fetchone()
                    cur = await conn.execute(
                        "SELECT id,section_id,chunk_index,page,text FROM rag.chunks "
                        "WHERE document_id=%s", (UUID(audit["document"]["id"]),))
                    current = await cur.fetchall()
                if not binding_matches(audit, doc, snapshot, current):
                    raise ValueError("stale binding")
            await check()
            started = time.monotonic()
            result = await evaluate(cases, store.search, providers.embed, check,
                                    limit=args.max_calls, timeout=args.timeout)
            result["elapsed_seconds"] = round(time.monotonic() - started, 3)
        finally:
            await store.pool.close()
    if implementation_fingerprint() != implementation_hash:
        raise ValueError("implementation changed during evaluation")
    result["manifest"] = {
        "dataset_sha256": hashlib.sha256(raw_cases).hexdigest(),
        "corpus_sha256": audit["pdf_sha256"], "embedding": config.embedding_signature,
        "backend": config.vector_backend, "draft_allowed": args.allow_draft,
        "code_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
        "implementation_sha256": implementation_hash,
        "working_tree_dirty": bool(subprocess.check_output(
            ["git", "status", "--porcelain"], text=True)),
        "max_embedding_calls": args.max_calls, "per_case_timeout": args.timeout,
        "index_binding_sha256": hashlib.sha256(json.dumps(
            audit["document"], sort_keys=True).encode()).hexdigest(),
    }
    return result


def positive(value):
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("must be positive")
    return number


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--private-dir", type=Path, required=True)
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--dataset", default="pilot.jsonl")
    parser.add_argument("--max-calls", type=positive, required=True)
    parser.add_argument("--timeout", type=positive, default=60)
    parser.add_argument("--allow-draft", action="store_true")
    args = parser.parse_args()
    try:
        result = asyncio.run(run(args))
    except Exception:
        print(json.dumps({"error": "evaluation_preflight_failed", "details_redacted": True}))
        return 1
    print(json.dumps(result))
    return int(result["summary"]["errors"] > 0 or result["summary"]["scored"] == 0)


if __name__ == "__main__":
    raise SystemExit(main())
