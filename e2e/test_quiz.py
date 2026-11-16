"""Quiz and unlocking (#24, #30) beyond check_web_master: structure, keyboard,
0/3 fail and 3/3 pass with explanations and citations, refresh resume, network retry
keeping answers, superseded attempts (409), history, and the unlock reaching the plan
without a full page reload."""

import re

from playwright.sync_api import expect

from e2e.conftest import alerts
from e2e.router import network_failure
from scripts.check_web_master import COURSE, DOC, LESSONS

LESSON, NEXT = LESSONS[0][0], LESSONS[1][0]
QUIZ = f"/workspace/courses/{COURSE}/lessons/{LESSON}/quiz"


def ready(backend):
    backend.documents = [{"id": DOC, "title": "Archive Handbook", "edition": "fixture"}]
    backend.course_status, backend.plan_ready, backend.lesson_ready = "ready", True, True
    backend.status[LESSON] = "in_progress"
    backend.content_status[LESSON] = "ready"
    return backend


def correct_texts(backend, attempt):
    return [next(o["text"] for o in q["options"] if o["id"] == q["correct_option_id"])
            for q in backend.quiz_sets[min(attempt, 1)]]


def answer(page, backend, attempt, right):
    """Pick the correct option for the first `right` questions, a wrong one after."""
    texts = correct_texts(backend, attempt)
    groups = page.get_by_role("radiogroup")
    for index in range(3):
        options = groups.nth(index).locator("label")
        labels = [t.strip() for t in options.all_inner_texts()]
        target = labels.index(texts[index]) if index < right else next(
            i for i, t in enumerate(labels) if t != texts[index])
        options.nth(target).click()


def test_structure_keyboard_and_submit_gate(page, api, master, console):
    ready(master)
    page.goto(QUIZ)
    expect(page).to_have_url(re.compile(r"quiz\?attempt="))
    groups = page.get_by_role("radiogroup")
    expect(groups).to_have_count(3)
    for index in range(3):
        expect(groups.nth(index).get_by_role("radio")).to_have_count(4)
    submit = page.get_by_role("button", name="Submit answers")
    expect(submit).to_be_disabled()
    # Keyboard: Tab into the first group, arrows move, Space selects.
    first = groups.nth(0).get_by_role("radio")
    first.nth(0).focus()
    page.keyboard.press("ArrowDown")
    expect(first.nth(1)).to_be_focused()
    page.keyboard.press("Space")
    expect(first.nth(1)).to_be_checked()
    expect(page.get_by_text("1 of 3 answered")).to_be_visible()
    expect(submit).to_be_disabled()
    answer(page, master, 0, 3)
    expect(page.get_by_text("3 of 3 answered")).to_be_visible()
    expect(submit).to_be_enabled()
    # Before submitting, nothing reveals the key or explanations.
    expect(page.get_by_text("Why the correct answer is right")).to_have_count(0)
    expect(page.get_by_text("correct answer", exact=False)).to_have_count(0)


def test_zero_of_three_fails_and_three_of_three_passes_with_explanations(page, api, master, console):
    ready(master)
    page.goto(QUIZ)
    expect(page.get_by_role("radiogroup")).to_have_count(3)
    answer(page, master, 0, 0)
    page.get_by_role("button", name="Submit answers").click()
    summary = page.locator("[data-passed]")
    expect(summary).to_have_attribute("data-passed", "false")
    expect(summary).to_contain_text("0/3 · Not passed")
    expect(summary).to_be_focused()
    expect(page.get_by_text("Why your answer is wrong:")).to_have_count(3)
    expect(page.get_by_label("Sources")).to_have_count(3)
    assert master.status[NEXT] == "locked"
    page.get_by_role("button", name="Retake with new questions").click()
    expect(page.get_by_role("radiogroup")).to_have_count(3)
    answer(page, master, 1, 3)
    page.get_by_role("button", name="Submit answers").click()
    expect(summary).to_contain_text("3/3 · Passed")
    expect(page.get_by_text("Why your answer is wrong:")).to_have_count(0)
    expect(page.get_by_text("Why the correct answer is right:")).to_have_count(3)
    expect(page.get_by_role("link", name="Next lesson")).to_have_attribute("href", re.compile(NEXT))
    history = page.locator("section", has=page.get_by_role("heading", name="Previous attempts"))
    expect(history).to_contain_text("Attempt 1: 0/3 · Not passed")
    expect(history).to_contain_text("Attempt 2: 3/3 · Passed")


def test_refresh_resumes_and_network_failure_keeps_answers(page, api, master, console):
    ready(master)
    console.allow(r"Failed to load resource|net::ERR_FAILED")
    page.goto(QUIZ)
    expect(page.get_by_role("radiogroup")).to_have_count(3)
    expect(page).to_have_url(re.compile(r"attempt="))
    url = page.url
    stems = page.locator("fieldset legend").all_inner_texts()
    page.reload()
    expect(page).to_have_url(url)
    expect(page.get_by_role("radiogroup")).to_have_count(3)
    assert page.locator("fieldset legend").all_inner_texts() == stems
    assert len(api.calls("POST", f"lessons/{LESSON}/quiz-attempts")) == 1  # Resumed, not restarted.
    attempt = url.split("attempt=")[1]
    api.on("POST", f"quiz-attempts/{attempt}/submit", network_failure())
    answer(page, master, 0, 2)
    page.get_by_role("button", name="Submit answers").click()
    expect(alerts(page)).to_contain_text("Cannot reach the server")
    expect(page.get_by_text("3 of 3 answered")).to_be_visible()
    # The backend recovers: the same answers submit without re-entry.
    api.handlers = [h for h in api.handlers if "submit" not in h.pattern.pattern]
    page.get_by_role("button", name="Submit answers").click()
    expect(page.locator("[data-passed]")).to_contain_text("2/3 · Passed")


def test_superseded_attempt_offers_a_new_one(page, api, master, console):
    ready(master)
    console.allow(r"status of 409")
    page.goto(QUIZ)
    expect(page.get_by_role("radiogroup")).to_have_count(3)
    expect(page).to_have_url(re.compile(r"attempt="))
    stale = page.url
    # Another tab starts a new attempt, superseding this one.
    other = page.context.new_page()
    other.goto(QUIZ)
    expect(other.get_by_role("radiogroup")).to_have_count(3)
    other.close()
    answer(page, master, 0, 3)
    page.get_by_role("button", name="Submit answers").click()
    expect(alerts(page)).to_contain_text("abandoned")
    page.get_by_role("button", name="Start a new attempt").click()
    expect(page).not_to_have_url(stale)
    expect(page.get_by_role("radiogroup")).to_have_count(3)


def test_pass_unlocks_exactly_the_next_lesson_in_the_plan_without_reload(page, api, master, console):
    ready(master)
    page.goto(QUIZ)
    page.evaluate("window.__noFullReload = true")
    expect(page.get_by_role("radiogroup")).to_have_count(3)
    answer(page, master, 0, 3)
    page.get_by_role("button", name="Submit answers").click()
    expect(page.locator("[data-passed]")).to_contain_text("Passed")
    page.get_by_role("link", name="Back to the lesson").first.click()
    page.get_by_role("navigation", name="Breadcrumb").get_by_role("link").first.click()
    expect(page).to_have_url(re.compile(rf"/workspace/courses/{COURSE}$"))
    assert page.evaluate("window.__noFullReload === true"), "navigation reloaded the page"
    expect(page.get_by_text("1 of 3 lessons completed")).to_be_visible()
    unlocked = page.locator(f'[data-lesson="{NEXT}"]')
    expect(unlocked.get_by_role("link")).to_contain_text("Available")
    expect(unlocked).to_have_attribute("data-unlocked", "true")
    assert master.status[LESSONS[2][0]] == "locked"
