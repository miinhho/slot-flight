from __future__ import annotations

import inspect
from collections.abc import Sequence
from typing import Any

from slot_flight._streams import close_stream, iterate_stream
from slot_flight.object import (
    SlotObjectOutput,
    SlotObjectStream,
    create_slot_object_stream,
)
from slot_flight.types import SlotFlightRequest


def stream_slot_object(
    *,
    client: Any,
    model: str,
    messages: Sequence[dict[str, Any]],
    output: SlotObjectOutput,
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

        if hasattr(client.messages, "stream"):
            texts = _stream_text_context(
                client.messages.stream(
                    model=model,
                    messages=request_messages,
                    **params,
                )
            )
            try:
                async for text in texts:
                    yield text
            finally:
                await close_stream(texts)
            return

        stream = client.messages.create(
            model=model,
            messages=request_messages,
            stream=True,
            **params,
        )
        if inspect.isawaitable(stream):
            stream = await stream

        events = _iterate(stream)
        try:
            async for event in events:
                text = _event_text(event)
                if text:
                    yield text
        finally:
            await close_stream(events)

    return create_slot_object_stream(output=output, generate=generate)


async def _stream_text_context(context: Any):
    if hasattr(context, "__aenter__"):
        async with context as stream:
            async for text in _iterate(stream.text_stream):
                if text:
                    yield text
        return

    with context as stream:
        for text in stream.text_stream:
            if text:
                yield text


async def _iterate(stream: Any):
    items = iterate_stream(
        stream,
        error_message="Anthropic stream must be iterable or async iterable.",
    )
    try:
        async for item in items:
            yield item
    finally:
        await close_stream(items)


def _event_text(event: Any) -> str:
    if _get(event, "type", None) != "content_block_delta":
        return ""
    delta = _get(event, "delta", None)
    text = _get(delta, "text", "")
    return text if isinstance(text, str) else ""


def _get(value: Any, key: str, default: Any) -> Any:
    if isinstance(value, dict):
        return value.get(key, default)
    return getattr(value, key, default)
