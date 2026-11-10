import pytest
from pydantic import ValidationError

from evals.golden import Case, digest, retrieval_score, validate


@pytest.fixture
def corpus():
    text = "The fictional server uses port 1234."
    ref = dict(page=1, section_id="1", start_char=0, end_char=len(text),
               quote=text, quote_sha256=digest(text), chunk_ids=[1])
    case = Case(schema_version="0.1-draft", id="synthetic-1", category="direct",
                question="Which port?", corpus_sha256="a" * 64, document_id="doc",
                document_edition="v1", expected_answerability="sufficient",
                required_facts=["Port 1234"], prohibited_claims=[], evidence=[ref],
                expected_web_fallback="avoid_if_retrieved",
                review=dict(status="draft", reviewer="author", method="synthetic"),
                split="development", group_id="port")
    audit = dict(pdf_sha256="a" * 64, document=dict(id="doc", edition="v1"))
    pages = [dict(page=1, text=text)]
    chunks = [dict(id=1, page=1, section_id="1", text=text)]
    return case, audit, pages, chunks


def test_valid_source(corpus):
    case, *source = corpus
    assert validate([case], *source) == []


def test_draft_excluded_from_release(corpus):
    case, *source = corpus
    assert validate([case], *source, release=True)[0]["code"] == "independent_review_required"


def test_review_requires_independence_and_date(corpus):
    case, *source = corpus
    case.review.status = "approved"
    assert validate([case], *source, release=True)
    case.review.independent = True
    case.review.reviewed_at = "2026-11-09"
    assert not validate([case], *source, release=True)


@pytest.mark.parametrize("field,value", [("page", 2), ("section_id", "1.2"),
    ("quote_sha256", "b" * 64), ("end_char", 2), ("chunk_ids", [99])])
def test_bad_reference(corpus, field, value):
    case, *source = corpus
    setattr(case.evidence[0], field, value)
    assert validate([case], *source)


def test_checks_second_reference(corpus):
    case, *source = corpus
    bad = case.evidence[0].model_copy(update={"chunk_ids": [99]})
    case.evidence.append(bad)
    assert validate([case], *source)


@pytest.mark.parametrize("field,value", [("corpus_sha256", "b" * 64),
    ("document_id", "other"), ("document_edition", "v2")])
def test_stale_scope(corpus, field, value):
    case, *source = corpus
    setattr(case, field, value)
    assert validate([case], *source)[0]["code"] == "stale_corpus"


def test_duplicates_and_family_leakage(corpus):
    case, *source = corpus
    other = case.model_copy(update={"split": "held-out"})
    codes = {e["code"] for e in validate([case, other], *source)}
    assert codes == {"duplicate_id", "split_leakage"}


def test_wrong_document_chunk(corpus):
    case, audit, pages, chunks = corpus
    chunks[0]["document_id"] = "another"
    assert validate([case], audit, pages, chunks)


@pytest.mark.parametrize("patch", [{"category": "invented"}, {"id": ""},
    {"schema_version": "2"}, {"unexpected": True}])
def test_schema(corpus, patch):
    data = corpus[0].model_dump() | patch
    with pytest.raises(ValidationError):
        Case.model_validate(data)


def test_ranking_deduplicates_and_scopes(corpus):
    case = corpus[0]
    hits = [dict(document_id="other", id=1)] * 3 + [dict(document_id="doc", id=1)]
    result = retrieval_score(case, hits)
    assert result == {"hit@1": 0, "hit@3": 1, "hit@5": 1, "mrr": .5,
                      "evidence_coverage": 1, "all_evidence": 1}


def test_partial_evidence(corpus):
    case = corpus[0]
    case.evidence.append(case.evidence[0].model_copy(update={"chunk_ids": [2]}))
    assert retrieval_score(case, [dict(document_id="doc", id=1)])["evidence_coverage"] == .5
    assert retrieval_score(case, [dict(document_id="doc", id=1)])["all_evidence"] == 0


def test_empty_results_and_negative(corpus):
    case = corpus[0]
    assert retrieval_score(case, [])["mrr"] == 0
    case.evidence = []
    assert retrieval_score(case, []) is None
