"""What an Ask turn stores in PostgreSQL.

Web research is retained like document research: the full answer (including its
"From the web" section and links) and the web citations (title, URL, dates) are saved,
so a reloaded chat shows the same answer and follow-ups can rely on it. Raw source
payloads (retrieved page or chunk text, excerpts) are not part of a citation's saved
form for either kind of source.
"""

RAW_SOURCE_FIELDS = {"text", "excerpt"}


def stored_turn(question, answer, citations):
    """Return the question, answer and citations exactly as they are saved."""
    return (
        question,
        answer,
        [{key: value for key, value in c.items() if key not in RAW_SOURCE_FIELDS} for c in citations],
    )
