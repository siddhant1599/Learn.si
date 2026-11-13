"""Deterministic citation structure checks, not semantic claim validation."""
import re

from app.citations import references


def answer_sections(answer):
    """Require ordered, unique, standalone headings and nonempty section bodies."""
    if not isinstance(answer, str):
        return None
    headings = list(re.finditer(r"^## From (your documents|the web)[ \t]*\r?$", answer, re.M))
    if (len(headings) != 2 or [h[1] for h in headings] != ["your documents", "the web"]
            or answer[:headings[0].start()].strip()):
        return None
    documents = answer[headings[0].end():headings[1].start()].strip()
    web = answer[headings[1].end():].strip()
    return (documents, web) if documents and web else None


def web_answer_expected(result):
    citations = result.get("citations", [])
    has_web = isinstance(citations, list) and any(
        isinstance(c, dict) and c.get("source_type") == "web" for c in citations)
    usage = result.get("usage", {})
    attempts = usage.get("web_calls", 0) if isinstance(usage, dict) else 0
    return has_web or "persisted_answer" in result or (type(attempts) is int and attempts > 0)


def citation_checks(case, result, chunks):
    answer = result.get("answer")
    citations = result.get("citations")
    well_formed = isinstance(citations, list) and all(isinstance(c, dict) for c in citations)
    citations = citations if well_formed else []
    catalog, documents, web = {}, [], set()
    valid_catalog = well_formed
    for citation in citations:
        number = citation.get("citation")
        kind = citation.get("source_type", "document")
        if (type(number) is not int or number < 1 or number in catalog
                or kind not in ("document", "web")):
            valid_catalog = False
            continue
        catalog[number] = citation
        if kind == "web":
            web.add(number)
        else:
            documents.append(citation)

    known = {(str(c["section_id"]), c["page"]) for c in chunks
             if str(c.get("document_id", case.document_id)) == case.document_id}
    valid_documents = [c for c in documents
                       if str(c.get("document_id")) == case.document_id
                       and isinstance(c.get("section_id"), str) and type(c.get("page")) is int
                       and (c["section_id"], c["page"]) in known
                       and c.get("edition") == case.document_edition]
    identity_valid = valid_catalog and len(valid_documents) == len(documents)
    answer_valid = isinstance(answer, str) and bool(answer.strip())
    used = references(answer) if answer_valid else set()
    references_valid = valid_catalog and answer_valid and used == set(catalog)

    document_refs = {c["citation"] for c in documents}
    document_used = used
    sections_valid = True
    if web_answer_expected(result):
        sections = answer_sections(answer)
        document_used = references(sections[0]) if sections else set()
        web_used = references(sections[1]) if sections else set()
        sections_valid = bool(sections) and document_used <= document_refs and web_used <= web
    cited = {(c["section_id"], c["page"]) for c in valid_documents
             if c["citation"] in document_used}
    expected = {(e.section_id, e.page) for e in case.evidence}
    return {
        "citation_identity_valid": identity_valid,
        "citation_references_valid": references_valid,
        "citation_sections_valid": sections_valid,
        "missing_expected_citations": not expected.issubset(cited),
        "annotated_page_coverage": len(cited & expected) / len(expected) if expected else None,
    }
