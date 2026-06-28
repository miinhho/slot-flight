from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from slot_flight.object import (
    SlotObjectOutput,
    SlotObjectStream,
    create_slot_object_stream,
)
from slot_flight.types import SlotFlightRequest


def stream_slot_object(
    *,
    runnable: Any,
    messages: Sequence[Any],
    output: SlotObjectOutput,
    **params: Any,
) -> SlotObjectStream:
    async def generate(request: SlotFlightRequest):
        request_messages = [*messages, ("human", request.prompt)]

        if hasattr(runnable, "astream"):
            async for chunk in runnable.astream(request_messages, **params):
                text = _chunk_text(chunk)
                if text:
                    yield text
            return

        if hasattr(runnable, "stream"):
            for chunk in runnable.stream(request_messages, **params):
                text = _chunk_text(chunk)
                if text:
                    yield text
            return

        raise TypeError("LangChain runnable must expose stream() or astream().")

    return create_slot_object_stream(output=output, generate=generate)


def _chunk_text(chunk: Any) -> str:
    if isinstance(chunk, str):
        return chunk

    content = getattr(chunk, "content", None)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            part.get("text", "")
            for part in content
            if isinstance(part, dict) and isinstance(part.get("text"), str)
        )
    if isinstance(chunk, dict):
        value = chunk.get("content", "")
        return value if isinstance(value, str) else ""
    return ""
