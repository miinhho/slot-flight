from __future__ import annotations

import inspect
import json
from collections.abc import Mapping, Sequence
from json import JSONDecodeError
from typing import Any

from slot_flight.slot.object import (
    SlotObjectOutput,
    SlotObjectStream,
    create_slot_object_stream,
)
from slot_flight.types import SlotFlightRequest


def stream_slot_object(
    *,
    base_url: str,
    model: str,
    messages: Sequence[dict[str, Any]],
    output: SlotObjectOutput,
    api_key: str | None = None,
    client: Any | None = None,
    headers: Mapping[str, str] | None = None,
    path: str = "/chat/completions",
    timeout: Any = 60.0,
    **params: Any,
) -> SlotObjectStream:
    async def generate(request: SlotFlightRequest):
        request_messages = [
            *messages,
            {
                "role": "user",
                "content": request.prompt,
            },
        ]
        payload = {
            "model": model,
            "messages": request_messages,
            "stream": True,
            **params,
        }

        chunks = _stream_chat_completion_chunks(
            client=client,
            url=_join_url(base_url, path),
            headers=_request_headers(api_key=api_key, headers=headers),
            payload=payload,
            timeout=timeout,
        )
        async for chunk in chunks:
            text = _chunk_text(chunk)
            if text:
                yield text

    return create_slot_object_stream(output=output, generate=generate)


async def _stream_chat_completion_chunks(
    *,
    client: Any | None,
    url: str,
    headers: dict[str, str],
    payload: dict[str, Any],
    timeout: Any,
):
    if client is not None:
        async for chunk in _stream_with_client(
            client=client,
            url=url,
            headers=headers,
            payload=payload,
        ):
            yield chunk
        return

    try:
        import httpx
    except ImportError as error:
        raise RuntimeError(
            "Install slot-flight with the openai-compatible extra to use "
            "the raw OpenAI-compatible adapter."
        ) from error

    async with httpx.AsyncClient(
        timeout=_normalize_timeout(httpx, timeout)
    ) as http_client:
        async for chunk in _stream_with_client(
            client=http_client,
            url=url,
            headers=headers,
            payload=payload,
        ):
            yield chunk


def _normalize_timeout(httpx: Any, timeout: Any) -> Any:
    if timeout is None or isinstance(timeout, httpx.Timeout):
        return timeout
    if isinstance(timeout, int | float):
        return httpx.Timeout(float(timeout), connect=min(10.0, float(timeout)))
    return timeout


async def _stream_with_client(
    *,
    client: Any,
    url: str,
    headers: dict[str, str],
    payload: dict[str, Any],
):
    context = client.stream("POST", url, headers=headers, json=payload)
    if inspect.isawaitable(context):
        context = await context

    async with context as response:
        await _raise_for_http_error(response)

        async for line in response.aiter_lines():
            chunk = _parse_sse_line(line)
            if chunk is _DONE:
                return
            if chunk is not None:
                yield chunk


def _request_headers(
    *,
    api_key: str | None,
    headers: Mapping[str, str] | None,
) -> dict[str, str]:
    request_headers = {"Accept": "text/event-stream"}
    if api_key:
        request_headers["Authorization"] = f"Bearer {api_key}"
    if headers:
        request_headers.update(headers)
    return request_headers


def _join_url(base_url: str, path: str) -> str:
    return f"{base_url.rstrip('/')}/{path.lstrip('/')}"


_DONE = object()


def _parse_sse_line(line: str) -> dict[str, Any] | object | None:
    line = line.strip()
    if not line or line.startswith(":"):
        return None

    if line.startswith("data:"):
        line = line.removeprefix("data:").strip()

    if line == "[DONE]":
        return _DONE

    try:
        chunk = json.loads(line)
    except JSONDecodeError as error:
        raise ValueError(
            "OpenAI-compatible stream returned a malformed JSON SSE data line."
        ) from error

    if not isinstance(chunk, dict):
        raise ValueError(
            "OpenAI-compatible stream returned a JSON SSE data line that is not "
            "an object."
        )
    return chunk


def _chunk_text(chunk: Any) -> str:
    choices = _get(chunk, "choices", [])
    if not choices:
        return ""
    choice = choices[0]
    delta = _get(choice, "delta", None)
    content = _get(delta, "content", "")
    if text := _content_text(content):
        return text

    message = _get(choice, "message", None)
    content = _get(message, "content", "")
    if text := _content_text(content):
        return text

    text = _get(choice, "text", "")
    return text if isinstance(text, str) else ""


async def _raise_for_http_error(response: Any) -> None:
    status_code = _get(response, "status_code", None)
    if isinstance(status_code, int) and status_code >= 400:
        body = await _response_text(response)
        detail = f": {_truncate(body)}" if body else ""
        raise RuntimeError(
            f"OpenAI-compatible request failed with HTTP {status_code}{detail}"
        )

    raise_for_status = getattr(response, "raise_for_status", None)
    if not callable(raise_for_status):
        return

    try:
        result = raise_for_status()
        if inspect.isawaitable(result):
            await result
    except Exception as error:
        raise RuntimeError(f"OpenAI-compatible request failed: {error}") from error


async def _response_text(response: Any) -> str:
    aread = getattr(response, "aread", None)
    if callable(aread):
        content = aread()
        if inspect.isawaitable(content):
            content = await content
        if isinstance(content, bytes):
            return content.decode("utf-8", errors="replace")
        if isinstance(content, str):
            return content

    text = getattr(response, "text", "")
    if isinstance(text, str):
        return text
    return ""


def _content_text(content: Any) -> str:
    if isinstance(content, str):
        return content

    if not isinstance(content, list):
        return ""

    parts: list[str] = []
    for part in content:
        if isinstance(part, str):
            parts.append(part)
            continue
        text = _get(part, "text", "")
        if isinstance(text, str):
            parts.append(text)
    return "".join(parts)


def _truncate(value: str, limit: int = 500) -> str:
    if len(value) <= limit:
        return value
    return value[: limit - 3] + "..."


def _get(value: Any, key: str, default: Any) -> Any:
    if isinstance(value, dict):
        return value.get(key, default)
    return getattr(value, key, default)
