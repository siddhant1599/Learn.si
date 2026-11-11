"""Private review packets and hash-bound reviewer attestations.

Reviewer identity is self-attested, not authenticated by this local utility.
"""
import argparse
import hashlib
import json
import os
import subprocess
from datetime import date
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from evals.golden import Case, Review


class Decision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    case_id: str
    case_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    verdict: Literal["pending", "approved", "rejected"] = "pending"
    reviewer: str = ""
    reviewed_at: date | None = None
    independent: bool = False
    source_checked: bool = False
    rubric_checked: bool = False
    absence_checked: bool = False
    notes: str = ""


def fingerprint(case):
    return hashlib.sha256(case.model_dump_json().encode()).hexdigest()


def packet(cases):
    if len({c.id for c in cases}) != len(cases) or not cases:
        raise ValueError("invalid dataset")
    return {
        "instructions": (
            "Private source content. Check each question, fact, prohibited claim, evidence mapping, "
            "rendered table/units and split group against the original PDF. For negatives inspect "
            "the full corpus. Record disagreements in notes. Approval requires an independent "
            "reviewer; do not approve your own annotations. This packet is not an approval."
        ),
        "cases": [c.model_dump(mode="json") for c in cases],
        "decisions": [Decision(case_id=c.id, case_sha256=fingerprint(c)).model_dump(mode="json")
                      for c in cases],
    }


def apply_decisions(cases, decisions, *, today=None):
    today = today or date.today()
    by_id = {c.id: c for c in cases}
    if not cases or len(by_id) != len(cases):
        raise ValueError("invalid dataset")
    if len({d.case_id for d in decisions}) != len(decisions):
        raise ValueError("duplicate decisions")
    result = {c.id: c.model_copy(deep=True) for c in cases}
    counts = {"approved": 0, "rejected": 0, "pending": len(cases)}
    for decision in decisions:
        if decision.case_id not in by_id:
            raise ValueError("unknown case")
        case = by_id[decision.case_id]
        if decision.case_sha256 != fingerprint(case):
            raise ValueError("stale review")
        if decision.verdict == "pending":
            continue
        if (not decision.reviewer.strip() or not decision.notes.strip()
                or not decision.reviewed_at or decision.reviewed_at > today):
            raise ValueError("incomplete review")
        if case.review.status == "approved":
            raise ValueError("already reviewed; create a new annotation revision")
        if (not decision.independent
                or decision.reviewer.strip().casefold() == (case.annotator or case.review.reviewer).strip().casefold()):
            raise ValueError("independent reviewer required")
        if decision.verdict == "approved":
            if not decision.source_checked or not decision.rubric_checked:
                raise ValueError("missing source or rubric review")
            if (case.expected_answerability in {"not_in_document", "needs_clarification"}
                    and (not decision.absence_checked or not case.absence_review)):
                raise ValueError("missing absence review")
        result[case.id].annotator = case.annotator or case.review.reviewer
        result[case.id].review = Review(
            status="approved" if decision.verdict == "approved" else "draft",
            reviewer=decision.reviewer.strip(), independent=decision.independent,
            reviewed_at=decision.reviewed_at,
            method=f"{decision.verdict}: {decision.notes.strip()}",
        )
        counts[decision.verdict] += 1
        counts["pending"] -= 1
    return list(result.values()), counts


def write_private(path, contents):
    # Refuse tracked/nonignored outputs; do not overwrite existing annotations.
    if subprocess.run(["git", "check-ignore", "-q", str(path)], check=False).returncode != 0:
        raise ValueError("output must be Git ignored")
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(contents)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--decisions", type=Path)
    args = parser.parse_args()
    try:
        cases = [Case.model_validate_json(line) for line in args.dataset.read_text().splitlines()
                 if line.strip()]
        if args.decisions:
            decisions = [Decision.model_validate(d) for d in
                         json.loads(args.decisions.read_text())["decisions"]]
            reviewed, counts = apply_decisions(cases, decisions)
            write_private(args.output, "".join(c.model_dump_json() + "\n" for c in reviewed))
            print(json.dumps(counts | {"reviewer_identity": "self_attested"}))
        else:
            write_private(args.output, json.dumps(packet(cases), ensure_ascii=False, indent=2))
            print(json.dumps({"cases": len(cases), "approvals_created": 0}))
    except (OSError, ValueError, KeyError, TypeError):
        print('{"error":"invalid_review_or_output","details_redacted":true}')
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
