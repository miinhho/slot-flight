from __future__ import annotations

import inspect
import json
from collections.abc import Mapping, Sequence
from typing import Any

from slot_flight.object import (
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

    async with httpx.AsyncClient(timeout=None) as http_client:
        async for chunk in _stream_with_client(
            client=http_client,
            url=url,
            headers=headers,
            payload=payload,
        ):
            yield chunk


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
        raise_for_status = getattr(response, "raise_for_status", None)
        if callable(raise_for_status):
            result = raise_for_status()
            if inspect.isawaitable(result):
                await result

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

    return json.loads(line)


def _chunk_text(chunk: Any) -> str:
    choices = _get(chunk, "choices", [])
    if not choices:
        return ""
    delta = _get(choices[0], "delta", None)
    content = _get(delta, "content", "")
    return content if isinstance(content, str) else ""


def _get(value: Any, key: str, default: Any) -> Any:
    if isinstance(value, dict):
        return value.get(key, default)
    return getattr(value, key, default)
