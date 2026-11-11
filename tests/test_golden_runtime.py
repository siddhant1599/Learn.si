import json

import pytest
from fastapi.testclient import TestClient

from app import api, runtime
from app.config import Settings


def config(**patch):
    return Settings(_env_file=None, database_url="", openrouter_api_key="private-model-key",
                    tavily_key="private-search-key", pinecone_key="private-vector-key", **patch)


def test_runtime_is_nonsecret_and_configured_model_is_explicit():
    first, second = (runtime.capture_runtime(config()) for _ in range(2))
    assert first.instance_id != second.instance_id
    assert first.source_sha256 == second.source_sha256
    assert first.config.chat_model == "openrouter/free"
    assert first.config.web_available
    serialized = first.model_dump_json()
    assert "private-" not in serialized
    assert "database_url" not in serialized
    assert "pinecone_key" not in serialized
    assert runtime.runtime_current(first, config())
    assert not runtime.runtime_current(first, config(chat_call_limit=3))


def test_fingerprint_includes_source_and_dependency_lock(tmp_path):
    (tmp_path / "app").mkdir()
    for filename in ("app/example.py", "server.py", "pyproject.toml", "uv.lock"):
        (tmp_path / filename).write_text("initial")
    previous = runtime.source_fingerprint(tmp_path)
    (tmp_path / "uv.lock").write_text("updated dependency")
    assert runtime.source_fingerprint(tmp_path) != previous
    previous = runtime.source_fingerprint(tmp_path)
    (tmp_path / ".env").write_text("PRIVATE=never hash private files")
    assert runtime.source_fingerprint(tmp_path) == previous


def test_runtime_endpoint_and_stale_build(monkeypatch):
    monkeypatch.setattr(api, "settings", config)
    with TestClient(api.app) as client:
        response = client.get("/evaluation/runtime")
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        assert "private-" not in response.text
        assert json.loads(response.text)["source_sha256"] == runtime.LOADED_SOURCE_SHA256
        monkeypatch.setattr(runtime, "source_fingerprint", lambda: "f" * 64)
        assert client.get("/evaluation/runtime").status_code == 409
        # A stale evaluation build does not change the app's liveness contract.
        assert client.get("/health").status_code == 200


@pytest.mark.parametrize("patch", [{"embedding_call_limit": 0}, {"secret": "never copy me"}])
def test_invalid_or_unknown_runtime_fields_are_rejected(patch):
    snapshot = runtime.public_config(config()).model_dump() | patch
    with pytest.raises(ValueError):
        runtime.RuntimeConfig.model_validate(snapshot)
