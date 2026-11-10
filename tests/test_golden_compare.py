from copy import deepcopy

import pytest

from evals.compare import METRICS, compare


def report():
    return {"manifest": {key: "same" for key in (
        "dataset_sha256", "corpus_sha256", "embedding", "backend", "draft_allowed",
        "max_embedding_calls", "per_case_timeout", "index_binding_sha256")},
        "summary": {"metrics": dict.fromkeys(METRICS, .5)},
        "categories": {"direct": {"total": 2, "scored": 2, "errors": 0, "skipped": 0}}}


def test_deltas_without_invented_gate():
    before = report()
    after = deepcopy(before)
    after["summary"]["metrics"]["mrr"] = .75
    assert compare(before, after)["metric_deltas"]["mrr"] == .25
    assert compare(before, after)["quality_gate"] == "not_calibrated"


@pytest.mark.parametrize("key", ["dataset_sha256", "embedding", "index_binding_sha256"])
def test_incompatible_versions(key):
    before, after = report(), report()
    after["manifest"][key] = "different"
    with pytest.raises(ValueError):
        compare(before, after)


def test_changed_denominator_rejected():
    before, after = report(), report()
    after["categories"]["direct"]["errors"] = 1
    with pytest.raises(ValueError):
        compare(before, after)
