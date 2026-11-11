"""Nonsecret startup provenance for local evaluation, separate from liveness."""
import hashlib
import json
import platform
import subprocess
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field

ROOT = Path(__file__).resolve().parent.parent


def source_fingerprint(root=ROOT):
    files = sorted([*root.joinpath("app").rglob("*.py"),
                    *(root / name for name in ("server.py", "pyproject.toml", "uv.lock"))])
    return hashlib.sha256(b"".join(
        str(p.relative_to(root)).encode() + b"\0" + p.read_bytes() for p in files)).hexdigest()


# Captured when the API imports this module, not when an evaluator asks for it.
LOADED_SOURCE_SHA256 = source_fingerprint()


class RuntimeConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    chat_model: str = Field(min_length=1, max_length=200)
    embedding: str = Field(min_length=1, max_length=300)
    vector_backend: Literal["pgvector", "pinecone"]
    retrieval_scope_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    web_domains_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    web_available: bool
    hyde_enabled: bool
    max_sub_questions: int = Field(ge=1, le=4)
    research_concurrency: int = Field(ge=1, le=4)
    research_service_concurrency: int = Field(ge=1, le=8)
    history_exchanges: int = Field(ge=0, le=4)
    history_max_chars: int = Field(ge=0, le=12000)
    chat_call_limit: int = Field(ge=1, le=12)
    embedding_call_limit: int = Field(ge=1, le=24)
    web_call_limit: Literal[2] = 2
    request_timeout_seconds: int = Field(ge=1, le=240)


class RuntimeManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal[1] = 1
    instance_id: UUID
    source_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    code_commit: str | None = Field(default=None, pattern=r"^[a-f0-9]{40,64}$")
    working_tree_dirty: bool | None = None
    python_version: str = Field(pattern=r"^\d+\.\d+\.\d+$")
    config: RuntimeConfig


def public_config(config):
    def digest(value):
        return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()
    return RuntimeConfig(
        chat_model=config.openrouter_model, embedding=config.embedding_signature,
        vector_backend=config.vector_backend,
        retrieval_scope_sha256=digest([config.pinecone_index, config.pinecone_namespace]),
        web_domains_sha256=digest(sorted(config.tavily_include_domains)),
        web_available=bool(config.tavily_key.get_secret_value()),
        **{key: getattr(config, key) for key in (
            "hyde_enabled", "max_sub_questions", "research_concurrency",
            "research_service_concurrency", "history_exchanges", "history_max_chars",
            "chat_call_limit", "embedding_call_limit", "request_timeout_seconds")},
    )


def capture_runtime(config):
    try:
        revision = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, stderr=subprocess.DEVNULL).strip()
        dirty = bool(subprocess.check_output(
            ["git", "status", "--porcelain"], cwd=ROOT, stderr=subprocess.DEVNULL))
    except (OSError, subprocess.CalledProcessError):
        revision, dirty = None, None
    return RuntimeManifest(instance_id=uuid4(), source_sha256=LOADED_SOURCE_SHA256,
                           code_commit=revision, working_tree_dirty=dirty,
                           python_version=platform.python_version(),
                           config=public_config(config))


def runtime_current(manifest, config):
    return (manifest.source_sha256 == source_fingerprint()
            and manifest.config == public_config(config))
