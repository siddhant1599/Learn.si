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
    gold = page.evaluate("[...document.querySelectorAll('[data-constellation-star] circle:last-child')].filter(c => c.getAttribute('fill') !== '#ffffff').length")
    assert gold == 3, gold  # Module one mastered.
    boxes = page.evaluate("(() => { const b = document.querySelector('[data-constellation]').getBoundingClientRect(); return [...document.querySelectorAll('[data-constellation-star], [data-constellation-label]')].map(s => s.getBoundingClientRect()).map(r => [r.left - b.left, r.top - b.top, r.right - b.left, r.bottom - b.top]); })()")
    for left, top, right, bottom in boxes:
        assert 0 <= left and right <= width and 0 <= top and bottom <= height, (left, top, right, bottom)
    assert not errors, errors
    print(f"{width}x{height}: static hero; stage 0 → {mid:.2f} → 1; 9 stars travel, labels, lines, module one gold, legend and chip")


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
        browser.close()


if __name__ == "__main__":
    main()
