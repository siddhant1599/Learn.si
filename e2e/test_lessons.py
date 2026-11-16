"""Lessons and tutor (#23, #25, #29): failure/retry, regeneration and its limit,
limited-source note, Your turn empty/partial/correct/reveal, tutor guidance first
and the direct answer on request, lesson-scoped history after reload, no web
behavior, and server-only answers absent from responses and browser storage."""

import json
import re

from playwright.sync_api import expect

from e2e.conftest import alerts, storage_dump
from e2e.router import error, ok, sse
from scripts.check_web_master import COURSE, DOC, LESSONS

LESSON = LESSONS[0][0]
URL = f"/workspace/courses/{COURSE}/lessons/{LESSON}"
THREAD = "ffffffff-0000-4000-8000-0000000000aa"
HINT = "Look at the Labels section [1]. Which part of a label do shelves sort by?"
DIRECT = "Shelves sort by collection code, so the code is printed first [1]."
SECRET = ("HR-007", "reference_answer", "reference_solution")


def ready(backend, lesson_status="in_progress"):
    backend.documents = [{"id": DOC, "title": "Archive Handbook", "edition": "fixture"}]
    backend.course_status, backend.plan_ready, backend.lesson_ready = "ready", True, True
    backend.status[LESSON] = lesson_status
    backend.content_status[LESSON] = "ready"
    return backend


def test_failed_generation_retries_and_regeneration_respects_the_limit(page, api, master, console):
    ready(master)
    console.allow(r"status of 429")
    failed = {**master.lesson(LESSON), "content_status": "failed", "content": None,
              "content_failure_code": "ungrounded"}
    api.on("GET", f"lessons/{LESSON}", ok(failed))

    def regenerate(request):
        api.on("GET", f"lessons/{LESSON}", ok(master.lesson(LESSON)))
        return ok({**master.lesson(LESSON), "content_status": "generating", "content": None}, 202)

    api.on("POST", f"lessons/{LESSON}/regenerate", regenerate,
           error("Daily regeneration limit reached for this lesson.", 429))
    page.goto(URL)
    expect(alerts(page)).to_contain_text("The draft's citations could not be verified against the document.")
    expect(page.get_by_role("button", name="Take the quiz")).to_be_disabled()
    page.get_by_role("button", name="Retry").click()
    expect(page.get_by_role("heading", level=2, name="Explanation")).to_be_visible(timeout=10000)
    # Regenerating a ready lesson asks first; the server limit is reported.
    page.get_by_role("button", name="Lesson options").click()
    page.get_by_role("menuitem", name="Regenerate lesson").click()
    dialog = page.get_by_role("dialog")
    expect(dialog).to_contain_text("progress and quiz attempts are kept")
    dialog.get_by_role("button", name="Cancel").click()
    expect(page.get_by_role("button", name="Lesson options")).to_be_focused()  # Focus returns to the menu.
    assert len(api.calls("POST", f"lessons/{LESSON}/regenerate")) == 1
    page.get_by_role("button", name="Lesson options").click()
    page.get_by_role("menuitem", name="Regenerate lesson").click()
    page.get_by_role("dialog").get_by_role("button", name="Regenerate").click()
    expect(alerts(page)).to_contain_text("Daily regeneration limit reached")
    expect(page.get_by_role("heading", level=2, name="Explanation")).to_be_visible()


def test_limited_source_note_is_shown(page, api, master, console):
    ready(master)
    lesson = master.lesson(LESSON)
    lesson["content"] = {**lesson["content"], "coverage_note": "Limited source coverage: the document says little about this topic, so this lesson covers only what it states."}
    api.on("GET", f"lessons/{LESSON}", ok(lesson))
    page.goto(URL)
    note = page.get_by_role("note").filter(has_text="Limited source coverage")
    expect(note).to_be_visible()


def test_your_turn_empty_partial_correct_and_reveal(page, api, master, console):
    ready(master)
    api.on("POST", f"lessons/{LESSON}/your-turn",
           ok({"verdict": "partial", "feedback": "Close: check the order. Which part do shelves sort by [1]?",
               "attempt_number": 1, "reveal": None}),
           ok({"verdict": "correct", "feedback": "Right: code, number, dates, category.", "attempt_number": 2,
               "reveal": None}),
           ok({"verdict": "correct", "feedback": "Here is the full answer.", "attempt_number": 3,
               "reveal": {"answer": "HR-007, 2015–2016, Standard", "explanation": "Labels go code, number, dates, category."}}))
    page.goto(URL)
    answer = page.get_by_label("Your answer")
    check = page.get_by_role("button", name="Check my answer")
    expect(check).to_be_disabled()  # Empty answers cannot be submitted.
    answer.fill("Standard, HR, 7")
    check.click()
    status = page.locator("[data-verdict]")
    expect(status).to_have_attribute("data-verdict", "partial")
    expect(status).to_have_attribute("aria-live", "polite")
    expect(status).to_contain_text("Partly right")
    expect(page.get_by_text("HR-007")).to_have_count(0)
    answer.fill("HR-007, 2015-2016, Standard")
    check.click()
    expect(status).to_have_attribute("data-verdict", "correct")
    expect(page.get_by_text("Attempt 2 of ∞")).to_be_visible()
    page.get_by_role("button", name="Show the answer").click()
    expect(page.get_by_text("Labels go code, number, dates, category.")).to_be_visible()
    bodies = [c.body for c in api.calls("POST", f"lessons/{LESSON}/your-turn")]
    assert bodies == [{"answer": "Standard, HR, 7", "reveal": False},
                      {"answer": "HR-007, 2015-2016, Standard", "reveal": False},
                      {"answer": "HR-007, 2015-2016, Standard", "reveal": True}]


def test_tutor_guides_first_answers_on_request_and_keeps_history(page, api, master, console):
    ready(master)
    history = []

    def query(request):
        asked = request.body["user_query"]
        answer = DIRECT if "answer" in asked.lower() else HINT
        history.extend([{"id": len(history) + 1, "role": "user", "content": asked, "citations": []},
                        {"id": len(history) + 2, "role": "assistant", "content": answer,
                         "citations": [{**master.sources[0], "source_type": "document"}]}])
        return sse(("session", {"thread_id": THREAD, "runtime_id": "fixture"}),
                   ("progress", {"type": "progress", "version": 1, "step": "retrieve", "id": "retrieve",
                                 "status": "completed", "attempt": 0, "sequence": 1}),
                   ("result", {"thread_id": THREAD, "answer": answer, "warnings": [],
                               "citations": [{**master.sources[0], "source_type": "document"}]}))

    api.on("POST", "query", query)
    api.on("GET", f"lessons/{LESSON}/conversation",
           lambda r: ok({"thread_id": THREAD if history else None, "messages": history}))
    page.goto(URL)
    tutor = page.get_by_role("complementary", name="Tutor")
    expect(tutor).to_contain_text("I'll guide you first")
    tutor.get_by_role("button", name="Why is this true?").click()
    expect(tutor.get_by_text(HINT)).to_be_visible()
    tutor.get_by_role("button", name="Just tell me the answer").click()
    expect(tutor.get_by_text(DIRECT)).to_be_visible()
    first, second = (c.body for c in api.calls("POST", "query"))
    assert first == {"user_query": "Why is this true?", "document_ids": [DOC], "thread_id": None, "lesson_id": LESSON}
    assert second["thread_id"] == THREAD and second["lesson_id"] == LESSON
    # Document-only: no web activity or web citations, no depth control.
    expect(page.get_by_text(re.compile(r"^Web ·"))).to_have_count(0)
    expect(page.get_by_text("Researching missing evidence on the web")).to_have_count(0)
    expect(tutor.get_by_role("button", name=re.compile("depth|reasoning", re.I))).to_have_count(0)
    # History is lesson-scoped and comes back after a reload; nothing of it is in browser storage.
    page.reload()
    expect(page.get_by_role("complementary", name="Tutor").get_by_text(DIRECT)).to_be_visible()
    dump = storage_dump(page)
    assert DIRECT not in dump and HINT not in dump and "Shelves sort by" not in dump
    content = master.content
    assert content["explanation"][:60] not in dump  # Lesson text is not cached either.
    for body in api.bodies("GET", r"lessons/.*") + api.bodies("POST", "query"):
        for secret in SECRET:
            assert secret not in body, secret


def test_lesson_responses_never_carry_server_only_answers(page, api, master, console):
    ready(master)
    page.goto(URL)
    expect(page.get_by_role("heading", level=2, name="Your turn")).to_be_visible()
    lessons = api.bodies("GET", f"lessons/{LESSON}")
    assert lessons, "the lesson was not fetched"
    for body in lessons:
        assert "reference_answer" not in json.dumps(json.loads(body)["content"]["your_turn"])
    for body in api.bodies("GET", r"lessons/.*"):  # Lesson, tutor history and every other lesson route.
        for secret in SECRET:
            assert secret not in body, secret
