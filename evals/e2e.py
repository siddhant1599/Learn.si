"""Budgeted local /query smoke evaluation with owned conversation cleanup.

Reports measure contracts and citation identity; optional semantic scores remain uncalibrated.
"""
import argparse
import asyncio
import hashlib
import json
import re
import time
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlparse
from uuid import UUID, uuid4

import httpx

from app.config import settings
from app.providers import Providers
from app.runtime import RuntimeManifest, source_fingerprint
from app.storage import Storage
from app.uploads import extract_document
from evals.citations import citation_checks
from evals.golden import Case, validate
from evals.grading import grade
from evals.reporting import contract_pass, summarize
from evals.retrieval import binding_matches, implementation_fingerprint, positive
from evals.stream import StreamCheck


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


async def run_case(case, store, client, chunks, timeout, judge=None, runtime_id=None):
    # Insert our UUID ourselves: never infer ownership from a server-supplied ID.
    thread = uuid4()
    owned = False
    row = {"category": case.category, "status": "error", "cleanup_ok": False}
    try:
        async with store.pool.connection() as conn:
            await conn.execute("INSERT INTO rag.conversations(id,document_ids) VALUES (%s,%s)",
                               (thread, [UUID(case.document_id)]))
        owned = True
        async with store.pool.connection() as conn:
            for turn in case.history:
                await conn.execute(
                    "INSERT INTO rag.messages(conversation_id,role,content,citations) "
                    "VALUES (%s,%s,%s,'[]'::jsonb)", (thread, turn.role, turn.content))
        row["seeded_history_turns"] = len(case.history)
        async with asyncio.timeout(timeout):
            check, timing = await consume(client, {
                "user_query": case.question, "document_ids": [case.document_id],
                "thread_id": str(thread)})
        summary = check.summary()
        row.update(summary | timing)
        row["runtime_verified"] = runtime_id is not None and check.runtime_id == runtime_id
        result = check.result or {}
        row.update(citation_checks(case, result, chunks))
        row["status"] = "completed" if summary["completed"] else "error"
        if judge is not None and summary["completed"]:
            try:
                async with asyncio.timeout(timeout):
                    row["semantic_judgment"] = await grade(case, result["answer"], judge)
            except TimeoutError:
                row["semantic_judgment"] = {"status": "error", "reason": "judge_timeout",
                                            "release_gate": False}
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
        row["usage"] = dict(check.usage)
        if summary["completed"] and summary["web_cap_valid"]:
            # The API omits web_calls only when no web attempt was made.
            row["usage"].setdefault("web_calls", summary["web_attempts"])
        elif "web_calls" not in row["usage"]:
            row["web_attempts"] = None
    except TimeoutError:
        row["status"] = "error"
        row["reason"] = "request_timeout"
    except Exception:
        # Never persist exceptions, raw results or questions.
        row["status"] = "error"
        row["reason"] = "request_failed"
    finally:
        if owned:
            try:
                async with store.pool.connection() as conn:
                    await conn.execute("DELETE FROM rag.conversations WHERE id=%s", (thread,))
                row["cleanup_ok"] = True
            except Exception:
                row["cleanup_ok"] = False
    return row


async def evaluate(cases, runner, verify, *, max_requests, per_request, limits,
                   category=None, max_judge_calls=None):
    """Reserve worst-case provider attempts before dispatch; never retry a case."""
    rows, reserved = [], dict.fromkeys(per_request, 0)
    attempted, judge_slots = 0, 0
    halted = None
    for number, case in enumerate(cases, 1):
        identity = {"row": number, "category": case.category}
        reason = (halted if halted else "category_filter" if category and case.category != category
                  else "request_budget" if attempted >= max_requests
                  else "provider_budget" if any(reserved[k] + v > limits[k]
                                                 for k, v in per_request.items()) else None)
        if reason:
            rows.append(identity | {"status": "skipped", "reason": reason})
            continue
        try:
            await verify()
        except Exception:
            halted = "verification_failed"
            rows.append(identity | {"status": "skipped", "reason": halted})
            continue
        for key, value in per_request.items():
            reserved[key] += value
        attempted += 1
        use_judge = max_judge_calls is not None and judge_slots < max_judge_calls
        judge_slots += int(use_judge)
        row = await runner(case, use_judge)
        row.update(identity)
        row["binding_verified"] = False
        try:
            await verify()
            row["binding_verified"] = True
        except Exception:
            row.update(status="error", reason="verification_failed")
            halted = "verification_failed"
        row["usage_limits_valid"] = all(
            key in row.get("usage", {}) and row["usage"][key] <= value
            for key, value in per_request.items())
        if not row.get("cleanup_ok"):
            halted = "cleanup_failed"
        elif not row.get("runtime_verified"):
            halted = "runtime_mismatch"
        elif any(row.get("usage", {}).get(k, 0) > v for k, v in per_request.items()):
            halted = "provider_cap_exceeded"
        rows.append(row)
    categories = defaultdict(list)
    for row in rows:
        categories[row["category"]].append(row)
    return {"results": rows, "summary": summarize(rows),
            "categories": {key: summarize(value) for key, value in categories.items()},
            "provider_attempts_reserved": reserved, "judge_request_slots": judge_slots,
            "halted": halted}


async def run(args):
    implementation_hash = implementation_fingerprint()
    evaluator_hash = hashlib.sha256(b"".join(
        p.name.encode() + b"\0" + p.read_bytes() for p in sorted(Path("evals").glob("*.py")))).hexdigest()
    parsed = urlparse(args.base_url)
    if (parsed.scheme != "http" or parsed.hostname not in {"localhost", "127.0.0.1", "::1"}
            or parsed.username or parsed.password or parsed.query or parsed.fragment):
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
    try:
        async with httpx.AsyncClient(base_url=args.base_url, timeout=args.timeout) as client:
            async def fetch_runtime():
                response = await client.get("/evaluation/runtime")
                response.raise_for_status()
                return RuntimeManifest.model_validate(response.json())

            runtime = await fetch_runtime()
            if (runtime.source_sha256 != source_fingerprint()
                    or runtime.config.embedding != audit["document"]["embedding_signature"]):
                raise ValueError("server or embedding mismatch")

            async def verify():
                if await fetch_runtime() != runtime:
                    raise ValueError("server changed during run")
                async with store.pool.connection() as conn:
                    cur = await conn.execute(
                        "SELECT id,edition,vector_generation,embedding_signature "
                        "FROM rag.documents WHERE id=%s", (UUID(audit["document"]["id"]),))
                    doc = await cur.fetchone()
                    cur = await conn.execute(
                        "SELECT id,section_id,chunk_index,page,text FROM rag.chunks "
                        "WHERE document_id=%s", (UUID(audit["document"]["id"]),))
                    current = await cur.fetchall()
                if not binding_matches(audit, doc, chunks, current):
                    raise ValueError("stale binding")

            async def runner(case, use_judge):
                judge = Providers(config, client) if use_judge else None
                return await run_case(case, store, client, chunks, args.timeout, judge,
                                      str(runtime.instance_id))

            per_request = {"chat_calls": runtime.config.chat_call_limit,
                           "embedding_calls": runtime.config.embedding_call_limit,
                           "web_calls": 2 if runtime.config.web_available else 0}
            limits = {key: (getattr(args, flag) if getattr(args, flag) is not None
                            else args.max_requests * value)
                      for key, value, flag in (
                          ("chat_calls", per_request["chat_calls"], "max_chat_calls"),
                          ("embedding_calls", per_request["embedding_calls"], "max_embedding_calls"),
                          ("web_calls", per_request["web_calls"], "max_web_calls"))}
            await verify()
            result = await evaluate(cases, runner, verify, max_requests=args.max_requests,
                                    per_request=per_request, limits=limits,
                                    category=args.category, max_judge_calls=args.max_judge_calls)
            await verify()
    finally:
        await store.pool.close()
    if implementation_fingerprint() != implementation_hash:
        raise ValueError("implementation changed during evaluation")
    result.update(report_version=3, mode="live_local_sse_evaluation", manifest={
        "evaluator_sha256": evaluator_hash, "implementation_sha256": implementation_hash,
        "corpus_sha256": audit["pdf_sha256"], "dataset_sha256": hashlib.sha256(raw).hexdigest(),
        "index_binding_sha256": hashlib.sha256(json.dumps(
            {"document": audit["document"], "chunks": chunks}, sort_keys=True).encode()).hexdigest(),
        "draft_allowed": args.allow_draft, "server": runtime.model_dump(mode="json"),
        "selection": {"category": args.category, "max_requests": args.max_requests,
                      "provider_limits": limits, "per_request_timeout": args.timeout,
                      "max_judge_calls": args.max_judge_calls},
        "judge_model": config.openrouter_model if result["judge_request_slots"] else None,
        "semantic_quality": "uncalibrated_judge" if result["judge_request_slots"] else "not_scored",
        "provider_model_revision": "not_exposed_by_provider",
    })
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--private-dir", type=Path, required=True)
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--dataset", default="pilot.jsonl")
    parser.add_argument("--category", choices=list(Case.model_fields["category"].annotation.__args__))
    parser.add_argument("--max-requests", type=positive, required=True)
    parser.add_argument("--max-judge-calls", type=positive, default=None)
    parser.add_argument("--max-chat-calls", type=positive)
    parser.add_argument("--max-embedding-calls", type=positive)
    parser.add_argument("--max-web-calls", type=positive)
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
    return int(report["halted"] is not None or not report["summary"]["attempted"]
               or any(not contract_pass(r) for r in report["results"] if r["status"] != "skipped"))


if __name__ == "__main__":
    raise SystemExit(main())
