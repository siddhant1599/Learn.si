"""Deletion UI regressions with mocked provider APIs. Chats come from the (fake) server,
as they do from the real backend: deleting one removes it from the server and every tab."""


from playwright.sync_api import expect, sync_playwright

from scripts.browser import BASE, SavedChats, launch

DOC = "11111111-1111-4111-8111-111111111111"
CHAT = "22222222-2222-4222-8222-222222222222"
DRAFT = "33333333-3333-4333-8333-333333333333"
CITATION = {"citation": 1, "source_type": "document", "document_id": DOC,
            "document_title": "Disposable handbook", "edition": "test", "number": "1", "kind": "section"}


def main():
    with sync_playwright() as p:
        browser = launch(p)
        context = browser.new_context()
        errors, deleted = [], []
        docs = [{"id": DOC, "title": "Disposable handbook", "edition": "test"}]
        failures = [True]
        chats = SavedChats()
        chats.add(CHAT, "Disposable chat", [DOC],
                  [("What does the handbook say?", "Saved document finding [1].", [CITATION])])
        chats.add(DRAFT, "Mobile draft", [DOC], [("Mobile question", "Mobile answer.", [])])
        context.route("**/api/rag/health", lambda r: r.fulfill(json={"web_available": False}))
        context.route("**/api/rag/documents", lambda r: r.fulfill(json=docs))
        context.route("**/api/rag/deletions", lambda r: r.fulfill(json=deleted))
        chats.install(context)

        def remove_doc(route):
            assert route.request.method == "DELETE"
            docs.clear()
            if not deleted:
                deleted.append({"kind": "document", "id": DOC, "pending": True})
                route.fulfill(status=202, json={"status": "cleanup_pending"})
            else:
                deleted[0]["pending"] = False
                route.fulfill(json={"status": "deleted"})

        def remove_chat(chat_id, flaky):
            def handler(route):
                assert route.request.method == "DELETE"
                if flaky and failures.pop() if failures else False:
                    return route.fulfill(status=503, json={"detail": "Temporary failure. Retry."})
                chats.remove(chat_id)
                deleted.append({"kind": "conversation", "id": chat_id, "pending": False})
                route.fulfill(json={"status": "deleted"})
            return handler

        context.route("**/api/rag/documents/" + DOC, remove_doc)
        context.route("**/api/rag/conversations/" + CHAT, remove_chat(CHAT, flaky=True))
        context.route("**/api/rag/conversations/" + DRAFT, remove_chat(DRAFT, flaky=False))
        a, b = context.new_page(), context.new_page()
        for page in (a, b):
            page.on("pageerror", lambda e: errors.append(str(e)))
        for page in (a, b):
            page.goto(f"{BASE}/workspace/chats/{CHAT}", wait_until="networkidle")
        expect(a.get_by_text("Saved document finding [1].", exact=True)).to_be_visible()
        a.get_by_role("button", name="Delete Disposable handbook", exact=True).click()
        a.get_by_role("button", name="Cancel", exact=True).click()
        assert docs
        a.get_by_role("button", name="Delete Disposable handbook", exact=True).click()
        a.get_by_role("button", name="Delete", exact=True).click()
        expect(a.get_by_text("Source removed; external cleanup pending.")).to_be_visible()
        expect(a.get_by_text("Source unavailable (deleted)", exact=False)).to_be_visible()
        expect(a.get_by_role("textbox", name="Message", exact=True)).to_be_disabled()
        expect(a.get_by_text("Saved document finding [1].", exact=True)).to_be_visible()
        a.get_by_role("button", name="Delete pending source cleanup", exact=True).click()
        a.get_by_role("button", name="Delete", exact=True).click()
        expect(a.get_by_text("Source removed; external cleanup pending.")).to_have_count(0)
        a.get_by_role("button", name="Delete Disposable chat", exact=True).click()
        a.get_by_role("button", name="Delete", exact=True).click()
        expect(a.get_by_role("alert")).to_contain_text("Temporary failure")
        a.get_by_role("button", name="Retry deletion", exact=True).click()
        expect(a).to_have_url(BASE + "/workspace/chats/new")
        expect(b).to_have_url(BASE + "/workspace/chats/new")
        # A server that still lists a chat its deletion record says is gone: the chat stays hidden.
        chats.add(CHAT, "Disposable chat", [DOC], [("Stale", "Stale answer.", [])])
        a.reload(wait_until="networkidle")
        expect(a.get_by_role("button", name="Delete Disposable chat", exact=True)).to_have_count(0)
        chats.remove(CHAT)
        # Phone width, keyboard only: delete a chat from the Chats page; gone after a reload too.
        a.set_viewport_size({"width": 390, "height": 844})
        assert a.evaluate("document.documentElement.scrollWidth <= innerWidth")
        a.goto(BASE + '/workspace/chats', wait_until='networkidle')
        trigger = a.get_by_role('button', name='Delete Mobile draft', exact=True)
        trigger.click()
        a.keyboard.press('Escape')
        expect(trigger).to_be_focused()
        trigger.press('Enter')
        a.get_by_role('button', name='Delete', exact=True).click()
        expect(trigger).to_have_count(0)
        a.reload(wait_until='networkidle')
        expect(a.get_by_role('button', name='Delete Mobile draft', exact=True)).to_have_count(0)
        assert not a.evaluate("Object.keys(localStorage).some(k => k.startsWith('document-lab.chat.v2.'))")
        assert not errors, errors
        browser.close()
        print(
            "PASS: cancel, document cleanup pending/retry, preserved history, unavailable citations, blocked follow-up, chat error/retry, active redirect, cross-tab and stale server listing, mobile keyboard deletion"
        )


if __name__ == "__main__":
    main()
