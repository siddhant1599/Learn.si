"""Budgeted local /query smoke evaluation with owned conversation cleanup.

Reports measure contracts and citation identity, not semantic correctness.
"""
import argparse
import asyncio
import hashlib
import json
import re
import time
from pathlib import Path
from urllib.parse import urlparse
from uuid import UUID, uuid4

import httpx

from app.config import settings
from app.storage import Storage
from app.uploads import extract_document
from evals.golden import Case, validate
from evals.retrieval import binding_matches, positive
from evals.stream import StreamCheck


def citation_checks(case, result, chunks):
    citations = result.get("citations", [])
    if not isinstance(citations, list):
        return {"citation_identity_valid": False, "annotated_page_coverage": None}
    documents = [c for c in citations if isinstance(c, dict) and c.get("source_type") != "web"]
    known = {(str(c["section_id"]), c["page"]) for c in chunks}
    valid = all(str(c.get("document_id")) == case.document_id
                and (c.get("section_id"), c.get("page")) in known
                and c.get("edition") == case.document_edition for c in documents)
    cited = {(c.get("section_id"), c.get("page")) for c in documents}
    expected = {(e.section_id, e.page) for e in case.evidence}
    return {"citation_identity_valid": valid,
            "annotated_page_coverage": len(cited & expected) / len(expected) if expected else None}


async def consume(client, body):
    check = StreamCheck()
    started = time.monotonic()
    first_token = None
    async with client.stream("POST", "/query", json=body) as response:
        response.raise_for_status()
        if "text/event-stream" not in response.headers.get("content-type", ""):
            raise ValueError("unexpected response type")
        async for line in response.aiter_lines():
            check.line(line)
            if check.tokens and first_token is None:
                first_token = time.monotonic() - started
    return check, {"elapsed_seconds": round(time.monotonic() - started, 3),
                   "first_token_seconds": round(first_token, 3) if first_token else None}


async def run_case(case, store, client, chunks, timeout):
    # Insert our UUID ourselves: never infer ownership from a server-supplied ID.
    thread = uuid4()
    owned = False
    row = {"category": case.category, "status": "error", "cleanup_ok": False}
    try:
        async with store.pool.connection() as conn:
            await conn.execute("INSERT INTO rag.conversations(id,document_ids) VALUES (%s,%s)",
                               (thread, [UUID(case.document_id)]))
        owned = True
        async with asyncio.timeout(timeout):
            check, timing = await consume(client, {
                "user_query": case.question, "document_ids": [case.document_id],
                "thread_id": str(thread)})
        summary = check.summary()
        row.update(summary | timing)
        result = check.result or {}
        row.update(citation_checks(case, result, chunks))
        row["status"] = "completed" if summary["completed"] else "error"
        # Inspect only our conversation; compare to the API's safe persistence view.
        async with store.pool.connection() as conn:
            cur = await conn.execute(
                "SELECT content,citations FROM rag.messages WHERE conversation_id=%s "
                "AND role='assistant' ORDER BY id DESC LIMIT 1", (thread,))
            saved = await cur.fetchone()
        expected_answer = result.get("persisted_answer", result.get("answer"))
        expected_citations = result.get("persisted_citations", result.get("citations"))
        row["persisted_view_matches"] = bool(saved and saved["content"] == expected_answer
                                              and saved["citations"] == expected_citations)
        row["persisted_web_citations"] = bool(saved and any(
            c.get("source_type") == "web" or "url" in c for c in saved["citations"]))
        row["persisted_urls"] = bool(saved and re.search(
            r"(?i)https?://|www\.", json.dumps(saved, default=str)))
        row["fallback_observed"] = bool(summary["web_attempts"])
        # A fallback after retrieval failure is not by itself a routing defect.
        row["fallback_correctness"] = "requires_evidence_review"
        usage = result.get("usage", {})
        row["usage"] = {key: value for key in ("chat_calls", "embedding_calls", "web_calls")
                        if type(value := usage.get(key)) is int and value >= 0}
    except Exception:
        # Never persist exceptions, raw results or questions.
        row["status"] = "error"
    finally:
        if owned:
            try:
                async with store.pool.connection() as conn:
                    await conn.execute("DELETE FROM rag.conversations WHERE id=%s", (thread,))
                row["cleanup_ok"] = True
            except Exception:
                row["cleanup_ok"] = False
    return row


async def run(args):
    parsed = urlparse(args.base_url)
    if parsed.scheme != "http" or parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise ValueError("only local app allowed")
    root = args.private_dir
    audit = json.loads((root / "source-audit.json").read_text())
    raw = (root / args.dataset).read_bytes()
    cases = [Case.model_validate_json(line) for line in raw.splitlines() if line.strip()]
    pdf = args.pdf.read_bytes()
    if not cases or hashlib.sha256(pdf).hexdigest() != audit["pdf_sha256"]:
        raise ValueError("invalid source")
    document = extract_document(args.pdf.name, pdf)
    chunks = json.loads((root / "sql-chunks.json").read_text())
    if validate(cases, audit, [{"page": s.page, "text": s.text} for s in document.sections],
                chunks, release=not args.allow_draft):
        raise ValueError("invalid or unapproved dataset")
    config = settings()
    store = Storage(config.database_url.get_secret_value())
    await store.pool.open()
    rows = []
    try:
        async with httpx.AsyncClient(base_url=args.base_url, timeout=args.timeout) as client:
            for case in cases:
                if (case.history or len(rows) >= args.max_requests
                        or args.category and case.category != args.category):
                    continue
                async with store.pool.connection() as conn:
                    cur = await conn.execute(
                        "SELECT id,edition,vector_generation,embedding_signature "
                        "FROM rag.documents WHERE id=%s", (UUID(case.document_id),))
                    doc = await cur.fetchone()
                    cur = await conn.execute(
                        "SELECT id,section_id,chunk_index,page,text FROM rag.chunks "
                        "WHERE document_id=%s", (UUID(case.document_id),))
                    current = await cur.fetchall()
                if not binding_matches(audit, doc, chunks, current):
                    raise ValueError("stale binding")
                rows.append(await run_case(case, store, client, chunks, args.timeout))
                if not rows[-1]["cleanup_ok"]:
                    break
    finally:
        await store.pool.close()
    return {"mode": "live_local_sse_smoke", "draft_allowed": args.allow_draft,
            "dataset_sha256": hashlib.sha256(raw).hexdigest(), "max_requests": args.max_requests,
            "timeout_per_request": args.timeout, "attempted": len(rows),
            "skipped": len(cases) - len(rows), "results": rows,
            "semantic_quality": "not_scored", "server_model_version": "not_exposed_by_api"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--private-dir", type=Path, required=True)
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--dataset", default="pilot.jsonl")
    parser.add_argument("--category", choices=list(Case.model_fields["category"].annotation.__args__))
    parser.add_argument("--max-requests", type=positive, required=True)
    parser.add_argument("--timeout", type=positive, default=240)
    parser.add_argument("--allow-draft", action="store_true")
    parser.add_argument("--base-url", default="http://127.0.0.1:8001")
    args = parser.parse_args()
    try:
        report = asyncio.run(run(args))
    except Exception:
        print(json.dumps({"error": "evaluation_failed", "details_redacted": True}))
        return 1
    print(json.dumps(report))
    return int(not report["results"] or any(
        r["status"] != "completed" or not r["cleanup_ok"] or not r["web_cap_valid"]
        or not r["citation_identity_valid"] or not r["persisted_view_matches"]
        or r["persisted_web_citations"] or r["persisted_urls"]
        or r.get("separate_sections") is False for r in report["results"]))


if __name__ == "__main__":
    raise SystemExit(main())
