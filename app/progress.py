"""Request-local, allowlisted activity events; never prompts or evidence text."""

import asyncio
import re
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Literal

from langgraph.config import get_stream_writer
from pydantic import BaseModel, ConfigDict, Field

STAGES = {
    "triage",
    "conversational",
    "plan",
    "hyde",
    "retrieve",
    "assess",
    "refine",
    "web",
    "answer",
    "error_handler",
}
OUTCOMES = {
    "sufficient",
    "partial",
    "none",
    "assessment_error",
    "retrieved",
    "empty",
    "blocked",
    "unavailable",
    "budget",
    "greeting",
    "clarify",
    "direct_retrieval",
    "complex_research",
    "retry",
    "fallback",
    "search",
    "checking",
    "hints",
}


class ProgressEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["progress"] = "progress"
    version: Literal[1] = 1
    step: str
    id: str
    status: Literal["started", "completed", "failed", "stopped"]
    attempt: int = Field(ge=0)
    sequence: int = Field(ge=1)
    task: str | None = None
    parent: str | None = None
    outcome: str | None = None
    count: int | None = Field(default=None, ge=0, le=1000)


@dataclass
class Emitter:
    stage: str
    attempt: int
    writer: object
    sequence: int = 0
    active: set[str] = field(default_factory=set)

    def send(self, status, task=None, outcome=None, count=None):
        if task is not None and not re.fullmatch(r"(?:q[1-4]|wq[12]|check-wq[12])", task):
            return
        self.sequence += 1
        id = self.stage + (":" + task if task else "")
        if status == "started":
            self.active.add(id)
        else:
            self.active.discard(id)
        event = ProgressEvent(
            step=self.stage,
            id=id,
            status=status,
            attempt=self.attempt,
            sequence=self.sequence,
            task=task,
            parent=self.stage if task else None,
            outcome=outcome if outcome in OUTCOMES else None,
            count=count if isinstance(count, int) and 0 <= count <= 1000 else None,
        )
        self.writer(event.model_dump(exclude_none=True))


current: ContextVar[Emitter | None] = ContextVar("activity", default=None)


def progress(status, task=None, outcome=None, count=None):
    emitter = current.get()
    if emitter:
        emitter.send(status, task, outcome, count)


@dataclass(frozen=True)
class TrackedAgent:
    stage: str
    agent: object

    async def __call__(self, state):
        try:
            writer = get_stream_writer()
        except RuntimeError:

            def writer(_):
                return None

        emitter = Emitter(
            self.stage,
            state.get("recovery_attempts", 0) * 4 + state.get("refinement_attempts", 0),
            writer,
        )
        token = current.set(emitter)
        progress("started")
        try:
            if self.stage == "assess":
                for item in state.get("research_plan", []):
                    progress("started", item["id"])
            if self.stage == "refine" and state.get("refinement_target"):
                progress("started", state["refinement_target"])
            if self.stage == "web":
                for item in state.get("assessments", []):
                    if item["status"] in {"partial", "none"}:
                        progress("completed", item["sub_question_id"], item["status"])
            patch = await self.agent(state)
            if self.stage == "assess":
                for item in patch.get("assessments", []):
                    progress(
                        "failed" if item["status"] == "assessment_error" else "completed",
                        item["sub_question_id"],
                        item["status"],
                        len(item["evidence_ids"]),
                    )
            if (
                self.stage == "refine"
                and state.get("refinement_target")
                and not patch.get("failure")
            ):
                result = next(
                    (
                        r
                        for r in patch.get("research_results", [])
                        if r["sub_question_id"] == state["refinement_target"]
                    ),
                    {},
                )
                progress(
                    "completed",
                    state["refinement_target"],
                    "retrieved",
                    len(result.get("hits", [])),
                )
            outcome = patch.get("route")
            count = None
            if self.stage == "plan":
                count = patch.get("plan_size")
                outcome = "fallback" if patch.get("plan_fallback") else None
            if self.stage == "hyde":
                count = len(patch.get("hyde_passages", {}))
            if self.stage == "web":
                results = patch.get("web_results", [])
                count = sum(len(r.get("hits", [])) for r in results)
                outcome = "unavailable" if not results else "retrieved" if count else "empty"
            if self.stage == "error_handler":
                outcome = (
                    "retry" if patch.get("recovery_target") not in {None, "end"} else "unavailable"
                )
            failed = bool(patch.get("failure")) or patch.get("status") in {"failed", "recovering"}
            for id in list(emitter.active):
                if ":" in id:
                    progress("failed" if failed else "stopped", id.split(":", 1)[1])
            progress("failed" if failed else "completed", outcome=outcome, count=count)
            return patch
        except BaseException as exc:
            status = "stopped" if isinstance(exc, asyncio.CancelledError) else "failed"
            for id in list(emitter.active):
                progress(status, id.split(":", 1)[1] if ":" in id else None)
            raise
        finally:
            current.reset(token)
