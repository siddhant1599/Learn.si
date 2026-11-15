"""Landing checks: static hero, then the "From a page to a path" scroll stage after the examples.

Read-only; no providers. Run against the production frontend:
uv run --with playwright python -m scripts.check_web_landing
"""
from playwright.sync_api import expect, sync_playwright

BASE = "http://127.0.0.1:3001"


def progress(page):
    return float(page.evaluate("getComputedStyle(document.querySelector('[data-constellation-stage]')).getPropertyValue('--stage-progress')"))


def star_positions(page):
    return page.evaluate("[...document.querySelectorAll('[data-constellation-star]')].map(s => s.style.transform)")


def scroll_stage_to(page, fraction):
    """Scroll so that the sticky stage has advanced `fraction` of its scrollable distance."""
    page.evaluate(
        "f => { const el = document.querySelector('[data-constellation-stage]');"
        " const top = el.getBoundingClientRect().top + window.scrollY;"
        " window.scrollTo(0, top + (el.offsetHeight - innerHeight) * f); }",
        fraction,
    )
    page.wait_for_timeout(500)


def check_stage(page, width, height, errors):
    page.set_viewport_size({"width": width, "height": height})
    page.goto(BASE, wait_until="networkidle")
    page.wait_for_timeout(600)
    # Hero is static again: no stage inside it, book mask present.
    assert page.locator("[data-hero-stage]").count() == 0
    assert page.locator("[style*='mask-image']").count() >= 1
    # The stage sits right after the examples section.
    order = page.evaluate("[...document.querySelectorAll('main > section')].map(s => s.id || '?')")
    assert order.index("examples") + 1 == order.index("path"), order
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"overflow at {width}"
    scroll_stage_to(page, 0)
    assert progress(page) <= 0.01, progress(page)
    expect(page.locator("[data-constellation-page]")).to_be_visible()
    start = star_positions(page)
    scroll_stage_to(page, 0.5)
    mid = progress(page)
    assert 0.4 < mid < 0.6, mid
    assert star_positions(page) != start, "stars did not move"
    assert page.evaluate("document.querySelector('[data-constellation-legend]').style.opacity") == "0"
    scroll_stage_to(page, 1)
    assert progress(page) >= 0.99, progress(page)
    assert page.evaluate("document.querySelector('[data-constellation-page]').style.opacity") == "0"
    assert page.evaluate("[...document.querySelectorAll('[data-constellation-label]')].every(l => parseFloat(l.style.opacity) > 0.4)")
    assert page.evaluate("document.querySelector('[data-constellation-legend]').style.opacity") == "1"
    assert page.evaluate("document.querySelector('[data-constellation-chip]').style.opacity") == "1"
    states = page.evaluate("[...document.querySelectorAll('[data-constellation-star]')].map(s => s.dataset.state)")
    assert states.count("mastered") == 3 and states.count("next") == 1 and states.count("locked") == 5, states
    boxes = page.evaluate("(() => { const b = document.querySelector('[data-constellation]').getBoundingClientRect(); return [...document.querySelectorAll('[data-constellation-star], [data-constellation-label]')].map(s => s.getBoundingClientRect()).map(r => [r.left - b.left, r.top - b.top, r.right - b.left, r.bottom - b.top]); })()")
    for left, top, right, bottom in boxes:
        assert 0 <= left and right <= width and 0 <= top and bottom <= height, (left, top, right, bottom)
    check_lesson_flow(page)
    check_ask_demo(page)
    assert not errors, errors
    print(f"{width}x{height}: static hero; stage 0 → {mid:.2f} → 1; 9 stars travel, labels, lines, module one gold, legend and chip; lesson + quiz light Pods")


def check_ask_demo(page):
    """Scripted Ask run: real activity labels, streamed answer with citations, highlighted passages."""
    panel = page.locator("#examples")
    panel.scroll_into_view_if_needed()
    page.get_by_role("tab", name="Connect two ideas").click()
    expect(page.get_by_text("Why do my Pods disappear when a node fails?")).to_be_visible()
    expect(page.get_by_text("Request routed")).to_be_visible(timeout=5000)
    expect(page.get_by_text("Search planned")).to_be_visible(timeout=5000)
    expect(page.get_by_role("button", name="Citation 2")).to_be_visible(timeout=15000)
    expect(page.get_by_text("Answer prepared")).to_be_visible(timeout=15000)
    assert page.locator("[data-cited]").count() == 2
    page.get_by_role("button", name="Citation 1").hover()
    expect(page.locator('[data-cited="focus"]')).to_have_text("Deployments keep the desired replica count running.")
    assert page.locator("#examples a[href='/workspace']").count() == 1
    assert "no model calls" in page.locator("#examples").inner_text()


def check_lesson_flow(page):
    """Order exercise, a failed first quiz, a retake with new questions, then the map updates."""
    card = page.locator("[data-lesson-card]")
    card.scroll_into_view_if_needed()
    assert "TODO(you)" not in page.locator("#path").inner_text()
    check = card.get_by_role("button", name="Check order", exact=True)
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
    card.get_by_role("button", name="Take the quiz").click()
    expect(card).to_have_attribute("data-side", "quiz")
    page.wait_for_timeout(800)  # Let the 3D flip finish before clicking inside the back face.
    submit = page.get_by_role("button", name="Submit answers")
    expect(submit).to_be_disabled()
    # Bank one keys: b, b, a. Choose all wrong.
    for qid, wrong in (("a1", "a"), ("a2", "c"), ("a3", "b")):
        page.locator(f'[data-question="{qid}"] input[value="{wrong}"]').check()
    submit.click()
    expect(page.locator("[data-quiz-result]")).to_have_attribute("data-quiz-result", "failed")
    stems_before = page.locator("[data-question] legend").all_inner_texts()
    page.get_by_role("button", name="Retake with new questions").click()
    expect(page.locator("[data-quiz]")).to_have_attribute("data-attempt", "2")
    assert page.locator("[data-question] legend").all_inner_texts() != stems_before
    for qid, right in (("b1", "b"), ("b2", "a"), ("b3", "b")):
        page.locator(f'[data-question="{qid}"] input[value="{right}"]').check()
    page.get_by_role("button", name="Submit answers").click()
    expect(page.locator("[data-quiz-result]")).to_have_attribute("data-quiz-result", "passed")
    expect(page.locator("[data-progress-panel]")).to_have_attribute("data-completed", "4")
    mini = page.evaluate("[...document.querySelectorAll('[data-mini-sky] g[data-state]')].map(g => g.dataset.state)")
    assert mini.count("mastered") == 4 and mini[4] == "next", mini
    scroll_stage_to(page, 1)
    states = page.evaluate("[...document.querySelectorAll('[data-constellation-star]')].map(s => s.dataset.state)")
    assert states.count("mastered") == 4 and states[4] == "next", states
    assert page.evaluate("document.querySelector('[data-constellation-chip]').textContent") == "Lesson 5 · ≈ 5 min"


def check_content(page):
    for theme in ("light", "dark"):
        for width in (1440, 390):
            page.set_viewport_size({"width": width, "height": 900})
            page.goto(BASE, wait_until="networkidle")
            page.evaluate("theme => localStorage.setItem('theme', theme)", theme)
            page.reload(wait_until="networkidle")
            for name in ("Ask steps", "Master steps"):
                expect(page.get_by_role("list", name=name).get_by_role("listitem")).to_have_count(3)
            for img in page.locator("#how-it-works img").all():
                img.scroll_into_view_if_needed()
                expect(img).to_be_visible()
                page.wait_for_function("img => img.complete && img.naturalWidth > 0", arg=img.element_handle())
                assert img.get_attribute("width") == "1440" and img.get_attribute("height") == "1000"
            expect(page.locator("#privacy")).to_contain_text("local does not mean offline")
            expect(page.get_by_role("navigation", name="Footer").get_by_role("link")).to_have_count(4)
            cta = page.get_by_role("link", name="Open your workspace", exact=True)
            cta.focus()
            cta.press("Enter")
            expect(page).to_have_url(BASE + "/workspace")
            page.go_back(wait_until="networkidle")
            # Use the first demo tab regardless of editorial tab names.
            first = page.get_by_role("tab").first
            first.focus()
            first.press("ArrowRight")
            expect(page.get_by_role("tab").nth(1)).to_be_focused()
            expect(page.get_by_role("tab").nth(1)).to_have_attribute("aria-selected", "true")
            assert page.locator('a[href^="/workspace/"]').count() == 0
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    print("Landing content: screenshots, privacy, footer, chooser CTA and keyboard tabs; desktop/mobile, both themes passed")


def check_reduced_motion(browser):
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce")
    page = ctx.new_page()
    page.goto(BASE, wait_until="networkidle")
    page.wait_for_timeout(600)
    assert progress(page) == 1
    assert page.evaluate("document.querySelector('[data-constellation-stage]').offsetHeight") <= 900 + 1
    assert page.evaluate("document.querySelector('[data-constellation-legend]').style.opacity") == "1"
    ctx.close()
    print("reduced motion: finished map in a single-screen frame")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless=True)
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        check_stage(page, 1440, 900, errors)
        check_stage(page, 390, 844, errors)
        check_reduced_motion(browser)
        check_content(page)
        browser.close()


if __name__ == "__main__":
    main()
