"""Courses and plans (#21, #22, #27, #28) beyond the check_web_master happy path:
library loading/error/retry, creating from an existing source, duplicates, polling
fallback with leave/return/refresh, failure and retry, locks and estimates,
Start -> Continue, and deletion cancel/failure/retry with the source retained."""

import re

from playwright.sync_api import expect

from e2e.conftest import alerts, release_when_held
from e2e.router import error, ok
from scripts.check_web_master import COURSE, DOC, LESSONS

COURSES = "/workspace/courses"
PLAN = f"{COURSES}/{COURSE}"


def ready(backend):
    backend.documents = [{"id": DOC, "title": "Archive Handbook", "edition": "fixture"}]
    backend.course_status, backend.plan_ready = "ready", True
    return backend


def test_library_loading_error_and_retry(page, api, master, console):
    console.allow(r"status of 503")
    api.on("GET", "courses", error("Cannot load courses.", 503))
    page.goto(COURSES)
    expect(alerts(page)).to_contain_text("Cannot load courses.")
    api.on("GET", "courses", hold=True)
    page.get_by_role("button", name="Retry").click()
    release_when_held(page, api, "courses", ok([]))
    expect(page.get_by_role("heading", level=2, name="No courses yet")).to_be_visible()
    expect(alerts(page)).to_have_count(0)


def test_create_from_existing_source_and_no_duplicate(page, api, master, console):
    master.documents = [{"id": DOC, "title": "Archive Handbook", "edition": "fixture"}]
    page.goto(COURSES)
    page.get_by_role("button", name="Add a document").click()
    dialog = page.get_by_role("dialog")
    dialog.get_by_role("tab", name="From your sources").click()
    create = dialog.get_by_role("button", name="Create course")
    expect(create).to_be_disabled()
    dialog.get_by_role("radio", name=re.compile("Archive Handbook")).check()
    create.click()
    expect(page).to_have_url(re.compile(PLAN + "$"))
    assert [c.body for c in api.calls("POST", "courses")] == [{"document_id": DOC}]
    # The source now has a course, so it is not offered again.
    page.goto(COURSES)
    page.get_by_role("button", name="New course").click()
    page.get_by_role("dialog").get_by_role("tab", name="From your sources").click()
    expect(page.get_by_text("Every source already has a course.")).to_be_visible()
    expect(page.get_by_role("radio")).to_have_count(0)


def test_generation_polls_after_the_stream_ends_and_survives_leave_and_refresh(page, api, master, console):
    master.documents = [{"id": DOC, "title": "Archive Handbook", "edition": "fixture"}]
    master.course_status = "generating"
    page.goto(PLAN)
    expect(page.get_by_role("heading", name="Preparing your lesson plan")).to_be_visible()
    expect(page.get_by_text("Document read")).to_be_visible()
    # The events stream ends without a status frame: the page falls back to polling.
    page.get_by_role("link", name="Back to courses").click()
    expect(page.get_by_role("list", name="Your courses").get_by_text("Generating", exact=True)).to_be_visible()
    page.go_back()
    expect(page.get_by_role("heading", name="Preparing your lesson plan")).to_be_visible()
    page.reload()
    expect(page.get_by_role("heading", name="Preparing your lesson plan")).to_be_visible()
    polls_before = len(api.requests)
    master.plan_ready = True
    expect(page.get_by_role("button", name=re.compile(r"^1\. Labels and retention"))).to_be_visible(timeout=10000)
    assert len(api.requests) > polls_before
    assert len(api.calls("GET", f"courses/{COURSE}/events")) >= 2


def test_failed_plan_shows_reason_and_retries(page, api, master, console):
    master.documents = [{"id": DOC, "title": "Archive Handbook", "edition": "fixture"}]
    master.course_status, master.failure_code = "failed", "timeout"
    page.goto(PLAN)
    expect(alerts(page)).to_contain_text("Planning took too long.")
    page.get_by_role("button", name="Retry").click()
    expect(page.get_by_role("heading", name="Preparing your lesson plan")).to_be_visible()
    assert api.calls("POST", "courses")[-1].body == {"document_id": DOC}
    master.plan_ready = True
    expect(page.get_by_text("0 of 3 lessons completed")).to_be_visible(timeout=10000)


def test_plan_locks_estimates_and_start_then_continue(page, api, master, console):
    ready(master)
    page.goto(PLAN)
    expect(page.get_by_text(re.compile(r"≈ 18 min of lessons"))).to_be_visible()
    expect(page.get_by_role("link", name="Start the first lesson")).to_have_attribute(
        "href", f"{PLAN}/lessons/{LESSONS[0][0]}")
    module_one = page.get_by_role("button", name=re.compile(r"^1\. Labels and retention"))
    expect(module_one).to_have_attribute("aria-expanded", "true")
    lessons = page.get_by_role("list", name="Lessons in Labels and retention")
    expect(lessons.get_by_role("link")).to_have_count(1)
    locked = lessons.locator('[aria-disabled="true"]')
    expect(locked).to_have_count(1)
    expect(locked).to_have_attribute("title", "Pass the previous quiz to unlock")
    expect(locked).to_contain_text("Locked")
    expect(lessons.get_by_role("link")).to_contain_text("≈ 6 min")
    # Opening (but not completing) the first lesson switches the label to Continue.
    master.status[LESSONS[0][0]] = "in_progress"
    page.reload()
    continue_link = page.get_by_role("link", name="Continue")
    expect(continue_link).to_have_attribute("href", f"{PLAN}/lessons/{LESSONS[0][0]}")
    expect(page.get_by_role("link", name="Start the first lesson")).to_have_count(0)
    continue_link.click()
    expect(page).to_have_url(re.compile(LESSONS[0][0]))


def test_course_deletion_cancel_failure_retry_and_source_kept(page, api, master, console):
    ready(master)
    console.allow(r"status of 503")

    def deleted(request):
        master.course_status = None
        return ok({"status": "deleted", "id": COURSE})

    api.on("DELETE", f"courses/{COURSE}",
           error("Course deletion failed. Retry when the database is available.", 503), deleted)
    page.goto(COURSES)
    card = page.get_by_role("listitem").filter(has_text="Archive Handbook")
    card.get_by_role("button", name="Delete Archive Handbook").click()
    dialog = page.get_by_role("dialog")
    expect(dialog).to_contain_text("The source document is kept")
    dialog.get_by_role("button", name="Cancel").click()
    expect(dialog).to_have_count(0)
    assert not api.calls("DELETE", f"courses/{COURSE}")
    card.get_by_role("button", name="Delete Archive Handbook").click()
    page.get_by_role("dialog").get_by_role("button", name="Delete", exact=True).click()
    expect(page.get_by_role("dialog").get_by_role("alert")).to_contain_text("Course deletion failed")
    page.get_by_role("dialog").get_by_role("button", name="Retry deletion").click()
    expect(page.get_by_role("heading", level=2, name="No courses yet")).to_be_visible()
    assert len(api.calls("DELETE", f"courses/{COURSE}")) == 2
    assert not api.calls("DELETE", f"documents/{DOC}")
    # The source is still available for a new course.
    page.get_by_role("button", name="Add a document").click()
    page.get_by_role("dialog").get_by_role("tab", name="From your sources").click()
    expect(page.get_by_role("radio", name=re.compile("Archive Handbook"))).to_be_visible()
