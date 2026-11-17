"""Landing checks: static hero, the Ask demo, then the playable next lesson and its progress tree.

Read-only; no providers. Run against the production frontend:
uv run --with playwright python -m scripts.check_web_landing
"""
import re

from playwright.sync_api import expect, sync_playwright

from scripts.browser import BASE, launch


def check_layout(page, width, height, errors):
    page.set_viewport_size({"width": width, "height": height})
    page.goto(BASE, wait_until="networkidle")
    page.wait_for_timeout(600)
    # Hero is static: no stage inside it, book mask present.
    assert page.locator("[data-hero-stage]").count() == 0
    assert page.locator("[style*='mask-image']").count() >= 1
    # The "From a page to a path" map was removed: the lesson follows the examples.
    order = page.evaluate("[...document.querySelectorAll('main > section')].map(s => s.id || '?')")
    assert order.index("examples") + 1 == order.index("lesson"), order
    assert "path" not in order and page.locator("[data-constellation-stage]").count() == 0, order
    expect(page.get_by_text("From a page to a path")).to_have_count(0)
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"overflow at {width}"
    check_lesson_flow(page)
    check_ask_demo(page)
    assert not errors, errors
    print(f"{width}x{height}: static hero; no map; lesson exercise + quiz retake light Pods in the course tree; Ask demo sequence")


def check_ask_demo(page):
    """Scripted Ask demo: document tree beside an agent chat; the questions play in sequence."""
    panel = page.locator("#examples")
    # The demo only advances while its stage is on screen; on phones the section's top
    # edge can be visible while the stage is still below the fold.
    panel.get_by_text("Study Buddy Agent").scroll_into_view_if_needed()
    panel.get_by_role("button", name="Connect two ideas").click()
    panel.get_by_text("Study Buddy Agent").scroll_into_view_if_needed()
    expect(panel.get_by_role("button", name="Connect two ideas")).to_have_attribute("aria-pressed", "true")
    expect(panel.get_by_text("Why do my Pods disappear when a node fails?")).to_be_visible()
    expect(panel.get_by_text(re.compile("Routed: Multi-question research"))).to_be_visible(timeout=5000)
    expect(panel.get_by_text(re.compile("Search planned"))).to_be_visible(timeout=5000)
    expect(panel.get_by_text(re.compile("Grounded in 2 cited sentences"))).to_be_visible(timeout=15000)
    assert panel.locator('[data-stage-passage="done"]').count() >= 2
    # It moves on to the last question by itself.
    expect(panel.get_by_role("button", name="Know what's missing")).to_have_attribute("aria-pressed", "true", timeout=8000)
    assert "Scripted illustration" not in panel.inner_text()  # Label removed on request.
    assert "Design B" not in panel.inner_text()


def check_lesson_flow(page):
    """Order exercise, a failed first quiz, a retake with new questions, then the course tree updates."""
    card = page.locator("[data-lesson-card]")
    card.scroll_into_view_if_needed()
    page.wait_for_timeout(1500)  # Lesson blocks fade in as they scroll into view.
    assert "TODO(you)" not in page.locator("#lesson").inner_text()
    check = card.get_by_role("button", name="Check order", exact=True)
    check.scroll_into_view_if_needed()
    page.wait_for_timeout(800)
    check.click()
    expect(page.locator("[data-order-verdict]")).to_have_attribute("data-order-verdict", "incorrect")
    describe = "You describe the Pod: images, ports, volumes."
    schedule = "The scheduler places the whole Pod on one node."
    for _ in range(2):
        move = card.get_by_role("button", name=f"Move up: {describe}")
        move.focus()
        move.press("Enter")
    for _ in range(2):
        card.get_by_role("button", name=f"Move up: {schedule}").click()
    check.click()
    expect(page.locator("[data-order-verdict]")).to_have_attribute("data-order-verdict", "correct")
    assert page.locator('[data-placed="true"]').count() == 4
    take = card.get_by_role("button", name=re.compile("Take the quiz"))
    take.scroll_into_view_if_needed()
    page.wait_for_timeout(800)
    take.click()
    expect(card).to_have_attribute("data-side", "quiz")
    submit = card.get_by_role("button", name="Submit answers")
    expect(submit).to_be_disabled()
    # Bank one keys: b, b, a. Choose all wrong.
    for qid, wrong in (("a1", "a"), ("a2", "c"), ("a3", "b")):
        page.locator(f'[data-question="{qid}"] input[value="{wrong}"]').check()
    submit.click()
    expect(page.locator("[data-quiz-result]")).to_have_attribute("data-quiz-result", "failed")
    stems_before = page.locator("[data-question] legend").all_text_contents()
    card.get_by_role("button", name="Retake with new questions").click()
    expect(page.locator("[data-quiz]")).to_have_attribute("data-attempt", "2")
    assert page.locator("[data-question] legend").all_text_contents() != stems_before
    for qid, right in (("b1", "b"), ("b2", "a"), ("b3", "b")):
        page.locator(f'[data-question="{qid}"] input[value="{right}"]').check()
    card.get_by_role("button", name="Submit answers").click()
    expect(page.locator("[data-quiz-result]")).to_have_attribute("data-quiz-result", "passed")
    expect(page.locator("[data-progress-panel]")).to_have_attribute("data-completed", "4")
    tree = page.evaluate("[...document.querySelectorAll('[data-lesson-state]')].map(n => n.dataset.lessonState)")
    assert tree.count("mastered") == 4 and tree[4] == "next", tree


def check_content(page):
    for theme in ("light", "dark"):
        for width in (1440, 390):
            page.set_viewport_size({"width": width, "height": 900})
            page.goto(BASE, wait_until="networkidle")
            page.evaluate("theme => localStorage.setItem('theme', theme)", theme)
            page.reload(wait_until="networkidle")
            # The how-it-works, privacy and closing sections were removed from the landing.
            for removed in ("#how-it-works", "#privacy", "#closing-title"):
                expect(page.locator(removed)).to_have_count(0)
            expect(page.get_by_role("navigation", name="Footer")).to_have_count(0)  # Footer links removed on request.
            cta = page.get_by_role("link", name="Start learning")
            cta.focus()
            cta.press("Enter")
            expect(page).to_have_url(BASE + "/workspace")
            page.go_back(wait_until="networkidle")
            # Demo questions are keyboard-operable buttons.
            name = page.locator("#examples").get_by_role("button", pressed=False).first.inner_text()
            second = page.locator("#examples").get_by_role("button", name=name, exact=True)
            second.focus()
            second.press("Enter")
            expect(second).to_have_attribute("aria-pressed", "true")
            assert page.locator('a[href^="/workspace/"]').count() == 0
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    print("Landing content: removed sections absent, footer, chooser CTA and keyboard demo questions; desktop/mobile, both themes passed")


def check_reduced_motion(browser):
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce")
    page = ctx.new_page()
    page.goto(BASE, wait_until="networkidle")
    lesson = page.locator("#lesson")
    lesson.scroll_into_view_if_needed()
    # Without motion every lesson block is shown at once, and the Ask demo is finished.
    expect(lesson.get_by_text("Insight · Common misconception")).to_be_visible()
    expect(lesson.get_by_role("button", name=re.compile("Take the quiz"))).to_be_visible()
    expect(page.locator("#examples").get_by_text(re.compile("Grounded in 2 cited sentences"))).to_be_visible()
    ctx.close()
    print("reduced motion: lesson fully shown, Ask demo finished")


def main():
    with sync_playwright() as p:
        browser = launch(p)
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        check_layout(page, 1440, 900, errors)
        check_layout(page, 390, 844, errors)
        check_reduced_motion(browser)
        check_content(page)
        browser.close()


if __name__ == "__main__":
    main()
