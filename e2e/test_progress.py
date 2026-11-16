"""Progress and study time (#26, #31): values match the fixture-derived API, mastery
labels and quiz metrics, time formatting, loading/empty/error/refresh, and the
passive heartbeat that only runs while visible and focused, with no countdown."""

import re
from datetime import timedelta

from playwright.sync_api import expect

from app.study.models import QuizQuestion
from app.study.quiz import grade
from e2e.conftest import alerts, release_when_held, wait_until
from e2e.router import error, ok
from scripts.check_web_master import COURSE, DOC, LESSONS, T0

LESSON = LESSONS[0][0]
VISIBILITY = """(() => {
  let visible = true, focused = true;
  Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => visible ? 'visible' : 'hidden'});
  Object.defineProperty(document, 'hidden', {configurable: true, get: () => !visible});
  document.hasFocus = () => focused;
  window.__setVisible = (v) => { visible = v; document.dispatchEvent(new Event('visibilitychange')); };
  window.__setFocused = (f) => { focused = f; window.dispatchEvent(new Event(f ? 'focus' : 'blur')); };
})();"""


def ready(backend):
    backend.documents = [{"id": DOC, "title": "Archive Handbook", "edition": "fixture"}]
    backend.course_status, backend.plan_ready, backend.lesson_ready = "ready", True, True
    backend.status[LESSON] = "in_progress"
    backend.content_status[LESSON] = "ready"
    return backend


def pass_first_lesson(backend):
    """Record a 3/3 first-try pass and a correct Your turn: lesson 1 is Mastered."""
    attempt_questions = [{**q, "id": f"q{i}"} for i, q in enumerate(backend.quiz_sets[0], 1)]
    answers = {q["id"]: q["correct_option_id"] for q in attempt_questions}
    stored = [QuizQuestion.model_validate({**q, "citation": backend.sources[0]}).model_dump(mode="json")
              for q in attempt_questions]
    score, passed, _ = grade(stored, answers)
    backend.attempts.append({"id": "bbbbbbbb-0000-4000-8000-0000000000f1", "lesson_id": LESSON, "attempt_number": 1,
                             "status": "submitted", "score": score, "passed": passed, "questions": stored,
                             "answers": answers, "submitted_at": T0 + timedelta(minutes=5)})
    backend.your_turn.append((LESSON, "correct"))
    backend.status[LESSON], backend.status[LESSONS[1][0]] = "completed", "available"
    backend.completed[LESSON] = T0 + timedelta(minutes=6)
    backend.study[LESSON] = 4320



def test_overview_values_mastery_and_formatting(page, api, master, console):
    ready(master)
    pass_first_lesson(master)
    page.goto("/workspace/progress")
    totals = page.get_by_role("region", name="Totals")
    expect(totals).to_contain_text("Courses1")
    expect(totals).to_contain_text("Lessons completed1of 3")
    expect(totals).to_contain_text("Quizzes passed1of 1 attempts")
    expect(totals).to_contain_text("Study time1 h 12 min")
    card = page.locator(f'[data-course="{COURSE}"]')
    expect(card).to_contain_text("33%")
    expect(card.get_by_role("img")).to_have_accessible_name(re.compile(r"3 lessons: 2 not started, 1 mastered"))
    expect(card.get_by_role("link", name="Continue")).to_have_attribute("href", re.compile(LESSONS[1][0]))
    expect(page.get_by_text(re.compile(r"Quiz passed 3/3 · Archive labels"))).to_be_visible()
    expect(page.get_by_text(re.compile(r"Lesson completed · Archive labels"))).to_be_visible()
    body = page.locator("main, body").first.inner_text()
    assert not re.search(r"countdown|time left to|remaining:|expires", body, re.I)


def test_course_progress_tab_quiz_metrics_and_levels(page, api, master, console):
    ready(master)
    pass_first_lesson(master)
    page.goto(f"/workspace/courses/{COURSE}?tab=progress")
    expect(page.get_by_role("tab", name="Progress", selected=True)).to_be_visible()
    quiz = page.get_by_role("region", name="Quiz performance")
    expect(quiz).to_contain_text("Attempts1Pass rate100%First-try pass rate100%Average score3/3")
    bloom = page.get_by_role("table", name="Correct answers by question type")
    rows = bloom.get_by_role("row")
    expect(rows).to_have_count(4)
    for index, level in enumerate(("Recall", "Apply", "Analyze"), 1):
        expect(rows.nth(index).get_by_role("rowheader")).to_have_text(level)
        expect(rows.nth(index).get_by_role("cell")).to_have_text(["1", "1"])
    expect(page.get_by_text("1/1 · 100%")).to_have_count(3)
    lessons = page.get_by_role("table", name=re.compile("per lesson"))
    first = lessons.get_by_role("row").nth(1)
    expect(first).to_contain_text("Completed")
    expect(first).to_contain_text("Passed")
    expect(first).to_contain_text("Mastered")
    expect(first).to_contain_text("1 h 12 min")
    page.get_by_text("What do the mastery levels mean?").click()
    expect(page.get_by_text(re.compile(r"First attempt 3/3"))).to_be_visible()
    expect(page.get_by_text("Estimates are informational; nothing is timed.", exact=False)).to_be_visible()


def test_overview_loading_empty_error_and_refresh(page, api, master, console):
    console.allow(r"status of 503")
    api.on("GET", "progress", hold=True)
    page.goto("/workspace/progress")
    expect(page.locator('[aria-busy="true"]')).to_be_visible()
    release_when_held(page, api, "progress", error("Cannot load progress.", 503))
    expect(alerts(page)).to_contain_text("Cannot load progress.")
    api.on("GET", "progress", ok({"totals": {"courses": 0, "lessons_completed": 0, "lessons_total": 0,
                                             "study_seconds": 0, "quiz_attempts": 0, "quizzes_passed": 0},
                                  "courses": [], "recent": []}))
    page.get_by_role("button", name="Retry").click()
    expect(page.get_by_role("heading", name="No progress yet")).to_be_visible()
    expect(page.get_by_role("link", name="Go to courses")).to_have_attribute("href", "/workspace/courses")
    before = len(api.calls("GET", "progress"))
    page.get_by_role("button", name="Refresh").click()
    wait_until(page, lambda: len(api.calls("GET", "progress")) > before)


def test_heartbeat_only_while_visible_and_focused(page, api, master, console):
    ready(master)
    page.add_init_script(VISIBILITY)
    page.clock.install()
    page.goto(f"/workspace/courses/{COURSE}/lessons/{LESSON}")
    expect(page.get_by_role("heading", level=2, name="Explanation")).to_be_visible()
    beats = lambda: [c.body for c in api.calls("POST", f"lessons/{LESSON}/study-time")]  # noqa: E731
    page.clock.run_for(30_000)
    wait_until(page, lambda: len(beats()) == 1)
    assert beats() == [{"seconds": 30}]
    # Hidden: one flush for the partial interval, then nothing while hidden.
    page.clock.run_for(10_000)
    page.evaluate("window.__setVisible(false)")
    wait_until(page, lambda: len(beats()) == 2)
    assert beats()[-1] == {"seconds": 10}
    page.clock.run_for(120_000)
    page.wait_for_timeout(200)
    assert len(beats()) == 2
    # Visible but unfocused: still nothing.
    page.evaluate("window.__setVisible(true)")
    page.evaluate("window.__setFocused(false)")
    page.clock.run_for(90_000)
    page.wait_for_timeout(200)
    assert len(beats()) == 2
    # Focused again: credits resume, never more than 60 s per beat.
    page.evaluate("window.__setFocused(true)")
    page.clock.run_for(30_000)
    wait_until(page, lambda: len(beats()) == 3)
    assert all(1 <= b["seconds"] <= 60 for b in beats())
    # Leaving the lesson stops the heartbeat.
    page.get_by_role("link", name="Courses").first.click()
    expect(page).to_have_url(re.compile(r"/workspace/courses$"))
    count = len(beats())
    page.clock.run_for(120_000)
    page.wait_for_timeout(200)
    assert len(beats()) <= count + 1  # At most one final flush on leaving.
    after = len(beats())
    page.clock.run_for(120_000)
    page.wait_for_timeout(200)
    assert len(beats()) == after

