import json

from evals.stream import StreamCheck


def event(check, name, data):
    for line in (f"event: {name}", "data: " + json.dumps(data), ""):
        check.line(line)


def test_final_replaces_tokens_and_reports_are_redacted():
    check = StreamCheck()
    event(check, "session", {"thread_id": "private"})
    event(check, "token", {"delta": "discard this https://private.test"})
    event(check, "result", {
        "answer": "## From your documents\nFact\n## From the web\nPrivate web excerpt",
        "citations": [{"source_type": "document"},
                      {"source_type": "web", "url": "https://private.test"}],
        "usage": {"web_calls": 2}})
    summary = check.summary()
    assert summary["completed"] and summary["separate_sections"]
    assert summary["web_cap_valid"]
    assert "private" not in json.dumps(summary).lower()
    assert "excerpt" not in json.dumps(summary).lower()


def test_interrupted_stream_not_completed():
    check = StreamCheck()
    event(check, "token", {"delta": "incomplete"})
    assert not check.summary()["completed"]


def test_error_after_result_fails():
    check = StreamCheck()
    event(check, "result", {"answer": "Answer", "citations": []})
    event(check, "error", {"message": "private failure"})
    assert not check.summary()["completed"]


def test_duplicate_final_and_invalid_cap():
    check = StreamCheck()
    for _ in range(2):
        event(check, "result", {"answer": "Answer", "usage": {"web_calls": 3}})
    assert not check.summary()["completed"]
    assert not check.summary()["web_cap_valid"]


def test_malformed_and_unterminated_events():
    check = StreamCheck()
    check.line("event: result")
    check.line('data: {"answer":"secret"}')
    assert not check.summary()["completed"]
    check.line("")
    event(check, "result", [])
    assert check.summary()["stream_errors"] == 1


def test_web_without_sections_and_no_semantic_overclaim():
    check = StreamCheck()
    event(check, "result", {"answer": "Mixed answer", "citations": [{"source_type": "web"}]})
    assert check.summary()["separate_sections"] is False
    assert check.summary()["semantic_grounding"] == "requires_review"


def test_failed_web_search_still_requires_segregated_answer_sections():
    check = StreamCheck()
    event(check, "result", {"answer": "Unsegregated fallback", "citations": [],
                            "usage": {"web_calls": 1}, "persisted_answer": "safe view"})
    assert check.summary()["separate_sections"] is False


def test_error_usage_retained_without_error_text_and_duplicates_rejected():
    check = StreamCheck()
    event(check, "session", {"runtime_id": "runtime"})
    event(check, "error", {"message": "private", "usage": {"chat_calls": 3, "web_calls": 2}})
    assert check.runtime_id == "runtime"
    assert check.usage == {"chat_calls": 3, "web_calls": 2}
    assert check.summary()["web_attempts"] == 2
    assert "private" not in json.dumps(check.__dict__)
    event(check, "session", {"runtime_id": "wrong"})
    assert check.runtime_id == "runtime"
    assert check.summary()["stream_errors"] == 2


def test_invalid_usage_cannot_be_hidden_by_an_earlier_valid_value():
    check = StreamCheck()
    event(check, "error", {"usage": {"web_calls": 1}})
    event(check, "result", {"answer": "answer", "usage": {"web_calls": True}})
    assert not check.summary()["web_cap_valid"]
