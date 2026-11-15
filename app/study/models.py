"""Typed contracts for Master mode, including the lesson content contract (#23)."""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

CourseStatus = Literal["generating", "ready", "failed"]
ContentStatus = Literal["pending", "generating", "ready", "failed"]
LessonStatus = Literal["locked", "available", "in_progress", "completed"]
AttemptStatus = Literal["open", "submitted", "abandoned"]
Verdict = Literal["correct", "partial", "incorrect"]
BloomLevel = Literal["recall", "apply", "analyze"]

MAX_MODULES = 20
MAX_LESSONS = 120
QUIZ_QUESTIONS = 3
QUIZ_OPTIONS = 4
PASS_SCORE = 2


def _unique_nonblank(values: list[str], label: str) -> list[str]:
    cleaned = [value.strip() for value in values]
    if any(not value for value in cleaned):
        raise ValueError(f"{label} must not be blank")
    if len(set(cleaned)) != len(cleaned):
        raise ValueError(f"{label} must be unique")
    return cleaned


class CourseCreate(BaseModel):
    document_id: UUID


class PlannedLesson(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    objective: str = Field(default="", max_length=500)
    source_section_ids: list[str] = Field(min_length=1, max_length=50)
    estimated_minutes: int = Field(ge=1, le=60)

    @field_validator("source_section_ids")
    @classmethod
    def unique_sections(cls, value):
        return _unique_nonblank(value, "Section IDs")


class PlannedModule(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    summary: str = Field(default="", max_length=1000)
    lessons: list[PlannedLesson] = Field(min_length=1, max_length=MAX_LESSONS)

    @property
    def estimated_minutes(self) -> int:
        return sum(lesson.estimated_minutes for lesson in self.lessons)


class LessonPlan(BaseModel):
    """Validated planner output; storage writes it atomically."""

    modules: list[PlannedModule] = Field(min_length=1, max_length=MAX_MODULES)

    @model_validator(mode="after")
    def bounded(self):
        if self.lesson_count > MAX_LESSONS:
            raise ValueError(f"A course may hold at most {MAX_LESSONS} lessons")
        return self

    @property
    def lesson_count(self) -> int:
        return sum(len(module.lessons) for module in self.modules)

    @property
    def estimated_minutes(self) -> int:
        return sum(module.estimated_minutes for module in self.modules)


class QuizOption(BaseModel):
    id: str = Field(min_length=1, max_length=20)
    text: str = Field(min_length=1, max_length=300)


class QuizQuestion(BaseModel):
    id: str = Field(min_length=1, max_length=40)
    stem: str = Field(min_length=1, max_length=400)
    options: list[QuizOption] = Field(min_length=QUIZ_OPTIONS, max_length=QUIZ_OPTIONS)
    correct_option_id: str
    explanations: dict[str, str] = Field(default_factory=dict)
    citation: dict[str, Any] | None = None
    bloom_level: BloomLevel = "recall"

    @model_validator(mode="after")
    def consistent(self):
        ids = [option.id for option in self.options]
        if len(set(ids)) != len(ids):
            raise ValueError("Option IDs must be unique")
        if self.correct_option_id not in ids:
            raise ValueError("The correct option must be one of the options")
        wrong = set(ids) - {self.correct_option_id}
        if not wrong <= set(self.explanations):
            raise ValueError("Every wrong option needs an explanation")
        if not set(self.explanations) <= set(ids):
            raise ValueError("Explanations may only reference option IDs")
        if any(not text.strip() or len(text) > 600 for text in self.explanations.values()):
            raise ValueError("Explanations must be nonblank and at most 600 characters")
        return self

    def client_view(self) -> dict[str, Any]:
        """What a learner may see before submitting: never the key or explanations."""
        return {
            "id": self.id,
            "stem": self.stem,
            "options": [option.model_dump() for option in self.options],
            "bloom_level": self.bloom_level,
        }


class QuizSet(BaseModel):
    questions: list[QuizQuestion] = Field(min_length=QUIZ_QUESTIONS, max_length=QUIZ_QUESTIONS)

    @field_validator("questions")
    @classmethod
    def unique_questions(cls, value):
        _unique_nonblank([question.id for question in value], "Question IDs")
        return value


InsightKind = Literal["why_it_matters", "misconception", "trade_off"]
YourTurnKind = Literal["code_gap", "apply", "fill_blank"]
TODO_MARKER = "TODO(you)"


class _Content(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


class Diagram(_Content):
    kind: Literal["mermaid"] = "mermaid"
    source: str = Field(min_length=1, max_length=3000)
    caption: str = Field(default="", max_length=300)


class CodeTodo(_Content):
    marker: Literal["TODO(you)"] = TODO_MARKER
    instruction: str = Field(min_length=1, max_length=600)
    # Server-only: never serialized to a client (see LessonContent.client_view).
    reference_solution: str = Field(min_length=1, max_length=3000)


class CodeExample(_Content):
    language: str = Field(pattern=r"^[A-Za-z0-9+#._-]{1,20}$")
    code: str = Field(min_length=1, max_length=4000)
    explanation: str = Field(min_length=1, max_length=800)
    todo: CodeTodo | None = None

    @model_validator(mode="after")
    def marked(self):
        if self.todo is not None and TODO_MARKER not in self.code:
            raise ValueError(f"The code must contain the {TODO_MARKER} marker")
        return self


class Insight(_Content):
    kind: InsightKind
    text: str = Field(min_length=1, max_length=600)


class YourTurn(_Content):
    kind: YourTurnKind
    prompt: str = Field(min_length=1, max_length=800)
    # Server-only: used by the review in #25, never serialized to a client.
    reference_answer: str = Field(min_length=1, max_length=3000)


class KeyTerm(_Content):
    term: str = Field(min_length=1, max_length=80)
    definition: str = Field(min_length=1, max_length=300)


class LessonContent(_Content):
    """Stored lesson content. Word budgets are enforced by app.study.lesson_writer."""

    version: Literal[1] = 1
    objective: str = Field(min_length=1, max_length=400)
    explanation: str = Field(min_length=1, max_length=4000)
    real_world_example: str = Field(min_length=1, max_length=1500)
    diagram: Diagram | None = None
    code_example: CodeExample | None = None
    insights: list[Insight] = Field(min_length=1, max_length=2)
    your_turn: YourTurn
    key_terms: list[KeyTerm] = Field(default_factory=list, max_length=5)
    # Sources referenced by citation markers, in the chat citation shape.
    citations: list[dict[str, Any]] = Field(default_factory=list, max_length=40)
    coverage_note: str | None = Field(default=None, max_length=300)
    # Codes only (e.g. diagram_dropped); never model text.
    warnings: list[str] = Field(default_factory=list, max_length=10)

    @model_validator(mode="after")
    def code_gap_needs_code(self):
        if self.your_turn.kind == "code_gap" and (
            self.code_example is None or self.code_example.todo is None
        ):
            raise ValueError("A code_gap exercise needs a code example with a TODO(you) gap")
        return self

    def client_view(self) -> dict[str, Any]:
        """What a learner may see: never reference_solution or reference_answer."""
        view = self.model_dump(mode="json", exclude={"your_turn": {"reference_answer"}})
        todo = (view.get("code_example") or {}).get("todo")
        if todo is not None:
            todo.pop("reference_solution", None)
        return view


def client_content(content: dict[str, Any] | None) -> dict[str, Any] | None:
    """Strip server-only fields from stored content; unreadable content is withheld."""
    if not content:
        return None
    try:
        return LessonContent.model_validate(content).client_view()
    except ValueError:
        return None


class LessonProgressView(BaseModel):
    status: LessonStatus
    opened_at: datetime | None = None
    completed_at: datetime | None = None
    study_seconds: int = 0


class LessonView(BaseModel):
    id: UUID
    course_id: UUID
    module_id: UUID
    document_id: UUID
    position: int
    title: str
    objective: str
    source_section_ids: list[str]
    estimated_minutes: int
    content_status: ContentStatus
    content_generated_at: datetime | None = None
    content_failure_code: str | None = None
    content_generation: UUID | None = None
    regenerations_today: int = 0
    # Stored LessonContent including server-only fields: serialize via client_view only.
    content: dict[str, Any] | None = None
    progress: LessonProgressView

    def client_view(self, regeneration_limit: int, locked_content: bool = False) -> dict[str, Any]:
        """The GET /lessons/{id} body: no server-only fields, no job internals."""
        view = self.model_dump(mode="json", exclude={"content", "content_generation"})
        view["content"] = None if locked_content else client_content(self.content)
        view.pop("regenerations_today")
        view["regenerations_left"] = max(0, regeneration_limit - self.regenerations_today)
        return view


class LessonOutline(BaseModel):
    """A lesson row inside a plan listing; content is deliberately absent."""

    id: UUID
    module_id: UUID
    position: int
    title: str
    objective: str
    estimated_minutes: int
    content_status: ContentStatus
    status: LessonStatus


class ModuleView(BaseModel):
    id: UUID
    position: int
    title: str
    summary: str
    estimated_minutes: int
    lessons: list[LessonOutline]


class CourseSummary(BaseModel):
    id: UUID
    document_id: UUID
    title: str
    status: CourseStatus
    failure_code: str | None = None
    estimated_minutes: int
    module_count: int
    lesson_count: int
    completed_lessons: int
    created_at: datetime
    updated_at: datetime


class CourseView(CourseSummary):
    generation: UUID | None = None
    modules: list[ModuleView]


class QuizAttemptSummary(BaseModel):
    id: UUID
    lesson_id: UUID
    attempt_number: int
    status: AttemptStatus
    score: int | None = None
    passed: bool | None = None
    created_at: datetime
    submitted_at: datetime | None = None
