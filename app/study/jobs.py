"""In-process Master-mode jobs: generation-guarded, bounded, with live progress.

Progress events reuse the v1 contract (app.progress.ProgressEvent). Course planning
uses steps outline, topics, structure and estimate (window tasks w1..wN); lesson
content uses evidence, write and validate. Snapshots are process-local; a restart
marks unfinished work interrupted (StudyStorage.mark_interrupted).
"""

import asyncio
import logging
from dataclasses import dataclass, field
from uuid import UUID, uuid4

from app.agents.budget import BudgetedProvider, BudgetExceeded, CallBudget, current_budget
from app.progress import ProgressEvent
from app.storage import Conflict, NotFound
from app.study.lesson_writer import LessonFailed, LessonWriter
from app.study.planner import Planner, PlanningFailed

logger = logging.getLogger(__name__)
DONE = None  # Queue sentinel.


@dataclass
class CourseEmitter:
    writer: object
    sequence: int = 0

    def __call__(self, step, status, task=None, outcome=None, count=None, attempt=0):
        self.sequence += 1
        event = ProgressEvent(
            step=step,
            id=step + (f":{task}" if task else ""),
            status=status,
            attempt=attempt,
            sequence=self.sequence,
            task=task,
            parent=step if task else None,
            outcome=outcome,
            count=count if isinstance(count, int) and 0 <= count <= 1000 else None,
        )
        self.writer(event.model_dump(exclude_none=True))


@dataclass
class JobRegistry:
    """One background task per key, with replayable progress and live subscribers."""

    study: object
    providers: object
    config: object
    tasks: dict[UUID, asyncio.Task] = field(default_factory=dict)
    snapshots: dict[UUID, list[dict]] = field(default_factory=dict)
    subscribers: dict[UUID, set[asyncio.Queue]] = field(default_factory=dict)

    def running(self, key: UUID) -> bool:
        task = self.tasks.get(key)
        return task is not None and not task.done()

    def _launch(self, key: UUID, coroutine) -> bool:
        if self.running(key):
            coroutine.close()
            return False
        self.snapshots[key] = []
        self.tasks[key] = asyncio.create_task(coroutine)
        return True

    def snapshot(self, key: UUID) -> list[dict]:
        return list(self.snapshots.get(key, []))

    async def subscribe(self, key: UUID):
        """Replay what happened so far, then stream live events until the job ends."""
        for item in self.snapshot(key):
            yield item
        if not self.running(key):
            return
        queue: asyncio.Queue = asyncio.Queue()
        self.subscribers.setdefault(key, set()).add(queue)
        try:
            while True:
                item = await queue.get()
                if item is DONE:
                    return
                yield item
        finally:
            self.subscribers.get(key, set()).discard(queue)

    async def shutdown(self):
        for task in list(self.tasks.values()):
            task.cancel()
        for task in list(self.tasks.values()):
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass

    def _publish(self, key: UUID, item):
        if item is not DONE:
            self.snapshots.setdefault(key, []).append(item)
        for queue in list(self.subscribers.get(key, ())):
            queue.put_nowait(item)


@dataclass
class CourseJobs(JobRegistry):
    gate: asyncio.Semaphore = field(default_factory=lambda: asyncio.Semaphore(1))

    def start(self, course_id: UUID, document_id: UUID, generation: UUID) -> bool:
        """Begin planning unless a job for this course is already running."""
        return self._launch(course_id, self._run(course_id, document_id, generation))

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


@dataclass
class LessonJobs(JobRegistry):
    """Lesson content generation: one job per lesson, at most one prefetch at a time."""

    # One learner-opened lesson and one prefetch may write at once.
    gate: asyncio.Semaphore = field(default_factory=lambda: asyncio.Semaphore(2))
    prefetching: UUID | None = None

    def start(self, lesson_id: UUID, generation: UUID) -> bool:
        """Generate content unless a job for this lesson is already running."""
        return self._launch(lesson_id, self._run(lesson_id, generation))

    async def prefetch(self, lesson_id: UUID) -> bool:
        """After a lesson completes, prepare the newly unlocked one in the background.

        Bounded to one prefetch at a time; skipped when content is not pending.
        """
        if self.prefetching is not None and self.running(self.prefetching):
            return False
        generation = uuid4()
        if not await self.study.begin_content(lesson_id, generation):
            return False
        self.prefetching = lesson_id
        return self.start(lesson_id, generation)

    async def _run(self, lesson_id: UUID, generation: UUID):
        emit = CourseEmitter(lambda item: self._publish(lesson_id, item))
        budget = CallBudget(chat_limit=self.config.lesson_generation_call_limit, embedding_limit=0)
        token = current_budget.set(budget)
        code, reported = None, False
        try:
            async with self.gate:
                async with asyncio.timeout(self.config.lesson_generation_timeout_seconds):
                    lesson, sections = await self.study.lesson_evidence(lesson_id)
                    writer = LessonWriter(
                        BudgetedProvider(self.providers), self.config.lesson_evidence_chars, emit
                    )
                    content = await writer.write(lesson, sections)
                    await self.study.write_content(lesson_id, generation, content)
        except LessonFailed as exc:
            code = exc.code
            reported = True  # The writer already emitted the failing step.
        except BudgetExceeded:
            code = "budget"
        except TimeoutError:
            code = "timeout"
        except NotFound:
            code = "unreadable"
        except Conflict:
            # A newer generation owns the lesson; its own job reports the outcome.
            return
        except asyncio.CancelledError:
            code = "interrupted"
            raise
        except Exception as exc:
            # Never log prompts, evidence, model output or reference answers.
            logger.error("Lesson generation failed (%s)", type(exc).__name__)
            code = "provider"
        finally:
            current_budget.reset(token)
            if code:
                try:
                    await asyncio.shield(self.study.fail_content(lesson_id, generation, code))
                except Exception:
                    logger.warning("Could not record lesson failure")
                if not reported:
                    emit("write", "failed", outcome=code)
            self._publish(lesson_id, DONE)
