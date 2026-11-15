"""Bounded local-file extraction for the test interface; original files are not saved."""

import re
from io import BytesIO
from pathlib import PurePosixPath
from uuid import uuid4

from pypdf import PdfReader

from app.models import Document, Section
from scripts.ingest import chunks

MAX_BYTES = 10 * 1024 * 1024
MAX_CHARACTERS = 1_000_000
MAX_CHUNKS = 600
HEADING = re.compile(r"^(#{1,6})\s+(\S.*)$")


def markdown_sections(name: str, text: str) -> list[Section] | None:
    """Split text with two or more Markdown headings into real, hierarchical sections.

    Section IDs are stable heading numbers ("1", "1.2") so lesson plans and
    retrieval reference the same units. Returns None for text without structure.
    """
    lines = text.splitlines()
    headings = [
        (index, len(match.group(1)), match.group(2).strip())
        for index, line in enumerate(lines)
        if (match := HEADING.match(line))
    ]
    if len(headings) < 2:
        return None
    sections: list[Section] = []
    preamble = "\n".join(lines[: headings[0][0]]).strip()
    if preamble:
        sections.append(Section(id="0", number="0", title=name, text=preamble))
    stack: list[tuple[int, str]] = []
    for position, (line, level, title) in enumerate(headings):
        end = headings[position + 1][0] if position + 1 < len(headings) else len(lines)
        body = "\n".join(lines[line + 1 : end]).strip()
        while stack and stack[-1][0] >= level:
            stack.pop()
        parent = stack[-1][1] if stack else None
        siblings = sum(1 for s in sections if s.parent_id == parent and s.id != "0")
        number = f"{parent}.{siblings + 1}" if parent else str(siblings + 1)
        sections.append(
            Section(
                id=number,
                number=number,
                title=title[:1000],
                parent_id=parent,
                kind="chapter" if parent is None else "section",
                text=body or title,
            )
        )
        stack.append((level, number))
    return sections


def extract_document(filename: str, data: bytes) -> Document:
    name = PurePosixPath(filename.replace("\\", "/")).name
    suffix = PurePosixPath(name).suffix.lower()
    if suffix not in {".pdf", ".txt", ".md"}:
        raise ValueError("Choose a PDF, TXT, or Markdown file.")
    if not data or len(data) > MAX_BYTES:
        raise ValueError("Choose a nonempty file no larger than 10 MB.")
    sections = []
    total = 0

    def add(text, page=None):
        nonlocal total
        text = text.replace("\x00", "").strip()
        total += len(text)
        if total > MAX_CHARACTERS:
            raise ValueError(
                "Document exceeds 1,000,000 extracted characters. Upload a smaller part."
            )
        if text:
            number = str(page or 1)
            sections.append(
                Section(
                    id=number,
                    number=number,
                    title=f"Page {page}" if page else name,
                    text=text,
                    page=page,
                )
            )

    if suffix == ".pdf":
        try:
            reader = PdfReader(BytesIO(data))
            if reader.is_encrypted:
                raise ValueError(
                    "Password-protected PDFs are not supported. Upload an unlocked copy."
                )
            if len(reader.pages) > 100:
                raise ValueError("PDF exceeds 100 pages. Upload a smaller part.")
            for number, page in enumerate(reader.pages, 1):
                add(page.extract_text() or "", number)
        except ValueError:
            raise
        except Exception:
            raise ValueError("Could not read this PDF. Upload a valid text-based PDF.") from None
    else:
        try:
            text = data.decode("utf-8-sig").replace("\x00", "")
        except UnicodeDecodeError:
            raise ValueError("Text files must use UTF-8 encoding.") from None
        if len(text) > MAX_CHARACTERS:
            raise ValueError(
                "Document exceeds 1,000,000 extracted characters. Upload a smaller part."
            )
        structured = markdown_sections(name, text)
        if structured:
            sections.extend(structured)
        else:
            add(text)
    if not sections:
        raise ValueError("No readable text found. Scanned PDFs need OCR before uploading.")
    if sum(sum(1 for _ in chunks(s.text)) for s in sections) > MAX_CHUNKS:
        raise ValueError("Document exceeds 600 text chunks. Upload a smaller part.")
    return Document(id=uuid4(), title=name, edition="Uploaded", sections=sections)
