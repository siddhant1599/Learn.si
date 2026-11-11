import json
from unittest.mock import AsyncMock

import pytest

from evals.grading import grade, score_judgment
from tests.test_golden import corpus as _corpus


def judgment(**patch):
    return json.dumps(dict(facts=[dict(fact_index=0, verdict="supported")],
        prohibited_claim_indices=[], unsupported_document_claims=False,
        appropriate_abstention=True, document_web_separated=True,
        internal_claims_not_inferred_from_web=True) | patch)


def test_semantic_scores_never_become_release_gates():
    case = _corpus.__wrapped__()[0]
    score = score_judgment(case, judgment())
    assert score['supported_fact_fraction'] == 1
    assert not score['release_gate']
    score = score_judgment(case, judgment(facts=[dict(fact_index=0, verdict="contradicted")]))
    assert score['contradicted_facts'] == 1
    assert score['supported_fact_fraction'] == 0


@pytest.mark.parametrize('patch', [dict(facts=[]), dict(facts=[dict(fact_index=2, verdict='missing')]),
    dict(prohibited_claim_indices=[0]), dict(unexpected='private text')])
def test_malformed_or_incomplete_judge_output_rejected(patch):
    with pytest.raises(ValueError):
        score_judgment(_corpus.__wrapped__()[0], judgment(**patch))


async def test_all_evidence_sent_and_output_redacted():
    case = _corpus.__wrapped__()[0]
    case.evidence.append(case.evidence[0].model_copy(update={'quote': 'Second private reference'}))
    provider = AsyncMock()
    provider.chat.return_value = judgment()
    result = await grade(case, 'Private answer https://private.test', provider)
    payload = json.loads(provider.chat.call_args.args[1])
    assert len(payload['evidence']) == 2
    assert 'private' not in json.dumps(result).lower()


async def test_provider_failure_is_separate_from_quality():
    provider = AsyncMock()
    provider.chat.side_effect = RuntimeError('secret')
    result = await grade(_corpus.__wrapped__()[0], 'answer', provider)
    assert result['status'] == 'error'
    assert 'supported_fact_fraction' not in result
    assert 'secret' not in str(result)


async def test_oversized_rubric_is_explicitly_skipped_without_provider_call():
    provider = AsyncMock()
    result = await grade(_corpus.__wrapped__()[0], 'x' * 60001, provider)
    assert result == {'status': 'skipped', 'reason': 'judge_input_limit', 'release_gate': False}
    provider.chat.assert_not_awaited()
