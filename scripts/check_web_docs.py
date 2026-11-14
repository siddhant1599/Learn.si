"""Read-only docs browser checks; no providers, uploads, or database writes.

Run against the production frontend: uv run --with playwright python -m scripts.check_web_docs
"""
from playwright.sync_api import expect, sync_playwright

BASE = "http://127.0.0.1:3001"
SLUGS = ["", "getting-started", "evidence", "deletion", "local-setup", "architecture", "api", "evaluation", "troubleshooting"]


def check_docs(page):
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    for slug in SLUGS:
        response = page.goto(f"{BASE}/docs" + (f"/{slug}" if slug else ""))
        assert response.status == 200
        expect(page.locator("h1")).to_be_visible()
        # All rendered heading links resolve, including duplicate desktop/mobile TOCs.
        for href in page.locator('a[href^="#"]').evaluate_all("nodes => nodes.map(n => n.getAttribute('href'))"):
            assert page.locator(f'[id="{href[1:]}"]').count() == 1, href
        for width in (1440, 390):
            page.set_viewport_size({"width": width, "height": 900})
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), slug
    page.set_viewport_size({"width": 1440, "height": 900})
    page.goto(f"{BASE}/docs/api#events")
    expect(page.locator("#events")).to_be_in_viewport()
    page.reload()
    expect(page.locator("#events")).to_be_in_viewport()
    page.get_by_role("navigation", name="Documentation pages").filter(visible=True).get_by_role("link", name="Architecture", exact=True).click()
    expect(page.locator("h1")).to_have_text("Architecture")
    page.go_back()
    expect(page.locator("h1")).to_have_text("API and SSE reference")
    page.go_forward()
    expect(page.locator("h1")).to_have_text("Architecture")
    page.get_by_role("button", name="Search docs", exact=True).click()
    search = page.get_by_role("searchbox", name="Search documentation")
    expect(search).to_be_focused()
    search.fill("unfindable-zebra")
    expect(page.get_by_role("status")).to_contain_text("0 results")
    search.fill("TAVILY_KEY")
    search.press("ArrowDown")
    expect(page.locator("[data-doc-result]").first).to_be_focused()
    page.keyboard.press("Enter")
    expect(page.get_by_role("dialog")).not_to_be_visible()
    assert "#" in page.url
    page.get_by_role("button", name="Search docs", exact=True).click()
    page.keyboard.press("Escape")
    expect(page.get_by_role("button", name="Search docs", exact=True)).to_be_focused()
    for theme in ("dark", "light"):
        # Set via the public control, using the current class to avoid system assumptions.
        if page.locator("html").evaluate("el => el.classList.contains('dark')") != (theme == "dark"):
            page.get_by_role("button", name="Toggle theme").click()
        expect(page.locator("html")).to_have_class(theme)
        expect(page.locator("h1")).to_be_visible()
    page.set_viewport_size({"width": 390, "height": 844})
    page.get_by_text("Browse documentation", exact=True).click()
    page.get_by_role("navigation", name="Documentation pages").filter(visible=True).get_by_role("link", name="Delete chats and sources", exact=True).click()
    expect(page.locator("h1")).to_have_text("Delete chats and sources")
    assert not page.locator("aside details").evaluate("el => el.open")
    expect(page.get_by_role("navigation", name="On this page").filter(visible=True)).to_be_visible()
    response = page.goto(f"{BASE}/docs/not-a-page")
    assert response.status == 404
    expect(page.get_by_role("heading", name="Documentation not found")).to_be_visible()
    assert not errors, errors
    print("Docs: 9 routes, anchors, refresh/history, search keyboard/focus, themes, mobile and 404 passed")


def check_landing(page):
    for width in (1440, 390):
        page.set_viewport_size({"width": width, "height": 900})
        page.goto(BASE)
        assert page.locator("#examples").count() == 1
        if width == 390:
            page.get_by_role("button", name="Open menu", exact=True).click()
        docs = page.get_by_role("link", name="Docs", exact=True).filter(visible=True)
        expect(docs).to_have_attribute("href", "/docs")
        docs.click()
        expect(page.locator("h1")).to_have_text("Study Buddy Docs")
        expect(page.get_by_role("dialog")).not_to_be_visible()
        expect(page.get_by_role("link", name="Workspace", exact=True)).to_have_attribute("href", "/workspace")
    print("Landing: desktop/mobile Docs link and preserved examples passed")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        check_docs(page)
        check_landing(page)
        browser.close()


if __name__ == "__main__":
    main()
