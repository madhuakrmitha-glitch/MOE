import asyncio
import json
from urllib.parse import urlsplit

import httpx


class ProviderError(Exception):
    """A safe error message that contains no upstream body or credentials."""


def validate_endpoint(url: str, settings):
    parsed = urlsplit(url)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError(
            "Use an HTTP(S) base URL without credentials, query, or fragment"
        )
    if parsed.hostname.lower() not in settings.provider_hosts:
        raise ValueError(
            "Endpoint host is not in the server's MOE_PROVIDER_HOSTS allowlist"
        )
    if parsed.scheme == "http" and parsed.hostname.lower() not in settings.http_hosts:
        raise ValueError("HTTPS is required for this endpoint")
    return url.rstrip("/")


def endpoint(base: str, kind: str):
    base = base.rstrip("/")
    if kind == "ollama":
        if base.endswith("/api/chat"):
            return base
        return base + ("/chat" if base.endswith("/api") else "/api/chat")
    if base.endswith("/chat/completions"):
        return base
    if kind == "huggingface" and not urlsplit(base).path.strip("/"):
        base += "/v1"
    return base + "/chat/completions"


def payload(connection, agent, messages, streaming):
    data = {"model": agent["model"], "messages": messages, "stream": streaming}
    if connection.kind == "ollama":
        data["options"] = {
            "num_predict": agent["max_tokens"],
            "temperature": agent["temperature"],
        }
    else:
        data[connection.token_parameter] = agent["max_tokens"]
        if streaming and getattr(connection, "include_usage", False):
            data["stream_options"] = {"include_usage": True}
        if connection.supports_temperature:
            data["temperature"] = agent["temperature"]
    return data


def parse_chunk(data, kind):
    if data.get("error"):
        raise ProviderError("Provider reported an error during generation")
    if kind == "ollama":
        return {
            "text": data.get("message", {}).get("content", ""),
            "input_tokens": data.get("prompt_eval_count"),
            "output_tokens": data.get("eval_count"),
            "done": bool(data.get("done")),
        }
    choice = (data.get("choices") or [{}])[0]
    content = choice.get("delta", choice.get("message", {})).get("content") or ""
    if isinstance(content, list):
        content = "".join(part.get("text", "") for part in content)
    usage = data.get("usage") or {}
    return {
        "text": content,
        "input_tokens": usage.get("prompt_tokens"),
        "output_tokens": usage.get("completion_tokens"),
        "done": choice.get("finish_reason") is not None,
    }


async def generate(connection, agent, messages, key, settings):
    """Retry only before text is emitted; never silently replay a partial completion."""
    validate_endpoint(connection.base_url, settings)
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    data = payload(connection, agent, messages, connection.stream_enabled)
    timeout = httpx.Timeout(settings.request_timeout, connect=10)
    emitted = False
    async with httpx.AsyncClient(
        timeout=timeout, follow_redirects=False, trust_env=False
    ) as client:
        for attempt in range(3):
            try:
                async with client.stream(
                    "POST",
                    endpoint(connection.base_url, connection.kind),
                    json=data,
                    headers=headers,
                ) as response:
                    if response.status_code in {429, 502, 503, 504} and attempt < 2:
                        await asyncio.sleep(min(2**attempt, 4))
                        continue
                    if response.status_code >= 300:
                        raise ProviderError(
                            f"Provider returned HTTP {response.status_code}. Check credentials, model, endpoint and quota."
                        )
                    if not connection.stream_enabled:
                        raw = await response.aread()
                        if len(raw) > 2_000_000:
                            raise ProviderError(
                                "Provider response exceeded the allowed size"
                            )
                        chunk = parse_chunk(json.loads(raw), connection.kind)
                        chunk["done"] = True
                        yield chunk
                        return
                    completed = False
                    size = 0
                    async for line in response.aiter_lines():
                        if not line or line.startswith(":"):
                            continue
                        if connection.kind != "ollama":
                            if not line.startswith("data:"):
                                continue
                            line = line[5:].strip()
                            if line == "[DONE]":
                                completed = True
                                break
                        chunk = parse_chunk(json.loads(line), connection.kind)
                        size += len(chunk["text"])
                        if size > 1_000_000:
                            raise ProviderError(
                                "Provider response exceeded the allowed size"
                            )
                        emitted = emitted or bool(chunk["text"])
                        completed = completed or chunk["done"]
                        yield chunk
                    if not completed:
                        raise ProviderError(
                            "Provider stream ended before completion; partial text was preserved"
                        )
                    return
            except (httpx.TimeoutException, httpx.NetworkError):
                if emitted or attempt == 2:
                    raise ProviderError(
                        "Provider connection timed out or failed; check server access to the endpoint"
                    ) from None
                await asyncio.sleep(2**attempt)
            except (json.JSONDecodeError, TypeError, KeyError):
                raise ProviderError(
                    "Provider returned an unsupported response format"
                ) from None
