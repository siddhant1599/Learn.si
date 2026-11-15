"""Typed contracts for Master mode. Lesson content itself is finalized in #23."""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

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
    # Shape finalized in #23; server-only fields are stripped by the API layer.
    content: dict[str, Any] | None = None
    progress: LessonProgressView


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
