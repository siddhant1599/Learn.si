import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import UUID, uuid4

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi import Query as QueryParam
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from app import deletions
from app.agents.budget import BudgetedProvider, BudgetExceeded, CallBudget, current_budget
from app.config import settings
from app.models import Query
from app.pinecone import PineconeVectors
from app.privacy import safe_turn
from app.providers import ProviderError, Providers
from app.storage import Conflict, NotFound, Storage, recent_context
from app.study.jobs import CourseJobs, LessonJobs
from app.study.lesson_writer import build_evidence
from app.study.models import (
    CourseCreate,
    LessonContent,
    QuizQuestion,
    QuizSubmit,
    YourTurnSubmit,
    client_content,
)
from app.study.quiz import QuizFailed, QuizWriter, answer_problem, grade
from app.study.review import REVEAL_AFTER, ReviewFailed, YourTurnReviewer
from app.study.storage import StudyStorage
from app.study.tutor import asked_for_answer, lesson_summary, tutor_context
from app.uploads import MAX_BYTES, extract_document
from app.vector_cleanup import cleanup_loop
from app.web_search import TavilySearch
from app.workflow import Workflow
from scripts.ingest import ingest

# Import after the serving modules so the snapshot includes their startup sources.
from app.runtime import capture_runtime, runtime_current  # isort: skip

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app):
    config = settings()
    app.state.runtime = capture_runtime(config)
    app.state.storage = None
    app.state.study = None
    app.state.course_jobs = None
    app.state.lesson_jobs = None
    app.state.research_limiter = asyncio.Semaphore(config.research_service_concurrency)
    async with httpx.AsyncClient(timeout=45) as client:
        app.state.providers = Providers(config, client)
        app.state.web_search = TavilySearch(
            config.tavily_key.get_secret_value(), client, config.tavily_include_domains
        )
        if config.database_url.get_secret_value():
            vectors = (
                PineconeVectors(config, client) if config.vector_backend == "pinecone" else None
            )
            store = Storage(config.database_url.get_secret_value(), vectors)
            await store.pool.open()
            app.state.storage = store
            app.state.study = StudyStorage(store.pool)
            app.state.course_jobs = CourseJobs(app.state.study, app.state.providers, config)
            app.state.lesson_jobs = LessonJobs(app.state.study, app.state.providers, config)
            try:
                # No background plan or lesson generation survives a restart.
                await app.state.study.mark_interrupted()
            except Exception:
                logger.warning("Study schema unavailable; run scripts.migrate before Master mode")
        cleanup_task = (asyncio.create_task(cleanup_loop(config, client))
                        if config.database_url.get_secret_value()
                        and config.vector_backend == "pinecone" else None)
        deletion_task = (asyncio.create_task(deletions.cleanup_loop(app.state.storage, config))
                         if app.state.storage else None)
        try:
            yield
        finally:
            for name in ("course_jobs", "lesson_jobs"):
                if getattr(app.state, name, None):
                    await getattr(app.state, name).shutdown()
            if deletion_task:
                deletion_task.cancel()
                try:
                    await deletion_task
                except asyncio.CancelledError:
                    pass
            if cleanup_task:
                cleanup_task.cancel()
                try:
                    await cleanup_task
                except asyncio.CancelledError:
                    pass
            if app.state.storage:
                await app.state.storage.pool.close()


app = FastAPI(title="Agentic RAG Clone", lifespan=lifespan)
frontend = Path(__file__).resolve().parent.parent / "frontend"


class LocalFrontendFiles(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-store"
        return response


app.mount("/static", LocalFrontendFiles(directory=frontend), name="static")


@app.get("/", include_in_schema=False)
async def test_interface():
    return RedirectResponse(settings().web_frontend_url, status_code=307)


@app.get("/legacy", include_in_schema=False)
async def legacy_landing():
    return FileResponse(frontend / "landing.html", headers={"Cache-Control": "no-store"})


@app.get("/chat", include_in_schema=False)
async def chat_interface():
    return RedirectResponse(settings().web_frontend_url + "/workspace/chats/new", status_code=307)


@app.get("/legacy/chat", include_in_schema=False)
async def legacy_chat():
    return FileResponse(frontend / "index.html", headers={"Cache-Control": "no-store"})


if settings().cors_origin:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings().cors_origin],
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Content-Type"],
    )


def storage(request: Request):
    store = getattr(request.app.state, "storage", None)
    if store is None:
        raise HTTPException(503, "DATABASE_URL is not configured")
    return store


def study_storage(request: Request):
    study = getattr(request.app.state, "study", None)
    if study is None:
        raise HTTPException(503, "DATABASE_URL is not configured")
    return study


def course_jobs(request: Request):
    jobs = getattr(request.app.state, "course_jobs", None)
    if jobs is None:
        raise HTTPException(503, "DATABASE_URL is not configured")
    return jobs


def lesson_jobs(request: Request):
    jobs = getattr(request.app.state, "lesson_jobs", None)
    if jobs is None:
        raise HTTPException(503, "DATABASE_URL is not configured")
    return jobs


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "agentic-rag-clone",
        "web_available": bool(settings().tavily_key.get_secret_value()),
    }


@app.get("/evaluation/runtime", include_in_schema=False)
async def evaluation_runtime(request: Request):
    manifest = getattr(request.app.state, "runtime", None)
    if manifest is None:
        raise HTTPException(503, "Runtime provenance unavailable")
    if not runtime_current(manifest, settings()):
        raise HTTPException(409, "Restart the server before evaluation")
    return JSONResponse(manifest.model_dump(mode="json"), headers={"Cache-Control": "no-store"})


@app.get("/documents")
async def documents(store=Depends(storage)):
    return await store.documents()


@app.get("/deletions")
async def deletion_state(store=Depends(storage)):
    return await deletions.state(store)


@app.delete("/conversations/{thread_id}")
async def delete_conversation(thread_id: UUID, store=Depends(storage)):
    try:
        return await deletions.delete_chat(store, thread_id)
    except Exception:
        raise HTTPException(503, "Chat deletion failed. Retry when the database is available.") from None


@app.delete("/documents/{document_id}")
async def delete_document(document_id: UUID, store=Depends(storage)):
    try:
        result = await deletions.delete_document(store, settings(), document_id)
        return JSONResponse(result, status_code=202 if result["status"] == "cleanup_pending" else 200)
    except Conflict as exc:
        raise HTTPException(409, str(exc)) from None
    except Exception:
        raise HTTPException(503, "Document deletion failed. Retry when the database is available.") from None


@app.post("/courses")
async def create_course(body: CourseCreate, study=Depends(study_storage), jobs=Depends(course_jobs)):
    """Idempotent per document: 202 while generating, 200 once ready; failed courses restart."""
    try:
        course, created = await study.create_course(body.document_id, uuid4())
    except NotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    if course.status == "ready":
        return JSONResponse(course.model_dump(mode="json"), status_code=200)
    if course.status == "failed":
        generation = uuid4()
        if await study.begin_generation(course.id, generation):
            course = (await study.create_course(body.document_id, generation))[0]
            jobs.start(course.id, body.document_id, generation)
    elif created or not jobs.running(course.id):
        current = await study.course(course.id)
        if current.generation is not None and current.status == "generating":
            # Interrupted earlier in this process lifetime or just created: run it now.
            jobs.start(course.id, body.document_id, current.generation)
    return JSONResponse(course.model_dump(mode="json"), status_code=202)


@app.get("/courses")
async def list_courses(study=Depends(study_storage)):
    return [course.model_dump(mode="json") for course in await study.courses()]


@app.get("/courses/{course_id}")
async def get_course(course_id: UUID, study=Depends(study_storage), jobs=Depends(course_jobs)):
    try:
        course = await study.course(course_id)
    except NotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    return {**course.model_dump(mode="json"), "progress": jobs.snapshot(course_id)}


@app.get("/courses/{course_id}/events")
async def course_events(course_id: UUID, study=Depends(study_storage), jobs=Depends(course_jobs)):
    try:
        await study.course(course_id)
    except NotFound as exc:
        raise HTTPException(404, str(exc)) from exc

    async def stream():
        async for item in jobs.subscribe(course_id):
            yield event("progress", item)
        final = await study.course(course_id)
        yield event("status", {"status": final.status, "failure_code": final.failure_code})

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


@app.delete("/courses/{course_id}")
async def delete_course(course_id: UUID, study=Depends(study_storage)):
    try:
        return await study.delete_course(course_id)
    except Exception:
        raise HTTPException(503, "Course deletion failed. Retry when the database is available.") from None


async def _lesson(study, lesson_id: UUID):
    try:
        return await study.lesson(lesson_id)
    except NotFound as exc:
        raise HTTPException(404, str(exc)) from exc


def _lesson_body(lesson, jobs):
    """Client view only: server-only content fields never leave the API."""
    locked = lesson.progress.status == "locked"
    body = lesson.client_view(settings().lesson_regeneration_daily_limit, locked_content=locked)
    return {**body, "generation_progress": jobs.snapshot(lesson.id)}


@app.get("/lessons/{lesson_id}")
async def get_lesson(lesson_id: UUID, study=Depends(study_storage), jobs=Depends(lesson_jobs)):
    """Opening marks an available lesson in progress (never unlocks) and starts generation.

    200 with content once ready (or failed, with failure code); 202 while generating.
    Locked lessons return metadata only and generate nothing.
    """
    lesson = await _lesson(study, lesson_id)
    if lesson.progress.status == "locked":
        return JSONResponse(_lesson_body(lesson, jobs), status_code=200)
    if lesson.progress.status == "available":
        await study.open_lesson(lesson_id)
    if lesson.content_status == "pending":
        generation = uuid4()
        if await study.begin_content(lesson_id, generation):
            jobs.start(lesson_id, generation)
    lesson = await _lesson(study, lesson_id)
    if (lesson.content_status == "generating" and lesson.content_generation is not None
            and not jobs.running(lesson_id)):
        # Started by a concurrent open that has not launched yet, or orphaned in-process.
        jobs.start(lesson_id, lesson.content_generation)
    status = 202 if lesson.content_status == "generating" else 200
    return JSONResponse(_lesson_body(lesson, jobs), status_code=status)


@app.get("/lessons/{lesson_id}/events")
async def lesson_events(lesson_id: UUID, study=Depends(study_storage), jobs=Depends(lesson_jobs)):
    await _lesson(study, lesson_id)

    async def stream():
        async for item in jobs.subscribe(lesson_id):
            yield event("progress", item)
        final = await study.lesson(lesson_id)
        yield event("status", {"content_status": final.content_status,
                               "failure_code": final.content_failure_code})

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


@app.post("/lessons/{lesson_id}/regenerate")
async def regenerate_lesson(
    lesson_id: UUID, study=Depends(study_storage), jobs=Depends(lesson_jobs)
):
    """Replace ready or failed content; attempts and progress are preserved."""
    lesson = await _lesson(study, lesson_id)
    if lesson.progress.status == "locked":
        raise HTTPException(409, "Pass the previous quiz before opening this lesson.")
    generation = uuid4()
    result = await study.begin_regeneration(
        lesson_id, generation, settings().lesson_regeneration_daily_limit
    )
    if result == "busy":
        raise HTTPException(409, "This lesson is still being written.")
    if result == "limit":
        raise HTTPException(429, "Daily regeneration limit reached for this lesson.")
    jobs.start(lesson_id, generation)
    lesson = await _lesson(study, lesson_id)
    return JSONResponse(_lesson_body(lesson, jobs), status_code=202)


@app.get("/lessons/{lesson_id}/conversation")
async def lesson_conversation(
    lesson_id: UUID,
    before: int = QueryParam(default=2**63 - 1, ge=1),
    limit: int = QueryParam(default=20, ge=1, le=50),
    study=Depends(study_storage),
    store=Depends(storage),
):
    """The lesson's bound tutor chat (or none yet), paged like Ask-mode history."""
    await _lesson(study, lesson_id)
    thread_id = await study.lesson_conversation(lesson_id)
    if thread_id is None:
        return {"thread_id": None, "messages": []}
    try:
        messages = await store.history(thread_id, before, limit)
    except NotFound:
        return {"thread_id": None, "messages": []}
    return {"thread_id": str(thread_id), "messages": messages}


REVIEW_FAILED = "Your answer could not be reviewed. Please retry."
REVEALED_BLANK = "Here is the answer. Compare it with the lesson, then try the next exercise."


@app.post("/lessons/{lesson_id}/your-turn")
async def your_turn(
    lesson_id: UUID, body: YourTurnSubmit, request: Request, study=Depends(study_storage)
):
    """Verdict and guidance; the reference appears only on request or the third attempt."""
    config = settings()
    lesson = await _lesson(study, lesson_id)
    if lesson.progress.status == "locked":
        raise HTTPException(409, "Pass the previous quiz before opening this lesson.")
    if lesson.content_status != "ready" or lesson.content is None:
        raise HTTPException(409, "The lesson is not ready yet.")
    content = LessonContent.model_validate(lesson.content)
    turn = content.your_turn
    code_gap = turn.kind == "code_gap" and content.code_example and content.code_example.todo
    reference = code_gap.reference_solution if code_gap else turn.reference_answer
    attempt_number = await study.your_turn_count(lesson_id) + 1
    reveal = body.reveal or attempt_number >= REVEAL_AFTER
    answer = body.answer.strip()
    if not answer:
        if not body.reveal:
            raise HTTPException(422, "Write an answer first, or ask to see the answer.")
        verdict, feedback, explanation = None, REVEALED_BLANK, ""
    else:
        _, sections = await study.lesson_evidence(lesson_id)
        evidence, _, _ = build_evidence(sections, min(config.lesson_evidence_chars, 6000))
        token = current_budget.set(CallBudget(chat_limit=1, embedding_limit=0))
        try:
            async with asyncio.timeout(config.quiz_timeout_seconds):
                result = await YourTurnReviewer(BudgetedProvider(request.app.state.providers)).review(
                    kind=turn.kind, prompt=turn.prompt, answer=answer, reference=reference,
                    lesson={"objective": content.objective, "explanation": content.explanation},
                    evidence=evidence, reveal=reveal,
                )
        except (ReviewFailed, BudgetExceeded):
            raise HTTPException(502, REVIEW_FAILED) from None
        except TimeoutError:
            raise HTTPException(504, "The review timed out. Please retry.") from None
        except Exception as exc:
            logger.error("Your turn review failed (%s)", type(exc).__name__)
            raise HTTPException(502, REVIEW_FAILED) from None
        finally:
            current_budget.reset(token)
        verdict, feedback, explanation = result["verdict"], result["feedback"], result["explanation"]
    count = await study.record_your_turn(
        lesson_id, answer, verdict or "incorrect", feedback, reveal
    )
    return {
        "verdict": verdict,
        "feedback": feedback,
        "attempt_number": count,
        "reveal": {"answer": reference, "explanation": explanation} if reveal else None,
    }


QUIZ_FAILED = "The quiz could not be generated. Please retry."


@app.post("/lessons/{lesson_id}/quiz-attempts")
async def create_quiz_attempt(
    lesson_id: UUID, request: Request, study=Depends(study_storage)
):
    """201 with client-safe questions; supersedes any open attempt for the lesson."""
    config = settings()
    lesson = await _lesson(study, lesson_id)
    if lesson.content_status != "ready" or lesson.content is None:
        raise HTTPException(409, "Open the lesson and let it finish before taking the quiz.")
    if lesson.progress.status not in ("in_progress", "completed"):
        raise HTTPException(409, "Open the lesson before taking its quiz.")
    _, sections = await study.lesson_evidence(lesson_id)
    evidence, sources, _ = build_evidence(sections, config.lesson_evidence_chars)
    prior = await study.prior_stems(lesson_id)
    attempt_number = len(await study.quiz_attempts(lesson_id)) + 1
    token = current_budget.set(CallBudget(chat_limit=config.quiz_call_limit, embedding_limit=0))
    try:
        async with asyncio.timeout(config.quiz_timeout_seconds):
            questions = await QuizWriter(BudgetedProvider(request.app.state.providers)).write(
                {"title": lesson.title}, client_content(lesson.content) or {}, evidence,
                sources, prior, attempt_number,
            )
    except (QuizFailed, BudgetExceeded):
        raise HTTPException(502, QUIZ_FAILED) from None
    except TimeoutError:
        raise HTTPException(504, "Quiz generation timed out. Please retry.") from None
    except Exception as exc:
        logger.error("Quiz generation failed (%s)", type(exc).__name__)
        raise HTTPException(502, QUIZ_FAILED) from None
    finally:
        current_budget.reset(token)
    attempt = await study.create_quiz_attempt(
        lesson_id, [question.model_dump(mode="json") for question in questions]
    )
    return JSONResponse({
        "attempt_id": str(attempt.id),
        "lesson_id": str(lesson_id),
        "attempt_number": attempt.attempt_number,
        "questions": [question.client_view() for question in questions],
    }, status_code=201)


@app.get("/lessons/{lesson_id}/quiz-attempts")
async def quiz_history(lesson_id: UUID, study=Depends(study_storage)):
    """Scores and timestamps only; never questions or keys."""
    await _lesson(study, lesson_id)
    return [attempt.model_dump(mode="json") for attempt in await study.quiz_attempts(lesson_id)]


async def _attempt(study, attempt_id: UUID):
    try:
        return await study.quiz_attempt(attempt_id)
    except NotFound as exc:
        raise HTTPException(404, str(exc)) from exc


def _attempt_head(row) -> dict:
    return {
        "attempt_id": str(row["id"]),
        "lesson_id": str(row["lesson_id"]),
        "attempt_number": row["attempt_number"],
        "status": row["status"],
    }


@app.get("/quiz-attempts/{attempt_id}")
async def get_quiz_attempt(attempt_id: UUID, study=Depends(study_storage)):
    """Resume after refresh: open attempts return questions without keys; submitted
    attempts return their graded results; abandoned attempts return status only."""
    row = await _attempt(study, attempt_id)
    head = _attempt_head(row)
    if row["status"] == "open":
        return {**head, "questions": [QuizQuestion.model_validate(q).client_view()
                                      for q in row["questions"]]}
    if row["status"] == "submitted":
        score, passed, results = grade(row["questions"], row["answers"] or {})
        return {**head, "score": score, "passed": passed, "questions_with_results": results}
    return head


@app.post("/quiz-attempts/{attempt_id}/submit")
async def submit_quiz_attempt(
    attempt_id: UUID, body: QuizSubmit, study=Depends(study_storage),
    jobs=Depends(lesson_jobs),
):
    row = await _attempt(study, attempt_id)
    if row["status"] != "open":
        raise HTTPException(409, f"This attempt was already {row['status']}. Start a new attempt.")
    problem = answer_problem(row["questions"], body.answers)
    if problem:
        raise HTTPException(422, problem)
    score, passed, results = grade(row["questions"], body.answers)
    try:
        attempt, lesson_status, unlocked = await study.submit_quiz_attempt(
            attempt_id, body.answers, score, passed
        )
    except Conflict as exc:
        raise HTTPException(409, str(exc)) from exc
    if unlocked is not None:
        try:
            # Prepare the newly unlocked lesson in the background (#23).
            await jobs.prefetch(unlocked)
        except Exception as exc:
            logger.warning("Lesson prefetch failed (%s)", type(exc).__name__)
    return {
        **_attempt_head({**row, "status": attempt.status}),
        "score": score,
        "passed": passed,
        "questions_with_results": results,
        "lesson_status": lesson_status,
        "unlocked_lesson_id": str(unlocked) if unlocked else None,
    }


@app.get("/conversations/{thread_id}/messages")
async def messages(
    thread_id: UUID,
    before: int = QueryParam(default=2**63 - 1, ge=1),
    limit: int = QueryParam(default=20, ge=1, le=50),
    store=Depends(storage),
):
    try:
        return await store.history(thread_id, before, limit)
    except NotFound as exc:
        raise HTTPException(404, str(exc)) from exc


def event(name, data):
    return f"event: {name}\ndata: {json.dumps(data, default=str)}\n\n"


@app.post("/query")
async def query(body: Query, request: Request, store=Depends(storage)):
    config = settings()
    lesson, thread_param = None, body.thread_id
    if body.lesson_id is not None:
        study = getattr(request.app.state, "study", None)
        if study is None:
            raise HTTPException(503, "DATABASE_URL is not configured")
        lesson = await _lesson(study, body.lesson_id)
        if lesson.progress.status == "locked":
            raise HTTPException(409, "Pass the previous quiz before opening this lesson.")
        if set(body.document_ids) != {lesson.document_id}:
            raise HTTPException(409, "Lesson questions use the course's document only.")
        bound = await study.lesson_conversation(body.lesson_id)
        if thread_param is None:
            thread_param = bound
        elif bound != thread_param:
            raise HTTPException(409, "This chat does not belong to the lesson.")
    try:
        thread_id, version, history = await store.conversation(
            thread_param,
            body.document_ids,
            config.embedding_signature,
            config.history_exchanges * 2,
        )
    except NotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    except Conflict as exc:
        raise HTTPException(409, str(exc)) from exc
    tutor = {}
    history_text = recent_context(history, config.history_max_chars)
    if lesson is not None:
        if thread_param is None:
            await request.app.state.study.bind_conversation(body.lesson_id, thread_id)
        summary, history_text = tutor_context(
            lesson_summary(lesson.title, client_content(lesson.content)),
            history_text,
            config.history_max_chars,
        )
        tutor = {"lesson_context": summary,
                 "answer_requested": asked_for_answer(body.user_query)}

    async def stream():
        runtime_id = str(request.app.state.runtime.instance_id)
        yield event("session", {"thread_id": thread_id, "runtime_id": runtime_id})
        workflow = Workflow(
            request.app.state.providers,
            store,
            stream_answer=True,
            # Master mode never searches the web.
            web_client=None if lesson else getattr(request.app.state, "web_search", None),
            timeout_seconds=config.request_timeout_seconds,
            max_sub_questions=config.max_sub_questions,
            hyde_enabled=config.hyde_enabled,
            research_concurrency=config.research_concurrency,
            research_limiter=request.app.state.research_limiter,
            chat_call_limit=config.chat_call_limit,
            embedding_call_limit=config.embedding_call_limit,
            boost_sections=frozenset(lesson.source_section_ids) if lesson else frozenset(),
        )
        final = {}
        try:
            async with asyncio.timeout(config.request_timeout_seconds):
                async for mode, update in workflow.graph.astream(
                    {
                        "deadline": time.monotonic() + config.request_timeout_seconds,
                        "question": body.user_query,
                        "document_ids": body.document_ids,
                        "history": history_text,
                        **tutor,
                    },
                    stream_mode=["updates", "custom"],
                ):
                    if mode == "custom":
                        if isinstance(update, dict) and update.get("type") == "progress":
                            yield event("progress", update)
                        elif isinstance(update, dict) and isinstance(update.get("delta"), str):
                            yield event("token", {"delta": update["delta"]})
                        continue
                    for step, values in update.items():
                        final.update(values)
                if final.get("status") != "succeeded":
                    failure = final.get("failure") or {}
                    message = (
                        "Request timed out; retry with a narrower question."
                        if failure.get("code") == "deadline_exceeded"
                        else "Request failed. Please retry or check backend configuration."
                    )
                    if failure.get("code") == "budget_exceeded":
                        message = "Request call budget exhausted; retry with a narrower question."
                    yield event("error", {"message": message, "usage": final.get("usage", {})})
                    return
                saved_question, saved_answer, saved_citations = safe_turn(
                    body.user_query,
                    final["answer"],
                    final["citations"],
                    final.get("document_answer"),
                )
                await store.save_turn(
                    thread_id, version, saved_question, saved_answer, saved_citations
                )
                yield event(
                    "result",
                    {
                        "thread_id": thread_id,
                        "answer": final["answer"],
                        "citations": final["citations"],
                        "warnings": list(dict.fromkeys(final.get("warnings", []))),
                        "usage": final.get("usage", {}),
                        "plan_size": final.get("plan_size", 0),
                        **(
                            {
                                "persisted_answer": saved_answer,
                                "persisted_citations": saved_citations,
                            }
                            if final.get("web_requested")
                            else {}
                        ),
                    },
                )
        except TimeoutError:
            yield event("error", {"message": "Request timed out; retry with a narrower question."})
        except (ProviderError, Conflict) as exc:
            yield event("error", {"message": str(exc)})
        except Exception as exc:
            # Do not log database DSNs, prompts, provider bodies or exception messages.
            logger.error("Query failed (%s)", type(exc).__name__)
            yield event("error", {"message": "Request failed. Check backend configuration."})

    async def managed_stream():
        completed = False
        try:
            async for item in stream():
                yield item
            completed = True
        finally:
            # A disconnected first request may never deliver its server ID to the
            # browser. Remove only the empty draft, never a completed conversation.
            if not completed and thread_param is None and hasattr(store, "discard_empty"):
                try:
                    await asyncio.shield(store.discard_empty(thread_id))
                except Exception:
                    logger.warning("Empty conversation cleanup failed")

    return StreamingResponse(
        managed_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


@app.post("/documents/upload", status_code=201)
async def upload_document(
    request: Request,
    filename: str = QueryParam(min_length=1, max_length=255),
    store=Depends(storage),
):
    data = bytearray()
    async for part in request.stream():
        if len(data) + len(part) > MAX_BYTES:
            raise HTTPException(413, "File exceeds 10 MB.")
        data.extend(part)
    try:
        document = await asyncio.to_thread(extract_document, filename, bytes(data))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    try:
        async with asyncio.timeout(settings().upload_timeout_seconds):
            count = await ingest(document, settings(), request.app.state.providers)
    except TimeoutError:
        raise HTTPException(504, "Indexing timed out. Try a smaller document.") from None
    except Conflict as exc:
        raise HTTPException(409, str(exc)) from None
    except ProviderError as exc:
        raise HTTPException(502, str(exc)) from exc
    except Exception as exc:
        logger.error("Upload failed (%s)", type(exc).__name__)
        raise HTTPException(500, "Indexing failed. Check backend configuration.") from None
    return {
        "id": document.id,
        "title": document.title,
        "edition": document.edition,
        "chunks": count,
    }
