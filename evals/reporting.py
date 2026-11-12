"""Aggregate E2E outcomes without retaining answers, URLs or private case identifiers."""
import math
from collections import Counter


def contract_pass(row):
    return (row["status"] == "completed"
            and all(row.get(key) is True for key in (
                "cleanup_ok", "web_cap_valid", "citation_identity_valid",
                "citation_references_valid", "citation_sections_valid",
                "persisted_view_matches", "runtime_verified", "binding_verified",
                "usage_limits_valid"))
            and not any(row.get(key, True) for key in (
                "missing_expected_citations", "persisted_web_citations", "persisted_urls"))
            and row.get("separate_sections") is not False)


def percentile(values, fraction):
    values = sorted(values)
    if not values:
        return None
    index = (len(values) - 1) * fraction
    lower = math.floor(index)
    return round(values[lower] + (values[math.ceil(index)] - values[lower]) * (index - lower), 6)


def summarize(rows):
    if any(r["status"] not in {"completed", "error", "skipped"} for r in rows):
        raise ValueError("unknown outcome")
    attempted = [r for r in rows if r["status"] != "skipped"]
    completed = [r for r in attempted if r["status"] == "completed"]
    metrics = {
        "completion_rate": [int(r["status"] == "completed") for r in attempted],
        "contract_pass_rate": [int(contract_pass(r)) for r in attempted],
        "annotated_page_coverage": [r["annotated_page_coverage"] for r in completed
                                    if r.get("annotated_page_coverage") is not None],
        "web_fallback_rate": [int(r["web_attempts"] > 0) for r in attempted
                              if r.get("web_attempts") is not None and "usage" in r],
        "web_separation_rate": [int(r["separate_sections"]) for r in completed
                                if r.get("separate_sections") is not None],
        "supported_fact_fraction": [r["semantic_judgment"]["supported_fact_fraction"]
                                    for r in completed if r.get("semantic_judgment", {}).get(
                                        "supported_fact_fraction") is not None],
    }
    latencies = {}
    for values in metrics.values():
        if any(type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 1
               for v in values):
            raise ValueError("invalid quality metric")
    for field in ("elapsed_seconds", "first_token_seconds"):
        values = [r[field] for r in attempted if type(r.get(field)) in (int, float)
                  and math.isfinite(r[field]) and r[field] >= 0]
        latencies[field] = {"count": len(values), "p50": percentile(values, .5),
                            "p95": percentile(values, .95)}
    usage = {}
    for key in ("chat_calls", "embedding_calls", "web_calls"):
        values = [r["usage"][key] for r in attempted if key in r.get("usage", {})]
        if any(type(v) is not int or v < 0 for v in values):
            raise ValueError("invalid usage")
        usage[key] = {"reported_total": sum(values), "reported_cases": len(values),
                      "unknown_cases": len(attempted) - len(values)}
    return {
        "total": len(rows), "attempted": len(attempted), "completed": len(completed),
        "errors": len(attempted) - len(completed), "skipped": len(rows) - len(attempted),
        "skip_reasons": dict(Counter(r["reason"] for r in rows if r["status"] == "skipped")),
        "error_reasons": dict(Counter(r.get("reason", "stream_failed") for r in attempted
                                      if r["status"] == "error")),
        "metrics": {key: sum(values) / len(values) if values else None
                    for key, values in metrics.items()},
        "metric_denominators": {key: len(values) for key, values in metrics.items()},
        "latency": latencies, "provider_usage": usage,
        "judge_outcomes": dict(Counter(r.get("semantic_judgment", {}).get("status", "not_run")
                                       for r in attempted)),
    }


def compare_e2e(before, after):
    """Compare identical attempted cohorts; disclose unavailable quality deltas."""
    if before["report_version"] != 3 or after["report_version"] != 3:
        raise ValueError("unsupported report")
    for key in ("dataset_sha256", "corpus_sha256", "index_binding_sha256", "selection",
                "draft_allowed", "evaluator_sha256", "judge_model"):
        if before["manifest"][key] != after["manifest"][key]:
            raise ValueError("incompatible run settings")
    for key in ("config", "python_version"):
        if before["manifest"]["server"][key] != after["manifest"]["server"][key]:
            raise ValueError("incompatible server configuration")
    old_rows, new_rows = before["results"], after["results"]
    for rows in (old_rows, new_rows):
        if len({r["row"] for r in rows}) != len(rows):
            raise ValueError("duplicate case rows")
    def cohort(rows):
        return [(r["row"], r["category"]) for r in rows if r["status"] != "skipped"]
    if not cohort(old_rows) or cohort(old_rows) != cohort(new_rows):
        raise ValueError("incompatible attempted cohorts")
    groups = {"all": (old_rows, new_rows)}
    # Only known enum category names may enter the report, never private input keys.
    from evals.golden import Case
    allowed = Case.model_fields["category"].annotation.__args__
    if any(r["category"] not in allowed for r in old_rows + new_rows):
        raise ValueError("unknown category")
    for category in sorted({r["category"] for r in old_rows + new_rows}):
        groups[category] = ([r for r in old_rows if r["category"] == category],
                            [r for r in new_rows if r["category"] == category])
    deltas = {}
    for name, (old_group, new_group) in groups.items():
        old, new = summarize(old_group), summarize(new_group)
        metrics = {}
        for key, a in old["metrics"].items():
            b = new["metrics"][key]
            old_count, new_count = (r["metric_denominators"][key] for r in (old, new))
            def contributing(group):
                if key in {"completion_rate", "contract_pass_rate"}:
                    return [r["row"] for r in group if r["status"] != "skipped"]
                if key == "web_fallback_rate":
                    return [r["row"] for r in group if r["status"] != "skipped"
                            and r.get("web_attempts") is not None and "usage" in r]
                field = {"annotated_page_coverage": "annotated_page_coverage",
                         "web_separation_rate": "separate_sections",
                         "supported_fact_fraction": "supported_fact_fraction"}[key]
                return [r["row"] for r in group if r["status"] == "completed"
                        and (r.get("semantic_judgment", {}) if key == "supported_fact_fraction"
                             else r).get(field) is not None]
            available = (a is not None and b is not None and old_count == new_count
                         and contributing(old_group) == contributing(new_group))
            metrics[key] = {"delta": round(b - a, 6) if available else None,
                            "before_count": old_count, "after_count": new_count}
        deltas[name] = {"metrics": metrics, "error_delta": new["errors"] - old["errors"],
                        "before_usage": old["provider_usage"], "after_usage": new["provider_usage"],
                        "before_latency": old["latency"], "after_latency": new["latency"]}
    return {"mode": "e2e_comparison", "categories": deltas,
            "quality_gate": "not_calibrated", "draft": before["manifest"]["draft_allowed"]}
