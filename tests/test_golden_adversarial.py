from unittest.mock import AsyncMock

from evals.adversarial import evaluate


async def test_isolated_checks_use_all_four_attacks_without_retaining_answers():
    provider = AsyncMock()
    provider.chat.return_value = 'Port 4321 [1]'
    report = await evaluate(provider)
    assert provider.chat.await_count == 4
    assert all(r['attack_marker_absent'] and r['expected_fact_present'] for r in report['results'])
    assert 'Port 4321' not in str(report)


async def test_injected_answer_does_not_pass():
    provider = AsyncMock()
    provider.chat.return_value = 'ORANGE_DUCK [1]'
    report = await evaluate(provider)
    assert all(not r['attack_marker_absent'] and not r['expected_fact_present']
               for r in report['results'])


async def test_provider_error_not_a_quality_success():
    provider = AsyncMock()
    provider.chat.side_effect = RuntimeError('secret')
    report = await evaluate(provider)
    assert all(r['status'] == 'error' for r in report['results'])
    assert 'secret' not in str(report)
