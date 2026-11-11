"""In-memory SSE contract evaluation; never serialize raw answers or web payloads."""
import json


class StreamCheck:
    def __init__(self):
        self.name = "message"
        self.data = []
        self.result = None
        self.tokens = 0
        self.errors = 0
        self.results = 0
        self.session = False
        self.runtime_id = None
        self.usage = {}
        self.invalid_usage = False

    def line(self, line):
        if line == "":
            if self.data:
                self._event()
            self.data = []
            self.name = "message"
        elif line.startswith("event:"):
            self.name = line[6:].strip()
        elif line.startswith("data:"):
            self.data.append(line[5:].lstrip())

    def _event(self):
        try:
            payload = json.loads("\n".join(self.data))
            if not isinstance(payload, dict):
                raise ValueError()
            if self.name == "session":
                if self.session:
                    raise ValueError()
                self.session = True
                self.runtime_id = payload.get("runtime_id")
            elif self.name == "token":
                if not isinstance(payload.get("delta"), str):
                    raise ValueError()
                self.tokens += 1
            elif self.name == "result":
                self.results += 1
                self.result = payload  # Final replacement, never concatenate streamed tokens.
            elif self.name == "error":
                self.errors += 1
            if self.name in {"result", "error"}:
                # Retain counters only, including failures; never retain error messages.
                usage = payload.get("usage", {})
                if isinstance(usage, dict):
                    for key in ("chat_calls", "embedding_calls", "web_calls"):
                        value = usage.get(key)
                        if type(value) is int and value >= 0:
                            self.usage[key] = max(value, self.usage.get(key, 0))
                        elif key in usage:
                            self.invalid_usage = True
                elif "usage" in payload:
                    self.invalid_usage = True
        except (ValueError, TypeError):
            self.errors += 1

    def summary(self):
        result = self.result or {}
        answer = result.get("answer", "")
        citations = result.get("citations", [])
        usage = result.get("usage", {})
        if not isinstance(citations, list) or any(not isinstance(c, dict) for c in citations):
            citations = []
            malformed = True
        else:
            malformed = False
        web = sum(c.get("source_type") == "web" for c in citations)
        calls = (self.usage.get("web_calls", usage.get("web_calls", 0))
                 if isinstance(usage, dict) else None)
        calls_valid = type(calls) is int and calls >= 0 and not self.invalid_usage
        completed = (self.results == 1 and self.errors == 0 and isinstance(answer, str)
                     and bool(answer.strip()) and not malformed and not self.data)
        return {
            "completed": completed, "session_received": self.session,
            "token_events": self.tokens, "stream_errors": self.errors,
            "final_results": self.results, "document_citations": len(citations) - web,
            "web_citations": web,
            "web_attempts": calls if calls_valid else None,
            "web_cap_valid": calls_valid and calls <= 2,
            "separate_sections": (
                "## From your documents" in answer and "## From the web" in answer
            ) if isinstance(answer, str) and web else None,
            # Text headings and real citation IDs alone do not prove claim support.
            "semantic_grounding": "requires_review",
        }
