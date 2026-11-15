"""Course generation jobs with in-memory study storage and a scripted provider."""

import asyncio
import json
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.providers import ProviderError
from app.study.jobs import CourseJobs
from app.study.models import LessonPlan
from tests.test_study_planner import ScriptedProvider, sections, structure_reply, topics_reply


class MemoryStudy:
    def __init__(self, outline=None, slow=0.0):
        self.outline = sections(2, 120) if outline is None else outline
        self.slow = slow
        self.plans: list[tuple] = []
        self.failures: list[tuple] = []

    async def document_outline(self, document_id):
        if self.slow:
            await asyncio.sleep(self.slow)
        return self.outline

    async def write_plan(self, course_id, generation, plan):
        assert isinstance(plan, LessonPlan)
        self.plans.append((course_id, generation, plan))

    async def fail_course(self, course_id, generation, code):
        self.failures.append((course_id, generation, code))
        return True


def config(**overrides):
    base = dict(course_generation_call_limit=10, course_generation_timeout_seconds=5, course_window_chars=10000)
    return SimpleNamespace(**{**base, **overrides})


async def finished(jobs, course_id):
    await asyncio.wait_for(jobs.tasks[course_id], 5)


async def test_job_plans_emits_ordered_events_and_writes_once():
    study = MemoryStudy()
    provider = ScriptedProvider([topics_reply(["1", "2"], per_window=2), structure_reply([[1, 2]])])
    jobs = CourseJobs(study, provider, config())
    course, document, generation = uuid4(), uuid4(), uuid4()
    assert jobs.start(course, document, generation)
    assert not jobs.start(course, document, generation)  # Already running.
    seen = [item async for item in jobs.subscribe(course)]
    await finished(jobs, course)
    assert [(e["step"], e["status"]) for e in seen][:2] == [("outline", "started"), ("outline", "completed")]
    assert seen[-1]["step"] == "estimate" and seen[-1]["status"] == "completed"
    assert all(e["type"] == "progress" and e["version"] == 1 for e in seen)
    assert [e["sequence"] for e in seen] == list(range(1, len(seen) + 1))
    assert any(e.get("task") == "w1" and e.get("parent") == "topics" for e in seen)
    assert len(study.plans) == 1 and study.plans[0][1] == generation and not study.failures
    # Late subscribers get the full snapshot and nothing else.
    assert [e["sequence"] for e in jobs.snapshot(course)] == [e["sequence"] for e in seen]
    assert [item async for item in jobs.subscribe(course)] == seen


@pytest.mark.parametrize(
    "study, provider, settings, code",
    [
        (MemoryStudy(), ScriptedProvider(["{", "{"]), config(), "provider"),
        (MemoryStudy(), ScriptedProvider([ProviderError("down")]), config(), "provider"),
        (MemoryStudy(outline=sections(1, 3)), ScriptedProvider([]), config(), "unreadable"),
        (MemoryStudy(outline=sections(6, 50)), ScriptedProvider([topics_reply(["1"])] * 6 + [structure_reply([[1]])]), config(course_generation_call_limit=2, course_window_chars=10), "budget"),
        (MemoryStudy(slow=1.0), ScriptedProvider([]), config(course_generation_timeout_seconds=0.05), "timeout"),
    ],
)
async def test_job_failures_are_recorded_with_safe_codes(study, provider, settings, code):
    jobs = CourseJobs(study, provider, settings)
    course, generation = uuid4(), uuid4()
    jobs.start(course, uuid4(), generation)
    events = [item async for item in jobs.subscribe(course)]
    await finished(jobs, course)
    assert study.failures == [(course, generation, code)] and not study.plans
    assert events[-1]["status"] == "failed" and events[-1]["outcome"] == code


async def test_shutdown_marks_running_job_interrupted():
    study = MemoryStudy(slow=5.0)
    jobs = CourseJobs(study, ScriptedProvider([]), config(course_generation_timeout_seconds=30))
    course, generation = uuid4(), uuid4()
    jobs.start(course, uuid4(), generation)
    await asyncio.sleep(0.05)
    await jobs.shutdown()
    assert study.failures == [(course, generation, "interrupted")]
    assert not jobs.running(course)


async def test_jobs_run_one_at_a_time():
    order = []

    class Study(MemoryStudy):
        async def document_outline(self, document_id):
            order.append(("start", document_id))
            await asyncio.sleep(0.05)
            order.append(("end", document_id))
            return self.outline

    study = Study()
    provider = ScriptedProvider([topics_reply(["1", "2"], per_window=2), structure_reply([[1, 2]])] * 2)
    jobs = CourseJobs(study, provider, config())
    a, b = uuid4(), uuid4()
    jobs.start(a, a, uuid4())
    jobs.start(b, b, uuid4())
    await asyncio.gather(jobs.tasks[a], jobs.tasks[b])
    assert [kind for kind, _ in order] == ["start", "end", "start", "end"]
    assert len(study.plans) == 2
    assert json.loads(provider.calls[0][1])["allowed_section_ids"] == ["1", "2"]
