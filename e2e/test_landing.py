"""Landing and docs gaps not covered by scripts/check_web_landing and check_web_docs:
CTA destinations, header/mobile/footer links, product images, shared privacy wording,
and the ordering exercise's partial verdict, movement limits and reveal."""

import re

import pytest
from playwright.sync_api import expect

from e2e.conftest import no_overflow

LEARNING_CTA = re.compile(r"start learning|open (your )?workspace|get started", re.I)


def test_every_learning_cta_goes_to_the_chooser_never_to_a_mode(page, api):
    page.goto("/")
    links = page.locator("a[href]")
    hrefs = links.evaluate_all("nodes => nodes.map(n => [n.textContent.trim(), n.getAttribute('href')])")
    ctas = [(text, href) for text, href in hrefs if LEARNING_CTA.search(text)]
    assert len(ctas) >= 3, ctas  # Header, hero and closing CTA at least.
    assert all(href == "/workspace" for _, href in ctas), ctas
    # No landing link skips the chooser into a mode.
    assert not [h for _, h in hrefs if h and re.match(r"/workspace/(chats|courses|progress)", h)], hrefs
    page.get_by_role("link", name=re.compile("Start learning")).first.click()
    expect(page).to_have_url(re.compile(r"/workspace$"))
    expect(page.get_by_role("link", name="Master: Learn deeply. Build mastery.")).to_be_visible()


def test_header_footer_and_mobile_menu_links(page, api):
    page.goto("/")
    footer = page.get_by_role("navigation", name="Footer")
    expect(footer.get_by_role("link", name="Workspace")).to_have_attribute("href", "/workspace")
    expect(footer.get_by_role("link", name="Docs")).to_have_attribute("href", "/docs")
    expect(footer.get_by_role("link", name="Repository")).to_have_attribute("href", re.compile(r"^https://github\.com/"))
    expect(footer.get_by_role("link", name="Frontend MIT license")).to_have_attribute("href", re.compile(r"/web/LICENSE$"))
    page.set_viewport_size({"width": 390, "height": 844})
    page.get_by_role("button", name="Open menu").click()
    menu = page.get_by_role("dialog")
    expect(menu).to_be_visible()
    menu.get_by_role("link", name="Docs").click()
    expect(page).to_have_url(re.compile(r"/docs$"))
    expect(page.get_by_role("heading", level=1)).to_have_text("Study Buddy Docs")
    no_overflow(page, "docs mobile")


def test_product_images_load_with_reserved_dimensions(page, api):
    page.goto("/")
    images = page.locator('img[src*="product-"]')
    expect(images).to_have_count(2)
    for index in range(2):
        image = images.nth(index)
        image.scroll_into_view_if_needed()
        expect(image).to_have_attribute("width", re.compile(r"^\d+$"))
        expect(image).to_have_attribute("height", re.compile(r"^\d+$"))
        expect(image).to_have_attribute("alt", re.compile(r"\w"))
        page.wait_for_function("img => img.complete && img.naturalWidth > 0", arg=image.element_handle())
    link = page.get_by_role("link", name=re.compile("View full-size .* screenshot")).first
    assert page.request.get(link.get_attribute("href")).status == 200


def test_privacy_wording_on_landing_matches_the_docs(page, api):
    page.goto("/")
    section = page.locator("#privacy")
    section.scroll_into_view_if_needed()
    landing = [t.strip() for t in section.locator("li p, li div p, p").all_inner_texts() if len(t.strip()) > 80]
    page.goto("/docs/evidence#at-a-glance")
    docs = page.locator("#at-a-glance").locator("xpath=..").inner_text()
    assert len(landing) >= 4, landing
    for paragraph in landing[:4]:
        assert paragraph in docs, paragraph


@pytest.fixture
def order(page, api):
    page.goto("/")
    card = page.locator("[data-lesson-card]")
    card.scroll_into_view_if_needed()
    return card


def steps(card):
    return card.locator("[data-order-item]").evaluate_all("nodes => nodes.map(n => n.dataset.orderItem)")


def move_up(card, step_id, times=1):
    for _ in range(times):
        card.locator(f'[data-order-item="{step_id}"]').get_by_role("button", name=re.compile("^Move up")).click()


def test_ordering_partial_verdict_boundaries_and_reveal(order):
    card = order
    verdict = card.page.locator("[data-order-verdict]")
    assert steps(card) == ["start", "network", "describe", "schedule"]
    first, last = card.locator("[data-order-item]").first, card.locator("[data-order-item]").last
    # Movement limits: the first item cannot move up, the last cannot move down.
    expect(first.get_by_role("button", name=re.compile("^Move up"))).to_be_disabled()
    expect(last.get_by_role("button", name=re.compile("^Move down"))).to_be_disabled()
    # Two correct positions -> partial: describe first, start third... build: describe, start, network, schedule?
    move_up(card, "describe", 2)  # describe, start, network, schedule -> describe correct only
    move_up(card, "schedule", 2)  # describe, schedule, start, network -> all four correct
    move_up(card, "start", 1)     # describe, start, schedule, network -> 2 correct (describe, network)
    assert steps(card) == ["describe", "start", "schedule", "network"]
    card.get_by_role("button", name="Check order").click()
    expect(verdict).to_have_attribute("data-order-verdict", "partial")
    expect(verdict).to_contain_text("Scheduling happens before anything is pulled or started.")
    expect(card.locator('[data-placed="true"]')).to_have_count(2)
    # The reveal appears only after a second unsuccessful check, and solves the exercise.
    expect(card.get_by_role("button", name="Show the order")).to_have_count(0)
    card.get_by_role("button", name="Check order").click()
    card.get_by_role("button", name="Show the order").click()
    expect(verdict).to_have_attribute("data-order-verdict", "correct")
    assert steps(card) == ["describe", "schedule", "start", "network"]
    expect(card.get_by_role("button", name="Check order")).to_be_disabled()
    expect(card.locator("[data-order-item] button").first).to_be_disabled()


def test_demos_are_labeled_scripted_and_replay_restarts_the_run(page, api):
    page.goto("/")
    # Both illustrations say plainly that nothing calls a model.
    expect(page.get_by_text(re.compile(r"Scripted illustration · no model calls"))).to_have_count(2)
    panel = page.get_by_role("tabpanel")
    panel.scroll_into_view_if_needed()  # The run only advances while it is on screen.
    answer = "A Pod is the unit Kubernetes schedules"
    expect(panel.get_by_text(answer, exact=False)).to_be_visible(timeout=20000)  # The run finishes.
    panel.get_by_role("button", name="Replay preview").click()
    # Replay restarts: the finished answer is gone, then streams back.
    expect(panel.get_by_text(answer, exact=False)).to_have_count(0)
    expect(panel.get_by_text(answer, exact=False)).to_be_visible(timeout=20000)
    # Keyboard: arrow keys move between example tabs and select them.
    tab = page.get_by_role("tab", name="Ask a definition")
    tab.focus()
    page.keyboard.press("ArrowRight")
    expect(page.get_by_role("tab", name="Connect two ideas")).to_be_focused()
    expect(page.get_by_role("tab", name="Connect two ideas")).to_have_attribute("aria-selected", "true")
    expect(panel.get_by_text("Why do my Pods disappear when a node fails?")).to_be_visible()
