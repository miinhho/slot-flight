from __future__ import annotations

import inspect
from collections.abc import Sequence
from typing import Any

from slot_flight._streams import close_stream, iterate_stream
from slot_flight.slot.object import (
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
        stream = client.chat.completions.create(
            model=model,
            messages=request_messages,
            stream=True,
            **params,
        )
        if inspect.isawaitable(stream):
            stream = await stream

        chunks = iterate_stream(
            stream,
            error_message="OpenAI stream must be iterable or async iterable.",
        )
        try:
            async for chunk in chunks:
                text = _chunk_text(chunk)
                if text:
                    yield text
        finally:
            await close_stream(chunks)

    return create_slot_object_stream(output=output, generate=generate)


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
