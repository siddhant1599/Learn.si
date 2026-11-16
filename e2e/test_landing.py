"""Landing and docs gaps not covered by scripts/check_web_landing and check_web_docs:
CTA destinations, header/mobile/footer links, the removed sections staying gone,
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
    assert len(ctas) >= 1, ctas  # The hero; the header button now links to GitHub.
    assert all(href == "/workspace" for _, href in ctas), ctas
    star = page.get_by_role("banner").get_by_role("link", name="Star on GitHub")
    expect(star).to_have_attribute("href", re.compile(r"^https://github\.com/"))
    expect(star).to_have_attribute("target", "_blank")
    # No landing link skips the chooser into a mode.
    assert not [h for _, h in hrefs if h and re.match(r"/workspace/(chats|courses|progress)", h)], hrefs
    page.get_by_role("link", name=re.compile("Start learning")).first.click()
    expect(page).to_have_url(re.compile(r"/workspace$"))
    expect(page.get_by_role("link", name="Master: Learn deeply. Build mastery.")).to_be_visible()


def test_header_and_mobile_menu_links_footer_has_none(page, api):
    page.goto("/")
    header = page.get_by_role("banner")
    expect(header.get_by_role("link", name="Docs", exact=True)).to_have_attribute("href", "/docs")
    expect(header.get_by_role("link", name="Workspace", exact=True)).to_have_attribute("href", "/workspace")
    # The footer's link row (Workspace, Docs, Repository, license) was removed on request.
    expect(page.get_by_role("navigation", name="Footer")).to_have_count(0)
    site_footer = page.get_by_role("contentinfo")  # The page footer (the demo card has its own <footer>).
    expect(site_footer.get_by_role("link")).to_have_count(0)
    expect(site_footer).to_contain_text("Understand what you read. Remember what you learn.")
    page.set_viewport_size({"width": 390, "height": 844})
    page.get_by_role("button", name="Open menu").click()
    menu = page.get_by_role("dialog")
    expect(menu).to_be_visible()
    menu.get_by_role("link", name="Docs").click()
    expect(page).to_have_url(re.compile(r"/docs$"))
    expect(page.get_by_role("heading", level=1)).to_have_text("Study Buddy Docs")
    no_overflow(page, "docs mobile")


def test_removed_sections_are_not_on_the_landing(page, api):
    page.goto("/")
    expect(page.get_by_role("heading", name="Understand what you read. Remember what you learn.")).to_be_visible()
    for removed in ("#how-it-works", "#privacy", "#closing-title"):
        expect(page.locator(removed)).to_have_count(0)
    for heading in ("Make your documents part of your day", "Know where your information goes",
                    "Your next insight is already in your documents."):
        expect(page.get_by_role("heading", name=heading)).to_have_count(0)
    # The page now ends with the features section, then the footer.
    order = page.evaluate("[...document.querySelectorAll('main > *')].map(n => n.id || n.querySelector('h2')?.textContent || '')")
    assert order[-1].startswith("Agents that help you learn"), order


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


def test_demo_replay_restarts_the_run_and_labels_are_removed(page, api):
    page.goto("/")
    # The "Scripted illustration · no model calls" labels were removed on request.
    expect(page.get_by_text(re.compile(r"Scripted illustration"))).to_have_count(0)
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


def test_design_b_demo_sits_below_the_original_and_plays(page, api):
    page.goto("/")
    order = page.evaluate("[...document.querySelectorAll('main > *')].map(n => n.id)")
    assert order.index("examples-stage") == order.index("examples") + 1, order
    stage = page.locator("#examples-stage")
    stage.scroll_into_view_if_needed()  # Auto-plays once it is on screen.
    expect(stage.get_by_text("What is a Pod?")).to_be_visible(timeout=5000)
    expect(stage.get_by_text(re.compile("Grounded in 2 cited sentences"))).to_be_visible(timeout=20000)
    stage.get_by_role("button", name="Know what's missing").click()
    expect(stage.get_by_text("How much CPU should I request?")).to_be_visible()
    expect(stage.get_by_text(re.compile("Partly answered"))).to_be_visible(timeout=20000)
    no_overflow(page, "landing with design B")
