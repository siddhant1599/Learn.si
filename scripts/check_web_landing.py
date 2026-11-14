"""Landing hero scroll stage checks: constellation forms with scroll, mask dissolves, reduced motion.

Read-only; no providers. Run against the production frontend:
uv run --with playwright python -m scripts.check_web_landing
"""
from playwright.sync_api import expect, sync_playwright

BASE = "http://127.0.0.1:3001"


def progress(page):
    return float(page.evaluate("getComputedStyle(document.querySelector('[data-hero-stage]')).getPropertyValue('--hero-progress')"))


def star_positions(page):
    return page.evaluate("[...document.querySelectorAll('[data-constellation-star]')].map(s => s.style.transform)")


def check_stage(page, width, height, errors):
    page.set_viewport_size({"width": width, "height": height})
    page.goto(BASE, wait_until="networkidle")
    page.wait_for_timeout(600)
    assert progress(page) == 0, progress(page)
    expect(page.locator("[data-constellation-page]")).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"overflow at {width}"
    start = star_positions(page)
    label_opacity = page.evaluate("document.querySelector('[data-constellation-label]').style.opacity")
    assert label_opacity in ("0", ""), label_opacity
    page.mouse.wheel(0, height * 0.4)
    page.wait_for_timeout(500)
    mid = progress(page)
    assert 0.2 < mid < 0.8, mid
    assert star_positions(page) != start, "stars did not move"
    # The stage is 180svh: 80svh of scrolling completes it; stop exactly there.
    page.mouse.wheel(0, height * 0.4)
    page.wait_for_timeout(600)
    assert progress(page) >= 0.99, progress(page)
    assert page.evaluate("document.querySelector('[data-constellation-label]').style.opacity") == "1"
    assert page.evaluate("document.querySelector('[data-constellation-page]').style.opacity") == "0"
    mask_opacity = page.evaluate("(() => { const el = document.querySelector('[data-hero-stage] [style*=\"mask-image\"]'); return el ? parseFloat(getComputedStyle(el).opacity) : 0; })()")
    assert mask_opacity <= 0.01, mask_opacity
    # Stars and labels end inside the stage, below the headline block.
    boxes = page.evaluate("(() => { const b = document.querySelector('[data-constellation]').getBoundingClientRect(); return [...document.querySelectorAll('[data-constellation-star], [data-constellation-label]')].map(s => s.getBoundingClientRect()).map(r => [r.left - b.left, r.top - b.top, r.right - b.left]); })()")
    for left, top, right in boxes:
        assert 0 <= left and right <= width and height * 0.45 <= top <= height, (left, top, right)
    assert not errors, errors
    print(f"{width}x{height}: stage 0 → {mid:.2f} → 1, stars travel, labels and lines appear, page and mask fade")


def check_reduced_motion(browser):
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce")
    page = ctx.new_page()
    page.goto(BASE, wait_until="networkidle")
    page.wait_for_timeout(600)
    assert progress(page) == 1
    assert page.evaluate("document.querySelector('[data-hero-stage]').offsetHeight") <= 900 + 1
    assert page.evaluate("document.querySelector('[data-constellation-label]').style.opacity") == "1"
    expect(page.get_by_role("link", name="Start learning")).to_be_visible()
    ctx.close()
    print("reduced motion: finished constellation, no scroll stage")


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
