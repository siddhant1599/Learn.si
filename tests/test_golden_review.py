from datetime import date

import pytest

from evals.review import Decision, apply_decisions, fingerprint, packet
from tests.test_golden import corpus as _corpus


@pytest.fixture
def case():
    return _corpus.__wrapped__()[0]


def approval(case, **changes):
    return Decision(case_id=case.id, case_sha256=fingerprint(case), verdict="approved",
                    reviewer="independent-reviewer", reviewed_at=date(2026, 1, 1),
                    independent=True, source_checked=True, rubric_checked=True,
                    notes="Checked original source and qualifications.").model_copy(update=changes)


def test_export_creates_no_approvals(case):
    result = packet([case])
    assert result['decisions'][0]['verdict'] == 'pending'
    assert not result['decisions'][0]['independent']


def test_apply_is_copy_and_preserves_annotations(case):
    result, counts = apply_decisions([case], [approval(case)])
    assert result[0].review.status == "approved"
    assert case.review.status == "draft"
    assert result[0].evidence == case.evidence
    assert counts == {"approved": 1, "rejected": 0, "pending": 0}


@pytest.mark.parametrize("change", [dict(reviewer="author"), dict(reviewer=" AUTHOR "),
    dict(independent=False), dict(notes=""), dict(source_checked=False),
    dict(rubric_checked=False), dict(reviewed_at=None), dict(reviewed_at=date(2999,1,1))])
def test_invalid_approval(case, change):
    with pytest.raises(ValueError):
        apply_decisions([case], [approval(case, **change)])


def test_changed_annotation_invalidates_approval(case):
    decision = approval(case)
    case.required_facts = ["Changed answer key"]
    with pytest.raises(ValueError):
        apply_decisions([case], [decision])


def test_duplicate_unknown_decisions_rejected(case):
    for decisions in ([approval(case), approval(case)], [approval(case, case_id="unknown")]):
        with pytest.raises(ValueError):
            apply_decisions([case], decisions)


def test_negative_needs_explicit_absence_check(case):
    case.expected_answerability = "not_in_document"
    with pytest.raises(ValueError):
        apply_decisions([case], [approval(case)])
    case.absence_review = "Reviewed whole synthetic corpus."
    reviewed, _ = apply_decisions([case], [approval(case, absence_checked=True)])
    assert reviewed[0].review.status == "approved"


def test_rejection_is_not_release_eligible(case):
    reviewed, counts = apply_decisions([case], [approval(case, verdict="rejected")])
    assert reviewed[0].review.status == "draft"
    assert counts['rejected'] == 1


def test_rejection_preserves_original_annotator(case):
    rejected, _ = apply_decisions([case], [approval(case, verdict="rejected")])
    assert rejected[0].annotator == "author"
    with pytest.raises(ValueError):
        apply_decisions(rejected, [approval(rejected[0], reviewer="author")])


def test_private_output_requires_ignore_and_never_overwrites(tmp_path, monkeypatch):
    from types import SimpleNamespace

    from evals.review import write_private

    monkeypatch.setattr("evals.review.subprocess.run", lambda *a, **k: SimpleNamespace(returncode=1))
    path = tmp_path / "review.json"
    with pytest.raises(ValueError):
        write_private(path, "private")
    assert not path.exists()
    monkeypatch.setattr("evals.review.subprocess.run", lambda *a, **k: SimpleNamespace(returncode=0))
    write_private(path, "private")
    assert path.stat().st_mode & 0o777 == 0o600
    with pytest.raises(FileExistsError):
        write_private(path, "replacement")
    assert path.read_text() == "private"
