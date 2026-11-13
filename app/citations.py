"""Citation syntax outside Markdown code and escaped literal brackets."""

import re

FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")
INLINE = re.compile(r"(`+)(?!`)(.*?)(?<!`)\1(?!`)", re.S)
NATIVE = re.compile(r"【(\d+)(?:†L\d+(?:-L\d+)?)?】|［(\d+)］")


def segments(text):
    """Yield (prose, text), retaining original code bytes and fence lengths."""
    pending, fence = [], None

    def inline(text):
        start = 0
        for match in INLINE.finditer(text):
            yield True, text[start : match.start()]
            yield False, match[0]
            start = match.end()
        yield True, text[start:]

    for line in text.splitlines(keepends=True):
        match = FENCE.match(line.rstrip("\r\n"))
        code = fence is not None or match is not None or line.startswith(("    ", "\t"))
        if code:
            if pending:
                yield from inline("".join(pending))
                pending = []
            yield False, line
            if fence:
                if (
                    match
                    and match[1][0] == fence[0]
                    and len(match[1]) >= len(fence)
                    and not match[2].strip()
                ):
                    fence = None
            elif match:
                fence = match[1]
        else:
            pending.append(line)
    if pending:
        yield from inline("".join(pending))


def unescaped(text):
    # An escaped backslash consumes its pair, so \\[1] remains a citation while
    # \[1] is literal. Preserve neither character of an escape in the scan.
    return re.sub(r"\\[^\n]", "  ", text)


def normalize_citations(answer):
    return "".join(
        NATIVE.sub(lambda m: f"[{m[1] or m[2]}]", part) if prose else part
        for prose, part in segments(answer)
    )


def references(answer):
    text = "\n".join(unescaped(part) for prose, part in segments(answer) if prose)
    return {int(n) for n in re.findall(r"\[(\d+)\]", text)}


def malformed_citations(answer):
    return any(
        any(c in unescaped(part) for c in "【】［］") for prose, part in segments(answer) if prose
    )
