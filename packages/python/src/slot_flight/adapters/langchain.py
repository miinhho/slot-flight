from __future__ import annotations

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
    runnable: Any,
    messages: Sequence[Any],
    output: SlotObjectOutput,
    **params: Any,
) -> SlotObjectStream:
    async def generate(request: SlotFlightRequest):
        request_messages = [*messages, ("human", request.prompt)]

        if hasattr(runnable, "astream"):
            stream = runnable.astream(request_messages, **params)
            chunks = iterate_stream(
                stream,
                error_message="LangChain stream must be iterable or async iterable.",
            )
            try:
                async for chunk in chunks:
                    text = _chunk_text(chunk)
                    if text:
                        yield text
            finally:
                await close_stream(chunks)
            return

        if hasattr(runnable, "stream"):
            stream = runnable.stream(request_messages, **params)
            chunks = iterate_stream(
                stream,
                error_message="LangChain stream must be iterable or async iterable.",
            )
            try:
                async for chunk in chunks:
                    text = _chunk_text(chunk)
                    if text:
                        yield text
            finally:
                await close_stream(chunks)
            return

        raise TypeError("LangChain runnable must expose stream() or astream().")

    return create_slot_object_stream(output=output, generate=generate)


def _chunk_text(chunk: Any) -> str:
    if isinstance(chunk, str):
        return chunk

    content = getattr(chunk, "content", None)
    text = _content_text(content)
    if text:
        return text

    if isinstance(chunk, dict):
        return _content_text(chunk.get("content", ""))
    return ""


def _content_text(content: Any) -> str:
    if isinstance(content, str):
        return content

    if isinstance(content, list):
        return "".join(_content_part_text(part) for part in content)

    return ""


def _content_part_text(part: Any) -> str:
    if isinstance(part, str):
        return part

    if isinstance(part, dict):
        text = part.get("text", "")
        return text if isinstance(text, str) else ""

    text = getattr(part, "text", "")
    return text if isinstance(text, str) else ""
