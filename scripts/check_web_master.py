"""End-to-end Master mode in a real browser against a fixture backend.

Run against the production frontend:
    uv run --with playwright python -m scripts.check_web_master

No database, providers or credits: every /api/rag request is answered in-process by
FixtureBackend, which uses the recorded fixtures in tests/fixtures/master and the
app's own validators (lesson contract, quiz validation and grading, progress and
mastery), so the browser sees exactly what the real API would return.

Flow: landing -> chooser (keyboard) -> Master -> create a course from an upload ->
generation progress -> plan (keyboard) -> lesson (all blocks, Mermaid) -> Your turn ->
tutor (guidance first, no web) -> quiz fail -> retake with different stems -> pass ->
next lesson unlocked -> progress values; desktop and 390 px, light and dark, no console
errors, no horizontal overflow.
"""

import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from fastapi.encoders import jsonable_encoder
from playwright.sync_api import expect, sync_playwright

from app.study.lesson_writer import build_evidence, review
from app.study.models import client_content
from app.study.progress import course_progress, overview, summary
from app.study.quiz import check_question, grade
from app.uploads import extract_document
from scripts.browser import BASE, launch

FIXTURES = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "master"
DOC = "aaaaaaaa-0000-4000-8000-000000000001"
COURSE = "cccccccc-0000-4000-8000-000000000001"
MODULES = [("dddddddd-0000-4000-8000-000000000001", "Labels and retention", "Read and write labels."),
           ("dddddddd-0000-4000-8000-000000000002", "Reviews", "Run a retention review.")]
LESSONS = [("eeeeeeee-0000-4000-8000-000000000001", 0, "Archive labels", "Explain what a label contains."),
           ("eeeeeeee-0000-4000-8000-000000000002", 0, "Retention categories", "Choose a category."),
           ("eeeeeeee-0000-4000-8000-000000000003", 1, "Disposal reviews", "Run a review.")]
T0 = datetime(2026, 11, 15, 9, tzinfo=timezone.utc)
GUIDANCE = "Look at the Labels section [1]. Which part of a label do shelves sort by?"


def progress_event(step, status, sequence, task=None, count=None, attempt=0):
    event = {"type": "progress", "version": 1, "step": step, "id": step + (f":{task}" if task else ""),
             "status": status, "attempt": attempt, "sequence": sequence}
    if task:
        event.update(task=task, parent=step)
    if count is not None:
        event["count"] = count
    return event


def sse(*frames):
    return "".join(f"event: {name}\ndata: {json.dumps(data)}\n\n" for name, data in frames)


class FixtureBackend:
    def __init__(self):
        document = extract_document("handbook.md", (FIXTURES / "handbook.md").read_bytes())
        self.sections = [{**s.model_dump(), "document_id": DOC, "document_title": "Archive Handbook",
                          "edition": "fixture"} for s in document.sections if s.id in ("1.1", "1.2")]
        _, self.sources, _ = build_evidence(self.sections, 12000)
        draft = review((FIXTURES / "lesson_reply.json").read_text(), self.sources, False, False)
        assert not draft.problems, draft.problems
        self.content = draft.content.model_dump(mode="json")
        self.quiz_sets = [json.loads((FIXTURES / name).read_text())["questions"]
                          for name in ("quiz_reply.json", "quiz_retake_reply.json")]
        self.review = json.loads((FIXTURES / "review_reply.json").read_text())
        self.documents, self.course_status, self.failure_code = [], None, None
        self.plan_ready = self.lesson_ready = False
        self.status = {lid: "locked" for lid, *_ in LESSONS}
        self.status[LESSONS[0][0]] = "available"
        self.opened, self.completed, self.study = {}, {}, {}
        self.content_status = {lid: "pending" for lid, *_ in LESSONS}
        self.attempts, self.your_turn, self.queries = [], [], []

    # Views ----------------------------------------------------------------

    def course_view(self):
        ready = self.course_status == "ready"
        modules = []
        for index, (mid, title, text) in enumerate(MODULES):
            lessons = [{"id": lid, "module_id": mid, "position": pos, "title": t, "objective": o,
                        "estimated_minutes": 6, "content_status": self.content_status[lid],
                        "status": self.status[lid]}
                       for pos, (lid, m, t, o) in enumerate(LESSONS, 1) if m == index]
            modules.append({"id": mid, "position": index + 1, "title": title, "summary": text,
                            "estimated_minutes": 6 * len(lessons), "lessons": lessons})
        done = sum(1 for s in self.status.values() if s == "completed")
        following = next((lid for lid, *_ in LESSONS if self.status[lid] in ("available", "in_progress")), None)
        return {"id": COURSE, "document_id": DOC, "title": "Archive Handbook", "status": self.course_status,
                "failure_code": self.failure_code, "estimated_minutes": 18 if ready else 0,
                "module_count": len(MODULES) if ready else 0, "lesson_count": len(LESSONS) if ready else 0,
                "completed_lessons": done, "next_lesson_id": following if ready else None,
                "created_at": T0.isoformat(), "updated_at": T0.isoformat(), "generation": COURSE,
                "modules": modules if ready else []}

    def progress(self):
        rows = []
        for pos, (lid, m, title, _) in enumerate(LESSONS, 1):
            mid, mtitle, _ = MODULES[m]
            rows.append({"id": lid, "module_id": mid, "module_title": mtitle, "module_position": m + 1,
                         "position": pos, "title": title, "estimated_minutes": 6, "status": self.status[lid],
                         "opened_at": self.opened.get(lid), "completed_at": self.completed.get(lid),
                         "study_seconds": self.study.get(lid, 0), "last_study_at": None})
        attempts = [a for a in self.attempts if a["status"] == "submitted"]
        verdicts = {}
        for lid, verdict in self.your_turn:
            verdicts.setdefault(lid, []).append(verdict)
        return course_progress({"id": COURSE, "title": "Archive Handbook"}, rows, attempts, verdicts), attempts

    def lesson(self, lid):
        pos, (_, m, title, objective) = next((i, row) for i, row in enumerate(LESSONS, 1) if row[0] == lid)
        status = self.content_status[lid]
        content = client_content(self.content) if status == "ready" and self.status[lid] != "locked" else None
        steps = [progress_event("evidence", "completed", 2, count=2)] if status == "generating" else []
        return {"id": lid, "course_id": COURSE, "module_id": MODULES[m][0], "document_id": DOC,
                "position": pos, "title": title, "objective": objective, "source_section_ids": ["1.1", "1.2"],
                "estimated_minutes": 6, "content_status": status, "content_generated_at": None,
                "content_failure_code": None, "progress": {"status": self.status[lid]}, "content": content,
                "regenerations_left": 5, "generation_progress": steps}

    # Routing ---------------------------------------------------------------

    def handle(self, route):
        request = route.request
        url = urlparse(request.url)
        path = url.path.removeprefix("/api/rag/")
        method = request.method
        body = json.loads(request.post_data) if request.post_data and method == "POST" and "upload" not in path else {}
        result = self.dispatch(method, path, body, parse_qs(url.query))
        if result is None:
            return route.fulfill(status=404, json={"detail": "Not found"})
        status, payload, content_type = result
        if content_type == "sse":
            route.fulfill(status=200, headers={"Content-Type": "text/event-stream"}, body=payload)
        else:
            route.fulfill(status=status, json=jsonable_encoder(payload))

    def dispatch(self, method, path, body, query):
        lesson_match = re.fullmatch(r"lessons/([0-9a-f-]+)(/.*)?", path)
        if path == "health":
            return 200, {"status": "ok", "web_available": True}, "json"
        if path == "deletions":
            return 200, [], "json"
        if path == "documents":
            return 200, self.documents, "json"
        if path == "documents/upload" and method == "POST":
            self.documents = [{"id": DOC, "title": "Archive Handbook", "edition": "fixture"}]
            return 201, {"id": DOC, "title": "Archive Handbook", "edition": "fixture", "chunks": 3}, "json"
        if path == "courses" and method == "POST":
            assert body == {"document_id": DOC}, body
            if self.course_status == "failed":  # POST /courses restarts a failed plan.
                self.course_status, self.failure_code = "generating", None
            self.course_status = self.course_status or "generating"
            return 202, {k: v for k, v in self.course_view().items() if k not in ("modules", "generation")}, "json"
        if path == "courses":
            if not self.course_status:
                return 200, [], "json"
            entry = {k: v for k, v in self.course_view().items() if k not in ("modules", "generation")}
            return 200, [{**entry, "progress": summary(self.progress()[0])}], "json"
        if path == f"courses/{COURSE}":
            if self.course_status is None:
                return 404, {"detail": "Course does not exist"}, "json"
            if self.plan_ready:
                self.course_status = "ready"
            events = [] if self.course_status == "ready" else [
                progress_event("outline", "completed", 2, count=2),
                progress_event("topics", "started", 3, count=1),
                progress_event("topics", "completed", 4, task="w1", count=2),
            ]
            return 200, {**self.course_view(), "progress": events}, "json"
        if path == f"courses/{COURSE}/events":
            # No status frame: the page falls back to polling until the plan is ready.
            return 200, sse(("progress", progress_event("structure", "started", 5))), "sse"
        if path == f"courses/{COURSE}/progress":
            return 200, self.progress()[0], "json"
        if path == "progress":
            return 200, overview([self.progress()]), "json"
        if path == "query" and method == "POST":
            self.queries.append(body)
            return 200, sse(
                ("session", {"thread_id": "ffffffff-0000-4000-8000-000000000001", "runtime_id": "fixture"}),
                ("progress", progress_event("retrieve", "completed", 1, count=2)),
                ("progress", progress_event("answer", "completed", 2)),
                ("result", {"thread_id": "ffffffff-0000-4000-8000-000000000001", "answer": GUIDANCE,
                            "citations": [{**self.sources[0], "source_type": "document"}],
                            "warnings": [], "usage": {}, "plan_size": 1}),
            ), "sse"
        attempt_match = re.fullmatch(r"quiz-attempts/([0-9a-f-]+)(/submit)?", path)
        if attempt_match:
            attempt = next(a for a in self.attempts if a["id"] == attempt_match[1])
            head = {"attempt_id": attempt["id"], "lesson_id": attempt["lesson_id"],
                    "attempt_number": attempt["attempt_number"], "status": attempt["status"]}
            if not attempt_match[2]:
                if attempt["status"] == "open":
                    return 200, {**head, "questions": attempt["client"]}, "json"
                return 200, head, "json"
            if attempt["status"] != "open":
                return 409, {"detail": f"This attempt was already {attempt['status']}."}, "json"
            score, passed, results = grade(attempt["questions"], body["answers"])
            attempt.update(status="submitted", score=score, passed=passed, answers=body["answers"],
                           submitted_at=T0 + timedelta(minutes=len(self.attempts)))
            unlocked = None
            lid = attempt["lesson_id"]
            if passed:
                self.status[lid] = "completed"
                self.completed[lid] = attempt["submitted_at"]
                index = [row[0] for row in LESSONS].index(lid)
                following = LESSONS[index + 1][0]
                if self.status[following] == "locked":
                    self.status[following] = "available"
                    self.content_status[following] = "ready"  # Prefetched.
                    unlocked = following
            return 200, {**head, "status": "submitted", "score": score, "passed": passed,
                         "questions_with_results": results, "lesson_status": self.status[lid],
                         "unlocked_lesson_id": unlocked}, "json"
        if not lesson_match:
            return None  # Unhandled: the caller decides (404 here, a failure in the suite).
        lid, rest = lesson_match[1], lesson_match[2] or ""
        if rest == "" and method == "GET":
            if self.status[lid] == "available":
                self.status[lid] = "in_progress"
                self.opened[lid] = T0
            if self.content_status[lid] == "pending":
                self.content_status[lid] = "generating"
            if self.content_status[lid] == "generating" and self.lesson_ready:
                self.content_status[lid] = "ready"
            code = 202 if self.content_status[lid] == "generating" else 200
            return code, self.lesson(lid), "json"
        if rest == "/events":
            return 200, sse(("progress", progress_event("write", "started", 3))), "sse"
        if rest == "/conversation":
            return 200, {"thread_id": None, "messages": []}, "json"
        if rest == "/study-time":
            self.study[lid] = self.study.get(lid, 0) + min(60, int(body.get("seconds", 0)))
            return 200, {"study_seconds": self.study[lid]}, "json"
        if rest == "/your-turn":
            self.your_turn.append((lid, self.review["verdict"]))
            return 200, {"verdict": self.review["verdict"], "feedback": self.review["feedback"],
                         "attempt_number": len(self.your_turn), "reveal": None}, "json"
        if rest == "/quiz-attempts" and method == "POST":
            for attempt in self.attempts:
                if attempt["lesson_id"] == lid and attempt["status"] == "open":
                    attempt["status"] = "abandoned"
            number = sum(1 for a in self.attempts if a["lesson_id"] == lid) + 1
            raw = self.quiz_sets[min(number - 1, 1)]
            valid = {s["citation"]: s for s in self.sources}
            questions = []
            for index, item in enumerate(raw, 1):
                question, problem = check_question(item, valid)
                assert question is not None, problem
                questions.append(question.model_copy(update={"id": f"q{index}"}))
            attempt = {"id": f"bbbbbbbb-0000-4000-8000-{len(self.attempts) + 1:012d}", "lesson_id": lid,
                       "attempt_number": number, "status": "open", "score": None, "passed": None,
                       "questions": [q.model_dump(mode="json") for q in questions],
                       "client": [q.client_view() for q in questions], "created_at": T0, "submitted_at": None}
            self.attempts.append(attempt)
            return 201, {"attempt_id": attempt["id"], "lesson_id": lid, "attempt_number": number,
                         "questions": attempt["client"]}, "json"
        if rest == "/quiz-attempts":
            return 200, [{k: a[k] for k in ("id", "lesson_id", "attempt_number", "status", "score", "passed",
                                            "created_at", "submitted_at")}
                         for a in self.attempts if a["lesson_id"] == lid], "json"
        return None


def no_overflow(page, label):
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), label


def correct_texts(backend, attempt_index):
    raw = backend.quiz_sets[min(attempt_index, 1)]
    return [next(o["text"] for o in q["options"] if o["id"] == q["correct_option_id"]) for q in raw]


def answer_quiz(page, backend, attempt_index, correct_count, keyboard=False):
    """Answer by option text: the first `correct_count` right, the rest wrong."""
    right = correct_texts(backend, attempt_index)
    groups = page.get_by_role("radiogroup")
    expect(groups).to_have_count(3)
    for index in range(3):
        group = groups.nth(index)
        radios = group.get_by_role("radio")
        texts = [radios.nth(i).evaluate("n => n.closest('label').textContent.trim()") for i in range(4)]
        target = texts.index(right[index]) if index < correct_count else next(
            i for i, t in enumerate(texts) if t != right[index])
        if keyboard and index == 0:
            # Arrow keys move the selection within a radio group.
            # Keyboard only: arrows move between options, Space selects.
            radios.nth(0).focus()
            for step in range(1, target + 1):
                page.keyboard.press("ArrowDown")
                expect(radios.nth(step)).to_be_focused()
            page.keyboard.press("Space")
            expect(radios.nth(target)).to_be_checked()
        else:
            radios.nth(target).click()


def stems(page):
    return page.locator("fieldset legend").all_inner_texts()


def run(page, backend, errors):
    page.goto(BASE)
    page.get_by_role("link", name="Start learning").click()
    expect(page).to_have_url(f"{BASE}/workspace")
    master = page.get_by_role("link", name="Master: Learn deeply. Build mastery.")
    page.wait_for_load_state("networkidle")  # Keyboard input during hydration can be lost.
    master.focus()
    page.keyboard.press("Enter")  # Keyboard path through the chooser.
    expect(page).to_have_url(f"{BASE}/workspace/courses")
    expect(page.get_by_role("heading", level=2, name="No courses yet")).to_be_visible()

    # Create a course from an upload; no Ask chat starts.
    page.get_by_role("button", name="Add a document").click()
    page.get_by_label("Upload a document for a new course").set_input_files(str(FIXTURES / "handbook.md"))
    expect(page).to_have_url(f"{BASE}/workspace/courses/{COURSE}")
    assert not backend.queries, "uploading in Master must not start an Ask chat"
    expect(page.get_by_role("heading", name="Preparing your lesson plan")).to_be_visible()
    expect(page.get_by_text("Document read")).to_be_visible()
    no_overflow(page, "generation")
    backend.plan_ready = True  # The next poll returns the finished plan.
    module_two = page.get_by_role("button", name=re.compile(r"^2\. Reviews"))
    expect(module_two).to_be_visible(timeout=10000)
    expect(page.get_by_text("0 of 3 lessons completed")).to_be_visible()

    # Plan keyboard path: open a module with Enter; locked lessons are not links.
    module_two.focus()
    page.keyboard.press("Enter")
    expect(module_two).to_have_attribute("aria-expanded", "true")
    locked = page.locator(f'[data-lesson="{LESSONS[2][0]}"] > [aria-disabled="true"]')
    expect(locked).to_have_count(1)
    expect(page.get_by_role("link", name=re.compile("Disposal reviews"))).to_have_count(0)
    first = page.get_by_role("link", name=re.compile("Archive labels"))
    first.focus()
    page.keyboard.press("Enter")

    # Lesson: generation progress, then every block and a rendered Mermaid diagram.
    expect(page).to_have_url(f"{BASE}/workspace/courses/{COURSE}/lessons/{LESSONS[0][0]}")
    expect(page.get_by_role("heading", name="Writing this lesson")).to_be_visible()
    expect(page.get_by_role("button", name="Take the quiz")).to_be_disabled()
    backend.lesson_ready = True
    for name in ("Explanation", "Real-world example", "Diagram", "Key terms", "Your turn"):
        expect(page.get_by_role("heading", level=2, name=name)).to_be_visible(timeout=10000)
    expect(page.get_by_role("note", name="Why it matters")).to_be_visible()
    # Mermaid renders lazily once the diagram scrolls into view.
    page.get_by_role("heading", level=2, name="Diagram").scroll_into_view_if_needed()
    expect(page.locator('figure svg[aria-roledescription="flowchart-v2"]')).to_have_count(1, timeout=15000)
    expect(page.get_by_label("Sources").first).to_contain_text("Archive Handbook")
    no_overflow(page, "lesson")

    # Your turn: verdict and guidance, no reference.
    page.get_by_label("Your answer").fill("Standard, HR, 7, 2015-2016")
    page.get_by_role("button", name="Check my answer").click()
    expect(page.get_by_text("Partly right")).to_be_visible()
    expect(page.get_by_text("HR-007")).to_have_count(0)

    # Tutor: lesson-scoped, guidance first, no web activity.
    page.get_by_label("Ask the tutor").fill("Why does the code come first?")
    page.get_by_role("button", name="Send", exact=True).click()
    expect(page.get_by_text(GUIDANCE)).to_be_visible()
    query = backend.queries[-1]
    assert query["lesson_id"] == LESSONS[0][0] and query["document_ids"] == [DOC], query
    expect(page.get_by_text(re.compile(r"^Web ·"))).to_have_count(0)
    expect(page.get_by_text("Researching missing evidence on the web")).to_have_count(0)

    # Quiz: fail (keyboard), retake with new stems, pass.
    page.get_by_role("link", name="Take the quiz").click()
    expect(page).to_have_url(re.compile(r"/quiz\?attempt="))
    submit = page.get_by_role("button", name="Submit answers")
    expect(submit).to_be_disabled()
    first_stems = stems(page)
    answer_quiz(page, backend, 0, 1, keyboard=True)
    expect(submit).to_be_enabled()
    submit.click()
    expect(page.get_by_text("1/3 · Not passed", exact=True)).to_be_visible()
    expect(page.get_by_role("link", name="Next lesson")).to_have_count(0)
    assert backend.status[LESSONS[1][0]] == "locked"
    page.get_by_role("button", name="Retake with new questions").click()
    expect(page.get_by_text("Attempt 2", exact=False).first).to_be_visible()
    expect(page.get_by_role("radiogroup")).to_have_count(3)
    second_stems = stems(page)
    assert not set(first_stems) & set(second_stems), (first_stems, second_stems)
    answer_quiz(page, backend, 1, 2)
    page.get_by_role("button", name="Submit answers").click()
    expect(page.get_by_text("2/3 · Passed", exact=True)).to_be_visible()
    no_overflow(page, "quiz results")
    page.get_by_role("link", name="Next lesson").click()
    expect(page).to_have_url(f"{BASE}/workspace/courses/{COURSE}/lessons/{LESSONS[1][0]}")
    expect(page.get_by_role("heading", level=2, name="Explanation")).to_be_visible()

    # Plan reflects the unlock; progress pages show the values.
    page.goto(f"{BASE}/workspace/courses/{COURSE}")
    expect(page.get_by_text("1 of 3 lessons completed")).to_be_visible()
    expect(page.get_by_role("link", name=re.compile("Retention categories"))).to_be_visible()
    page.get_by_role("tab", name="Progress").click()
    expect(page).to_have_url(f"{BASE}/workspace/courses/{COURSE}?tab=progress")
    lessons_table = page.get_by_role("table", name=re.compile("per lesson"))
    expect(lessons_table.get_by_role("row")).to_have_count(4)
    expect(lessons_table.get_by_role("row").nth(1)).to_contain_text("Completed")
    expect(lessons_table.get_by_role("row").nth(1)).to_contain_text("Developing")
    expect(page.get_by_role("region", name="Quiz performance")).to_contain_text("Pass rate50%")
    page.goto(f"{BASE}/workspace/progress")
    totals = page.get_by_role("region", name="Totals")
    expect(totals).to_contain_text("Lessons completed1of 3")
    expect(totals).to_contain_text("Quizzes passed1of 2 attempts")
    expect(page.get_by_text(re.compile(r"Quiz passed 2/3 · Archive labels"))).to_be_visible()
    no_overflow(page, "progress")
    assert not errors, errors
    print("Desktop flow: chooser, course creation, plan, lesson, Your turn, tutor, quiz fail/retake/pass, unlock, progress passed")


def check_views(page, errors):
    """Every Master view in both themes at 1440 and 390 px: renders, no overflow."""
    views = ["/workspace/courses", f"/workspace/courses/{COURSE}", f"/workspace/courses/{COURSE}?tab=progress",
             f"/workspace/courses/{COURSE}/lessons/{LESSONS[0][0]}", "/workspace/progress"]
    for width in (1440, 390):
        page.set_viewport_size({"width": width, "height": 900})
        for theme in ("light", "dark"):
            for view in views:
                page.goto(BASE + view)
                page.evaluate(f"document.documentElement.classList.toggle('dark', {str(theme == 'dark').lower()})")
                expect(page.get_by_role("heading", level=1)).to_be_visible()
                no_overflow(page, f"{view} {width} {theme}")
    assert not errors, errors
    print("Views: courses, plan, progress tab, lesson and progress page at 1440/390 px in light and dark passed")


def main():
    with sync_playwright() as p:
        browser = launch(p)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        backend = FixtureBackend()
        page.route("**/api/rag/**", backend.handle)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        run(page, backend, errors)
        check_views(page, errors)
        browser.close()


if __name__ == "__main__":
    main()
