"""Read-only workspace mode checks: chooser, sidebar switch, Master shell, history, mobile, themes.

No providers, uploads, or database writes. Run against the production frontend:
uv run --with playwright python -m scripts.check_web_modes
"""
from playwright.sync_api import expect, sync_playwright

BASE = "http://127.0.0.1:3001"
MASTER_ROUTES = ["/workspace/courses", "/workspace/courses/demo", "/workspace/courses/demo/lessons/intro", "/workspace/progress"]


def no_overflow(page, label):
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), label


def mode_button(page, name):
    return page.get_by_role("group", name="Workspace mode").filter(visible=True).get_by_role("button", name=name, exact=True)


def check_desktop(page, errors):
    page.goto(BASE)
    page.get_by_role("link", name="Start learning").click()
    expect(page).to_have_url(f"{BASE}/workspace")
    ask = page.get_by_role("link", name="Ask: Get answers. Understand anything.")
    master = page.get_by_role("link", name="Master: Learn deeply. Build mastery.")
    expect(ask).to_be_visible()
    expect(master).to_be_visible()
    # Standalone chooser: no sidebar, no mode switch.
    expect(page.get_by_role("button", name="Toggle Sidebar")).to_have_count(0)
    expect(page.get_by_role("group", name="Workspace mode")).to_have_count(0)
    no_overflow(page, "chooser")
    # Keyboard: the Ask card is reachable and Enter opens Ask mode.
    ask.focus()
    page.keyboard.press("Enter")
    expect(page).to_have_url(f"{BASE}/workspace/chats/new")
    expect(page.get_by_role("textbox", name="Message")).to_be_visible()
    expect(mode_button(page, "Ask")).to_have_attribute("aria-pressed", "true")
    expect(page.get_by_role("link", name="New chat")).to_be_visible()
    # Sidebar switch to Master and back.
    mode_button(page, "Master").click()
    expect(page).to_have_url(f"{BASE}/workspace/courses")
    expect(page.get_by_role("heading", level=2, name="No courses yet")).to_be_visible()
    expect(page.get_by_role("link", name="Progress")).to_be_visible()
    expect(page.get_by_role("link", name="New chat")).to_have_count(0)
    expect(page.get_by_text("Sources", exact=True)).to_have_count(0)
    page.go_back()
    expect(page).to_have_url(f"{BASE}/workspace/chats/new")
    page.go_forward()
    expect(page).to_have_url(f"{BASE}/workspace/courses")
    # Sidebar brand link returns to the chooser; the chooser remembers but does not redirect.
    page.get_by_role("link", name="Study Buddy", exact=True).first.click()
    expect(page).to_have_url(f"{BASE}/workspace")
    expect(page.get_by_text("Last used")).to_be_visible()
    # Direct loads, refresh and 200s for every Master route.
    for route in MASTER_ROUTES:
        response = page.goto(f"{BASE}{route}")
        assert response.status == 200, route
        expect(page.get_by_role("heading", level=1)).to_be_visible()
        page.reload()
        expect(page.get_by_role("heading", level=1)).to_be_visible()
        expect(mode_button(page, "Master")).to_have_attribute("aria-pressed", "true")
        no_overflow(page, route)
    expect(page.get_by_role("link", name="Go to courses")).to_be_visible()
    # Collapsed rail keeps both mode buttons.
    page.goto(f"{BASE}/workspace/courses")
    page.get_by_role("button", name="Toggle Sidebar").first.click()
    expect(page.get_by_role("button", name="Master mode")).to_have_attribute("aria-pressed", "true")
    page.get_by_role("button", name="Ask mode").click()
    expect(page).to_have_url(f"{BASE}/workspace/chats/new")
    assert not errors, errors
    print("Desktop: standalone chooser, keyboard entry, sidebar switch, history, deep links, rail passed")


def check_themes(page):
    page.goto(f"{BASE}/workspace")
    for theme in ("dark", "light"):
        page.evaluate(f"document.documentElement.classList.toggle('dark', {str(theme == 'dark').lower()})")
        expect(page.get_by_role("link", name="Ask: Get answers. Understand anything.")).to_be_visible()
    print("Themes: chooser renders in dark and light")


def check_mobile(page, errors):
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto(f"{BASE}/workspace")
    no_overflow(page, "chooser mobile")
    page.get_by_role("link", name="Master: Learn deeply. Build mastery.").click()
    expect(page).to_have_url(f"{BASE}/workspace/courses")
    no_overflow(page, "courses mobile")
    page.get_by_role("button", name="Toggle Sidebar").first.click()
    mode_button(page, "Ask").click()
    expect(page).to_have_url(f"{BASE}/workspace/chats/new")
    expect(page.get_by_role("dialog")).to_have_count(0)
    no_overflow(page, "chat mobile")
    assert not errors, errors
    print("Mobile: chooser, Master page and sheet mode switch passed")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        check_desktop(page, errors)
        check_themes(page)
        check_mobile(page, errors)
        browser.close()


if __name__ == "__main__":
    main()
