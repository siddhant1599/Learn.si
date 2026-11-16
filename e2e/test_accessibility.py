"""Responsive and accessible UI: critical Ask and Master journeys at 390 px, automated
axe-core checks (WCAG 2 A/AA) on every affected view in light and dark, keyboard focus
restoration for dialogs, and reduced motion. Reviewed axe exceptions are listed in
REVIEWED_EXCEPTIONS with the reason; anything else fails."""

import re
from pathlib import Path

import pytest
from playwright.sync_api import expect

from e2e.conftest import DOC as ASK_DOC
from e2e.conftest import no_overflow, set_theme
from e2e.router import sse
from scripts.check_web_master import COURSE, DOC, FIXTURES, LESSONS

AXE = Path(__file__).resolve().parents[1] / "web" / "node_modules" / "axe-core" / "axe.min.js"
LESSON = LESSONS[0][0]
VIEWS = {
    "chooser": "/workspace",
    "courses": "/workspace/courses",
    "plan": f"/workspace/courses/{COURSE}",
    "course-progress": f"/workspace/courses/{COURSE}?tab=progress",
    "lesson": f"/workspace/courses/{COURSE}/lessons/{LESSON}",
    "quiz": f"/workspace/courses/{COURSE}/lessons/{LESSON}/quiz",
    "progress": "/workspace/progress",
    "ask": "/workspace/chats/new",
    "docs": "/docs/progress",
}
# rule id -> reason. Keep this list short and reviewed; it is reported with results.
REVIEWED_EXCEPTIONS: dict[str, str] = {}


def ready(backend):
    backend.documents = [{"id": DOC, "title": "Archive Handbook", "edition": "fixture"}]
    backend.course_status, backend.plan_ready, backend.lesson_ready = "ready", True, True
    backend.status[LESSON] = "in_progress"
    backend.content_status[LESSON] = "ready"


def axe(page) -> list[dict]:
    page.add_script_tag(path=str(AXE))
    result = page.evaluate("""async () => {
      const r = await axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']},
                                         resultTypes: ['violations']});
      return r.violations.map(v => ({id: v.id, impact: v.impact, help: v.help,
        nodes: v.nodes.slice(0, 6).map(n => n.target.join(' ') + ' :: ' + ((n.any[0] || {}).message || '').slice(0, 140))}));
    }""")
    return [v for v in result if v["id"] not in REVIEWED_EXCEPTIONS]


@pytest.mark.parametrize("theme", ["light", "dark"])
@pytest.mark.parametrize("view", list(VIEWS))
def test_axe_has_no_violations(page, api, master, console, view, theme):
    ready(master)
    page.goto(VIEWS[view])
    expect(page.get_by_role("heading", level=1)).to_be_visible()
    if view in ("lesson",):
        expect(page.get_by_role("heading", level=2, name="Your turn")).to_be_visible()
    if view == "quiz":
        expect(page.get_by_role("radiogroup")).to_have_count(3)
    if view in ("plan", "course-progress", "progress"):
        page.wait_for_load_state("networkidle")
    set_theme(page, theme)
    page.wait_for_timeout(150)  # Let theme transitions settle before measuring contrast.
    violations = axe(page)
    assert not violations, violations
    no_overflow(page, f"{view} {theme}")


def test_master_journey_on_a_phone_in_dark(page, api, master, console):
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto("/workspace/courses")
    set_theme(page, "dark")
    page.get_by_role("button", name="Add a document").click()
    page.get_by_label("Upload a document for a new course").set_input_files(str(FIXTURES / "handbook.md"))
    expect(page).to_have_url(re.compile(COURSE))
    no_overflow(page, "generation")
    master.plan_ready = True
    page.get_by_role("link", name="Start the first lesson").click()
    master.lesson_ready = True
    expect(page.get_by_role("heading", level=2, name="Your turn")).to_be_visible(timeout=10000)
    no_overflow(page, "lesson")
    # On a phone the tutor sits below the lesson and is reachable.
    tutor = page.get_by_role("complementary", name="Tutor")
    tutor.scroll_into_view_if_needed()
    expect(tutor.get_by_label("Ask the tutor")).to_be_visible()
    page.get_by_role("link", name="Take the quiz").click()
    expect(page.get_by_role("radiogroup")).to_have_count(3)
    no_overflow(page, "quiz")
    for index, text in enumerate(_correct(master)):
        page.get_by_role("radiogroup").nth(index).locator("label", has_text=text).click()
    page.get_by_role("button", name="Submit answers").click()
    expect(page.locator("[data-passed]")).to_contain_text("3/3 · Passed")
    no_overflow(page, "results")
    page.goto("/workspace/progress")
    expect(page.get_by_role("region", name="Totals")).to_contain_text("Lessons completed1of 3")
    no_overflow(page, "progress")


def _correct(backend):
    return [next(o["text"] for o in q["options"] if o["id"] == q["correct_option_id"]) for q in backend.quiz_sets[0]]


def test_ask_journey_on_a_phone(page, ask_world, console):
    api = ask_world
    api.on("POST", "query", sse(
        ("session", {"thread_id": "44444444-4444-4444-8444-444444444444"}),
        ("token", {"delta": "Labels are "}),
        ("result", {"thread_id": "44444444-4444-4444-8444-444444444444", "answer": "Labels are blue [1].",
                    "citations": [{"citation": 1, "document_id": ASK_DOC, "document_title": "Synthetic handbook",
                                   "edition": "test", "number": "1", "kind": "section", "page": 2}], "warnings": []})))
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto("/workspace/chats/new")
    page.get_by_role("button", name="Toggle Sidebar").first.click()
    page.get_by_role("checkbox").first.check()
    page.keyboard.press("Escape")
    page.get_by_role("textbox", name="Message", exact=True).fill("What color are labels?")
    page.get_by_role("button", name="Send", exact=True).click()
    expect(page.get_by_text("Labels are blue")).to_be_visible()
    expect(page.get_by_label("Sources").get_by_text("[1] Synthetic handbook · Page 2")).to_be_visible()
    no_overflow(page, "ask answer")


def test_dialogs_trap_and_restore_focus(page, api, master, console):
    ready(master)
    page.goto("/workspace/courses")
    trigger = page.get_by_role("button", name="New course")
    trigger.focus()
    page.keyboard.press("Enter")
    dialog = page.get_by_role("dialog")
    expect(dialog).to_be_visible()
    expect(dialog.locator(":focus")).to_have_count(1)  # Focus moved into the dialog.
    for _ in range(8):
        page.keyboard.press("Tab")
        expect(dialog.locator(":focus")).to_have_count(1)  # And stays there.
    page.keyboard.press("Escape")
    expect(dialog).to_have_count(0)
    expect(trigger).to_be_focused()
    delete = page.get_by_role("button", name="Delete Archive Handbook")
    delete.focus()
    page.keyboard.press("Enter")
    expect(page.get_by_role("dialog").get_by_role("button", name="Cancel")).to_be_focused()
    page.keyboard.press("Escape")
    expect(delete).to_be_focused()


def test_reduced_motion_stops_spinners(browser, api, master, console, base_url):
    context = browser.new_context(reduced_motion="reduce", base_url=base_url)
    api.install(context)
    page = context.new_page()
    master.documents = [{"id": DOC, "title": "Archive Handbook", "edition": "fixture"}]
    master.course_status = "generating"
    page.goto(f"/workspace/courses/{COURSE}")
    spinner = page.locator(".animate-spin").first
    expect(spinner).to_be_attached()
    assert spinner.evaluate("n => getComputedStyle(n).animationName") == "none"
    context.close()
