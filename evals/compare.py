"""Compare compatible aggregate retrieval reports without imposing quality thresholds."""
import argparse
import json
from pathlib import Path

from evals.reporting import compare_e2e

METRICS = ("hit@1", "hit@3", "hit@5", "mrr", "evidence_coverage", "all_evidence")


def compare(before, after):
    for key in ("dataset_sha256", "corpus_sha256", "embedding", "backend",
                "draft_allowed", "max_embedding_calls", "per_case_timeout",
                "index_binding_sha256"):
        if key not in before["manifest"] or before["manifest"][key] != after["manifest"].get(key):
            raise ValueError("incompatible reports")
    result = {}
    for category in set(before["categories"]) | set(after["categories"]):
        # Category names from private input are not copied into diagnostics.
        if category not in before["categories"] or category not in after["categories"]:
            raise ValueError("incompatible categories")
        old, new = before["categories"][category], after["categories"][category]
        if any(old[k] != new[k] for k in ("total", "scored", "errors", "skipped")):
            raise ValueError("incompatible denominators")
    for key in METRICS:
        old = before["summary"]["metrics"]
        new = after["summary"]["metrics"]
        if old is None or new is None:
            raise ValueError("no scored cases")
        a, b = old[key], new[key]
        if type(a) not in (int, float) or type(b) not in (int, float) or not 0 <= a <= 1 or not 0 <= b <= 1:
            raise ValueError("invalid metric")
        result[key] = round(b - a, 6)
    return {"metric_deltas": result, "quality_gate": "not_calibrated",
            "draft": before["manifest"]["draft_allowed"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("before", type=Path)
    parser.add_argument("after", type=Path)
    args = parser.parse_args()
    try:
        before, after = (json.loads(p.read_text()) for p in (args.before, args.after))
        is_e2e = before.get("report_version") == 2 or after.get("report_version") == 2
        result = compare_e2e(before, after) if is_e2e else compare(before, after)
    except (OSError, ValueError, KeyError, TypeError):
        print('{"error":"incompatible_or_invalid_reports"}')
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
