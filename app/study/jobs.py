"""In-process course generation jobs: one at a time, generation-guarded, with live progress.

Progress events reuse the v1 contract (app.progress.ProgressEvent) with steps
outline, topics, structure and estimate; window tasks are w1..wN. Snapshots are
process-local; a restart marks unfinished courses interrupted (StudyStorage).
"""

import asyncio
import logging
from dataclasses import dataclass, field
from uuid import UUID

from app.agents.budget import BudgetedProvider, BudgetExceeded, CallBudget, current_budget
from app.progress import ProgressEvent
from app.storage import Conflict, NotFound
from app.study.planner import Planner, PlanningFailed

logger = logging.getLogger(__name__)
DONE = None  # Queue sentinel.


@dataclass
class CourseEmitter:
    writer: object
    sequence: int = 0

    def __call__(self, step, status, task=None, outcome=None, count=None):
        self.sequence += 1
        event = ProgressEvent(
            step=step,
            id=step + (f":{task}" if task else ""),
            status=status,
            attempt=0,
            sequence=self.sequence,
            task=task,
            parent=step if task else None,
            outcome=outcome,
            count=count if isinstance(count, int) and 0 <= count <= 1000 else None,
        )
        self.writer(event.model_dump(exclude_none=True))


@dataclass
class CourseJobs:
    study: object
    providers: object
    config: object
    tasks: dict[UUID, asyncio.Task] = field(default_factory=dict)
    snapshots: dict[UUID, list[dict]] = field(default_factory=dict)
    subscribers: dict[UUID, set[asyncio.Queue]] = field(default_factory=dict)
    gate: asyncio.Semaphore = field(default_factory=lambda: asyncio.Semaphore(1))

    def running(self, course_id: UUID) -> bool:
        task = self.tasks.get(course_id)
        return task is not None and not task.done()

    def start(self, course_id: UUID, document_id: UUID, generation: UUID) -> bool:
        """Begin planning unless a job for this course is already running."""
        if self.running(course_id):
            return False
        self.snapshots[course_id] = []
        self.tasks[course_id] = asyncio.create_task(self._run(course_id, document_id, generation))
        return True

    def snapshot(self, course_id: UUID) -> list[dict]:
        return list(self.snapshots.get(course_id, []))

    async def subscribe(self, course_id: UUID):
        """Replay what happened so far, then stream live events until the job ends."""
        for item in self.snapshot(course_id):
            yield item
        if not self.running(course_id):
            return
        queue: asyncio.Queue = asyncio.Queue()
        self.subscribers.setdefault(course_id, set()).add(queue)
        try:
            while True:
                item = await queue.get()
                if item is DONE:
                    return
                yield item
        finally:
            self.subscribers.get(course_id, set()).discard(queue)

    async def shutdown(self):
        for task in list(self.tasks.values()):
            task.cancel()
        for task in list(self.tasks.values()):
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass

    def _publish(self, course_id: UUID, item):
        if item is not DONE:
            self.snapshots.setdefault(course_id, []).append(item)
        for queue in list(self.subscribers.get(course_id, ())):
            queue.put_nowait(item)

    async def _run(self, course_id: UUID, document_id: UUID, generation: UUID):
        emit = CourseEmitter(lambda item: self._publish(course_id, item))
        budget = CallBudget(chat_limit=self.config.course_generation_call_limit, embedding_limit=0)
        token = current_budget.set(budget)
        code = None
        try:
            async with self.gate:
                async with asyncio.timeout(self.config.course_generation_timeout_seconds):
                    sections = await self.study.document_outline(document_id)
                    planner = Planner(
                        BudgetedProvider(self.providers), self.config.course_window_chars, emit
                    )
                    plan = await planner.plan(sections)
                    await self.study.write_plan(course_id, generation, plan)
        except PlanningFailed as exc:
            code = exc.code
        except BudgetExceeded:
            code = "budget"
        except TimeoutError:
            code = "timeout"
        except NotFound:
            code = "unreadable"
        except Conflict:
            # A newer generation owns the course; its own job reports the outcome.
            return
        except asyncio.CancelledError:
            code = "interrupted"
            raise
        except Exception as exc:
            # Never log prompts, document text or provider bodies.
            logger.error("Course generation failed (%s)", type(exc).__name__)
            code = "provider"
        finally:
            current_budget.reset(token)
            if code:
                try:
                    await asyncio.shield(self.study.fail_course(course_id, generation, code))
                except Exception:
                    logger.warning("Could not record course failure")
                emit("estimate" if code != "unreadable" else "outline", "failed", outcome=code)
            self._publish(course_id, DONE)
