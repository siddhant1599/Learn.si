"""Private source validation. Diagnostics never include questions or source text."""
import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError


class Evidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    page: int = Field(ge=1)
    section_id: str
    start_char: int = Field(ge=0)
    end_char: int = Field(gt=0)
    quote: str = Field(min_length=1)
    quote_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    chunk_ids: list[int] = Field(min_length=1)


class Review(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["assistant_source_reviewed_pending_human", "draft", "approved"]
    reviewer: str = Field(min_length=1)
    method: str = Field(min_length=1)
    independent: bool = False
    reviewed_at: str | None = None


class Case(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal["0.1-draft"]
    id: str = Field(min_length=1)
    category: Literal[
        "direct", "paraphrase", "cross_page", "table", "numeric_qualification",
        "configuration", "false_premise", "unanswerable", "follow_up", "adversarial",
    ]
    question: str = Field(min_length=1)
    history: list[dict[str, str]] = Field(default_factory=list)
    corpus_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    document_id: str
    document_edition: str
    expected_answerability: Literal[
        "sufficient", "partial", "not_in_document", "needs_clarification"
    ]
    required_facts: list[str]
    prohibited_claims: list[str]
    evidence: list[Evidence]
    expected_web_fallback: Literal[
        "avoid_if_retrieved", "attempt_if_available", "do_not_search_for_clarification"
    ]
    review: Review
    split: Literal["pilot-development", "development", "held-out"]
    group_id: str = Field(min_length=1)


def digest(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def validate(cases, audit, pages, chunks, *, release=False):
    """Validate all spans against frozen extraction and a scoped SQL snapshot.

    This does not assert current remote index freshness or semantic correctness.
    """
    errors = []
    seen, groups, questions = set(), {}, {}
    page_map = {p["page"]: p["text"] for p in pages}
    chunk_map = {c["id"]: c for c in chunks}
    for number, case in enumerate(cases, 1):
        def fail(code):
            errors.append({"row": number, "code": code})
        if case.id in seen:
            fail("duplicate_id")
        seen.add(case.id)
        split = "development" if case.split == "pilot-development" else case.split
        for key, mapping in ((case.group_id, groups),
                             (" ".join(case.question.casefold().split()), questions)):
            if key in mapping and mapping[key] != split:
                fail("split_leakage")
            mapping[key] = split
        doc = audit["document"]
        if (case.corpus_sha256 != audit["pdf_sha256"] or case.document_id != doc["id"]
                or case.document_edition != doc["edition"]):
            fail("stale_corpus")
        if release and (case.review.status != "approved" or not case.review.independent
                        or not case.review.reviewed_at):
            fail("independent_review_required")
        if case.expected_answerability in {"sufficient", "partial"}:
            if not case.evidence or not case.required_facts:
                fail("missing_ground_truth")
        if any(not f.strip() for f in case.required_facts + case.prohibited_claims):
            fail("empty_rubric")
        for ref in case.evidence:
            text = page_map.get(ref.page, "")
            if (ref.section_id != str(ref.page) or ref.end_char <= ref.start_char
                    or text[ref.start_char:ref.end_char] != ref.quote
                    or digest(ref.quote) != ref.quote_sha256):
                fail("invalid_span")
            for chunk_id in ref.chunk_ids:
                chunk = chunk_map.get(chunk_id)
                if (chunk is None or chunk["page"] != ref.page
                        or chunk["section_id"] != ref.section_id
                        or ref.quote not in chunk["text"]
                        or chunk.get("document_id", doc["id"]) != doc["id"]):
                    fail("invalid_chunk_binding")
    return errors


def retrieval_score(case, hits):
    """Exact scoped chunk matching; deduplicate before computing ranks.

    Evidence coverage measures annotated spans, not semantic answer correctness.
    """
    unique = []
    seen = set()
    for hit in hits:
        key = (str(hit["document_id"]), hit["id"])
        if key not in seen:
            seen.add(key)
            unique.append(key)
    targets = [{(case.document_id, i) for i in e.chunk_ids} for e in case.evidence]
    if not targets:
        return None
    relevant = set().union(*targets)
    rank = next((i for i, key in enumerate(unique, 1) if key in relevant), None)
    coverage = sum(bool(t.intersection(unique)) for t in targets) / len(targets)
    return {**{f"hit@{k}": int(rank is not None and rank <= k) for k in (1, 3, 5)},
            "mrr": 1 / rank if rank else 0, "evidence_coverage": coverage,
            "all_evidence": int(coverage == 1)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--private-dir", type=Path, required=True)
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--release", action="store_true")
    args = parser.parse_args()
    root = args.private_dir
    try:
        audit = json.loads((root / "source-audit.json").read_text())
        if hashlib.sha256(args.pdf.read_bytes()).hexdigest() != audit["pdf_sha256"]:
            raise ValueError("source mismatch")
        # Re-extract the actual PDF: never trust only a cached text snapshot.
        from app.uploads import extract_document
        document = extract_document(args.pdf.name, args.pdf.read_bytes())
        pages = [{"page": s.page, "text": s.text} for s in document.sections]
        chunks = json.loads((root / "sql-chunks.json").read_text())
        cases = [Case.model_validate_json(line) for line in
                 (root / "pilot.jsonl").read_text().splitlines() if line.strip()]
        errors = validate(cases, audit, pages, chunks, release=args.release)
        if not cases:
            errors.append({"row": 0, "code": "empty_dataset"})
        print(json.dumps({"cases": len(cases), "categories": dict(Counter(
            c.category for c in cases)), "review": dict(Counter(c.review.status for c in cases)),
            "errors": errors, "live_index_verified": False}))
        return int(bool(errors))
    except (OSError, ValueError, KeyError, TypeError, ValidationError):
        print(json.dumps({"error": "invalid_input_or_source", "details_redacted": True}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
