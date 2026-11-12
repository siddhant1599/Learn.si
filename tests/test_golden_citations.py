import json

import pytest

from evals.citations import answer_sections, citation_checks
from evals.reporting import contract_pass
from tests.test_golden import corpus as _corpus
from tests.test_golden_reporting import row


@pytest.fixture
def corpus():
    return _corpus.__wrapped__()


def source(number=1, page=1, **patch):
    return dict(citation=number, source_type="document", document_id="doc",
                section_id=str(page), page=page, edition="v1") | patch


def test_partial_required_pages_fail_even_with_one_valid_reference(corpus):
    case, _, _, chunks = corpus
    case.evidence.append(case.evidence[0].model_copy(update={"page": 2, "section_id": "2"}))
    chunks.append(dict(id=2, section_id="2", page=2))
    result = citation_checks(case, {"answer": "First fact [1]", "citations": [source()]}, chunks)
    assert result["annotated_page_coverage"] == .5
    assert result["missing_expected_citations"]
    assert not contract_pass(row(**result))
    complete = citation_checks(case, {
        "answer": "First fact [1], second fact [2]", "citations": [source(), source(2, 2)]}, chunks)
    assert complete["annotated_page_coverage"] == 1
    assert contract_pass(row(**complete))


@pytest.mark.parametrize("answer", ["Fact [999]", "Fact without references", "Fact [1] and [9]"])
def test_catalog_presence_does_not_validate_missing_or_invented_references(corpus, answer):
    case, _, _, chunks = corpus
    result = citation_checks(case, {"answer": answer, "citations": [source()]}, chunks)
    assert not result["citation_references_valid"]
    assert not contract_pass(row(**result))


@pytest.mark.parametrize("citations", [None, {}, [None], [source(), source()],
    [source(citation=True)], [source(citation="1")], [source(citation=0)],
    [source(source_type="unknown")], [source(section_id=[])], [source(page=True)]])
def test_malformed_citation_catalog_fails_without_leaking_payloads(corpus, citations):
    case, _, _, chunks = corpus
    result = citation_checks(case, {"answer": "Private fact [1]", "citations": citations}, chunks)
    assert not contract_pass(row(**result))
    assert "Private fact" not in json.dumps(result)


def test_wrong_document_does_not_contribute_page_coverage(corpus):
    case, _, _, chunks = corpus
    result = citation_checks(case, {"answer": "Fact [1]",
        "citations": [source(document_id="other")]}, chunks)
    assert not result["citation_identity_valid"]
    assert result["annotated_page_coverage"] == 0
    assert result["missing_expected_citations"]


def test_duplicate_spans_on_same_page_need_one_page_reference(corpus):
    case, _, _, chunks = corpus
    case.evidence.append(case.evidence[0].model_copy())
    result = citation_checks(case, {"answer": "Fact [1]", "citations": [source()]}, chunks)
    assert result["annotated_page_coverage"] == 1
    assert not result["missing_expected_citations"]


@pytest.mark.parametrize("doc_refs,web_refs,valid", [
    ("[1]", "[2]", True), ("[2]", "[1]", False), ("[1][2]", "[2]", False),
    ("[1]", "[1][2]", False), ("[1]", "[999]", False),
])
def test_citations_must_belong_to_the_section_where_they_appear(corpus, doc_refs, web_refs, valid):
    case, _, _, chunks = corpus
    result = citation_checks(case, {
        "answer": f"## From your documents\nLocal fact {doc_refs}\n\n"
                  f"## From the web\nPublic fact {web_refs}",
        "citations": [source(), dict(citation=2, source_type="web", url="https://example.com")],
    }, chunks)
    assert result["citation_sections_valid"] is valid
    assert contract_pass(row(**result)) is valid
    assert "example.com" not in json.dumps(result)


@pytest.mark.parametrize("answer", [
    "## From the web\nWeb\n## From your documents\nDoc",
    "## From your documents\nDoc\n## From the web\nWeb\n## From the web\nMore",
    "Inline ## From your documents and ## From the web",
    "## From your documents\n\n## From the web\nWeb",
    "## From your documents\nDoc\n## From the web\n",
    "Extra unsegregated claim\n## From your documents\nDoc\n## From the web\nWeb",
])
def test_deceptive_or_empty_section_headings_rejected(answer):
    assert answer_sections(answer) is None


def test_crlf_section_boundaries_and_uncited_abstention(corpus):
    case, _, _, chunks = corpus
    case.evidence = []
    answer = "## From your documents\r\nNo evidence.\r\n## From the web\r\nNo evidence."
    assert answer_sections(answer) == ("No evidence.", "No evidence.")
    result = citation_checks(case, {"answer": answer, "citations": [],
                                    "persisted_answer": "safe stored view"}, chunks)
    assert result["annotated_page_coverage"] is None
    assert contract_pass(row(**result))
