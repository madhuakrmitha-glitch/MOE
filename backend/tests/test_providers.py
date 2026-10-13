import json
from types import SimpleNamespace

import httpx
import pytest

from moe.config import Settings
from moe.providers import client as adapters


def connection(kind="openai", stream=True):
    return SimpleNamespace(
        kind=kind,
        base_url="https://api.openai.com/v1",
        stream_enabled=stream,
        token_parameter="max_tokens",
        supports_temperature=True,
    )


@pytest.mark.asyncio
async def test_openai_stream_and_safe_error(monkeypatch):
    captured = []

    async def handle(request):
        captured.append(json.loads(request.content))
        return httpx.Response(
            200,
            text='data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        )

    original = httpx.AsyncClient
    monkeypatch.setattr(
        adapters.httpx,
        "AsyncClient",
        lambda **kw: original(transport=httpx.MockTransport(handle), **kw),
    )
    chunks = [
        chunk
        async for chunk in adapters.generate(
            connection(),
            {"model": "model", "max_tokens": 32, "temperature": 0.5},
            [],
            "secret",
            Settings(),
        )
    ]
    assert "".join(chunk["text"] for chunk in chunks) == "Hello"
    assert captured[0]["max_tokens"] == 32


@pytest.mark.asyncio
async def test_ollama_nonstream_and_truncated_stream(monkeypatch):
    original = httpx.AsyncClient

    async def handle(request):
        return httpx.Response(
            200,
            json={
                "message": {"content": "Local response"},
                "done": True,
                "eval_count": 7,
            },
        )

    monkeypatch.setattr(
        adapters.httpx,
        "AsyncClient",
        lambda **kw: original(transport=httpx.MockTransport(handle), **kw),
    )
    chunks = [
        chunk
        async for chunk in adapters.generate(
            connection("ollama", False),
            {"model": "model", "max_tokens": 32, "temperature": 0.5},
            [],
            "",
            Settings(),
        )
    ]
    assert chunks[0]["text"] == "Local response" and chunks[0]["output_tokens"] == 7


@pytest.mark.asyncio
async def test_error_body_never_leaks_credentials(monkeypatch):
    original = httpx.AsyncClient

    async def handle(request):
        return httpx.Response(401, json={"error": "secret-key-in-upstream-body"})

    monkeypatch.setattr(
        adapters.httpx,
        "AsyncClient",
        lambda **kw: original(transport=httpx.MockTransport(handle), **kw),
    )
    with pytest.raises(adapters.ProviderError) as error:
        async for _ in adapters.generate(
            connection(),
            {"model": "model", "max_tokens": 32, "temperature": 0.5},
            [],
            "key",
            Settings(),
        ):
            pass
    assert "secret-key" not in str(error.value) and "401" in str(error.value)


def test_urls_are_exact_and_host_policy_enforced():
    settings = Settings()
    assert adapters.endpoint(
        "https://example.endpoints.huggingface.cloud", "huggingface"
    ).endswith("/v1/chat/completions")
    assert adapters.endpoint("http://localhost:11434", "ollama").endswith("/api/chat")
    for url in [
        "https://user:password@api.openai.com/v1",
        "https://evil.example/v1",
        "http://api.openai.com/v1",
    ]:
        with pytest.raises(ValueError):
            adapters.validate_endpoint(url, settings)
