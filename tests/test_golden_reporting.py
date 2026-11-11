import json
from copy import deepcopy

import pytest

from evals.reporting import compare_e2e, contract_pass, summarize


def row(**patch):
    return dict(row=1, category="direct", status="completed", cleanup_ok=True,
                runtime_verified=True, binding_verified=True, usage_limits_valid=True,
                citation_identity_valid=True, web_cap_valid=True, persisted_view_matches=True,
                missing_expected_citations=False, persisted_web_citations=False,
                persisted_urls=False, separate_sections=None, annotated_page_coverage=1,
                usage=dict(chat_calls=2, embedding_calls=1, web_calls=0), web_attempts=0,
                elapsed_seconds=2, first_token_seconds=1) | patch


def report(rows=None):
    return {"report_version": 2, "manifest": {
        "dataset_sha256": "dataset", "corpus_sha256": "corpus", "index_binding_sha256": "index",
        "selection": {"max_requests": 2}, "draft_allowed": True, "evaluator_sha256": "evaluator",
        "judge_model": None, "server": {"source_sha256": "source", "instance_id": "one",
                                       "config": {"model": "configured"}, "python_version": "3.12"}},
        "results": rows if rows is not None else [row()]}


def test_errors_and_unknown_usage_are_not_zero_cost_passes():
    summary = summarize([row(), dict(row=2, category="direct", status="error"),
                         dict(row=3, category="direct", status="skipped", reason="request_budget")])
    assert summary["metrics"]["completion_rate"] == .5
    assert summary["metrics"]["contract_pass_rate"] == .5
    assert summary["metric_denominators"]["annotated_page_coverage"] == 1
    assert summary["provider_usage"]["chat_calls"] == {
        "reported_total": 2, "reported_cases": 1, "unknown_cases": 1}
    assert summary["skipped"] == 1
    assert summary["latency"]["elapsed_seconds"] == {"count": 1, "p50": 2, "p95": 2}
    assert summarize([])["metrics"]["completion_rate"] is None


@pytest.mark.parametrize("key", ["runtime_verified", "binding_verified", "cleanup_ok",
                                 "citation_identity_valid", "usage_limits_valid"])
def test_contract_requires_verification(key):
    assert contract_pass(row())
    assert not contract_pass(row(**{key: False}))
    missing = row()
    del missing[key]
    assert not contract_pass(missing)


def test_compare_allows_build_change_and_reports_error_delta():
    before = report([row(), row(row=2)])
    after = deepcopy(before)
    after["manifest"]["server"].update(instance_id="two", source_sha256="new-source")
    after["results"][1] = dict(row=2, category="direct", status="error")
    compared = compare_e2e(before, after)
    aggregate = compared["categories"]["all"]
    assert aggregate["error_delta"] == 1
    assert aggregate["metrics"]["completion_rate"]["delta"] == -.5
    assert aggregate["metrics"]["annotated_page_coverage"]["delta"] is None
    assert compared["quality_gate"] == "not_calibrated"


@pytest.mark.parametrize("key", ["dataset_sha256", "selection", "evaluator_sha256", "judge_model"])
def test_incompatible_e2e_comparison_rejected(key):
    before, after = report(), report()
    after["manifest"][key] = "different"
    with pytest.raises(ValueError):
        compare_e2e(before, after)


def test_equal_denominator_with_different_scored_cases_not_compared():
    before = report([row(), dict(row=2, category="direct", status="error")])
    after = report([dict(row=1, category="direct", status="error"), row(row=2)])
    result = compare_e2e(before, after)
    metrics = result["categories"]["all"]["metrics"]
    assert metrics["completion_rate"]["delta"] == 0
    assert metrics["annotated_page_coverage"] == {
        "delta": None, "before_count": 1, "after_count": 1}


def test_comparison_rejects_different_attempted_cohort_and_duplicate_rows():
    with pytest.raises(ValueError):
        compare_e2e(report(), report([row(row=2)]))
    with pytest.raises(ValueError):
        compare_e2e(report([row(), row()]), report([row(), row()]))


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -1, 2, True])
def test_invalid_quality_metrics_rejected(value):
    with pytest.raises(ValueError):
        summarize([row(annotated_page_coverage=value)])


def test_comparison_does_not_copy_raw_answer_or_url_fields():
    before = report([row(answer="private answer", url="https://private.test")])
    result = compare_e2e(before, deepcopy(before))
    assert "private" not in json.dumps(result)
