"""Ask gaps not covered by check_web_streaming/research/deletions/persistence/frontend:
upload validation, failure and retry; the five-source limit; Stop while streaming;
malformed and incomplete streams surface errors instead of a silent success."""

import re

from playwright.sync_api import expect

from e2e.conftest import DOC
from e2e.router import error, malformed, ok, sse

NEW = "/workspace/chats/new"
THREAD = "33333333-3333-4333-8333-333333333333"


def select_first_source(page):
    page.get_by_role("checkbox").first.check()


def ask(page, text="What must labels contain?"):
    page.get_by_role("textbox", name="Message", exact=True).fill(text)
    page.get_by_role("button", name="Send", exact=True).click()


def test_upload_validation_backend_error_and_retry(page, api, console):
    console.allow(r"status of 422")
    api.on("POST", "documents/upload",
           error("PDF has no extractable text. Run OCR on the file first.", 422),
           ok({"id": DOC, "title": "Synthetic handbook", "edition": "test", "chunks": 4}, 201))
    page.goto(NEW)
    upload = page.get_by_label("Upload file", exact=True)
    # Client-side validation: empty files never reach the server.
    upload.set_input_files({"name": "empty.txt", "mimeType": "text/plain", "buffer": b""})
    expect(page.get_by_text("Choose a nonempty file no larger than 10 MB.")).to_be_visible()
    assert not api.calls("POST", "documents/upload")
    # The backend's own message is shown, then a retry succeeds and selects the source.
    upload.set_input_files({"name": "scan.pdf", "mimeType": "application/pdf", "buffer": b"%PDF-1.4 fixture"})
    expect(page.get_by_role("status").filter(has_text="PDF has no extractable text")).to_be_visible()
    api.on("GET", "documents", ok([{"id": DOC, "title": "Synthetic handbook", "edition": "test"}]))
    upload.set_input_files({"name": "guide.md", "mimeType": "text/markdown", "buffer": b"# Guide\n\nLabels are blue."})
    expect(page.get_by_role("status").filter(has_text="Indexed Synthetic handbook · 4 chunks")).to_be_visible()
    expect(page.get_by_role("checkbox", name=re.compile("Synthetic handbook"))).to_be_checked()
    calls = api.calls("POST", "documents/upload")
    assert len(calls) == 2 and "filename=guide.md" in calls[-1].query


def test_source_limit_is_five(page, api, console):
    docs = [{"id": f"{i}1111111-1111-4111-8111-111111111111", "title": f"Source {i}", "edition": "test"}
            for i in range(1, 7)]
    api.on("GET", "documents", ok(docs))
    page.goto(NEW)
    boxes = page.get_by_role("checkbox")
    expect(boxes).to_have_count(6)
    for index in range(5):
        boxes.nth(index).check()
    expect(page.get_by_text("Sources · 5/5")).to_be_visible()
    boxes.nth(5).click()
    expect(boxes.nth(5)).not_to_be_checked()
    expect(page.get_by_text("Select up to five documents.")).to_be_visible()


def test_stop_interrupts_a_streaming_answer(page, ask_world, console):
    api = ask_world
    api.on("POST", "query", hold=True)
    page.goto(NEW)
    select_first_source(page)
    ask(page)
    expect(page.get_by_role("button", name="Stop", exact=True)).to_be_visible()
    page.get_by_role("button", name="Stop", exact=True).click()
    expect(page.get_by_text("Stopped", exact=True)).to_be_visible()
    expect(page.get_by_role("button", name="Send", exact=True)).to_be_visible()
    body = api.calls("POST", "query")[0].body
    assert body["user_query"] == "What must labels contain?" and body["document_ids"] == [DOC]


def test_incomplete_stream_is_an_error_not_a_silent_success(page, ask_world, console):
    api = ask_world
    # Progress and a session arrive, but the stream ends before any result.
    api.on("POST", "query", sse(("session", {"thread_id": THREAD, "runtime_id": "fixture"}),
                                ("progress", {"type": "progress", "version": 1, "step": "retrieve",
                                              "id": "retrieve", "status": "started", "attempt": 0, "sequence": 1})))
    page.goto(NEW)
    select_first_source(page)
    ask(page)
    expect(page.get_by_text("The connection ended before an answer arrived. Try again.").first).to_be_visible()
    expect(page.get_by_role("button", name="Send", exact=True)).to_be_visible()


def test_malformed_stream_and_http_errors_are_reported(page, ask_world, console):
    api = ask_world
    console.allow(r"status of 503")
    api.on("POST", "query",
           malformed("event: result\ndata: {broken json\n\n", content_type="text/event-stream"),
           error("Request failed. Check backend configuration.", 503),
           sse(("session", {"thread_id": THREAD}),
               ("result", {"thread_id": THREAD, "answer": "Labels are blue [1].",
                           "citations": [{"citation": 1, "document_id": DOC, "document_title": "Synthetic handbook",
                                          "edition": "test", "number": "1", "kind": "section", "page": 2}],
                           "warnings": []})))
    page.goto(NEW)
    select_first_source(page)
    ask(page, "First question")
    expect(page.get_by_role("button", name="Send", exact=True)).to_be_visible()
    assert page.get_by_text("Labels are blue").count() == 0
    ask(page, "Second question")
    expect(page.get_by_text("Request failed. Check backend configuration.").first).to_be_visible()
    # A retry then succeeds with a citation; the failed turns did not create a thread.
    ask(page, "Third question")
    expect(page.get_by_text("Labels are blue")).to_be_visible()
    expect(page.get_by_label("Sources").get_by_text("[1] Synthetic handbook · Page 2")).to_be_visible()
    bodies = [c.body for c in api.calls("POST", "query")]
    assert [b["user_query"] for b in bodies] == ["First question", "Second question", "Third question"]
    assert all(b["thread_id"] is None for b in bodies)
