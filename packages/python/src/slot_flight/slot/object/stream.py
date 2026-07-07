from __future__ import annotations

from collections.abc import AsyncIterable, Callable
from typing import Any, cast

from ..._streams import close_stream
from .projections import completed_slot_iterator, partial_object_iterator
from .web import (
    SlotObjectStreamSource,
    format_payload,
    stream_payloads,
)

SlotObjectEventSource = Callable[[], AsyncIterable[dict[str, Any]]]
_FINAL_OBJECT_UNSET = object()


class SlotObjectStream:
    def __init__(self, create_events: SlotObjectEventSource):
        self._create_events = create_events
        self._final_object: Any = _FINAL_OBJECT_UNSET
        self._final_error: Exception | None = None
        self._consumed_by: str | None = None

    async def events(self):
        events = self._consume_run("events")
        try:
            async for event in events:
                yield event
        finally:
            await close_stream(events)

    async def slot_event_stream(self):
        events = self.events()
        try:
            async for event in events:
                yield event
        finally:
            await close_stream(events)

    async def completed_slots(self):
        events = self._consume_run("completed_slot_stream")
        try:
            async for slot in completed_slot_iterator(events):
                yield slot
        finally:
            await close_stream(events)

    async def completed_slot_stream(self):
        slots = self.completed_slots()
        try:
            async for slot in slots:
                yield slot
        finally:
            await close_stream(slots)

    async def partial_objects(self):
        events = self._consume_run("partial_object_stream")
        try:
            async for partial in partial_object_iterator(events):
                yield partial
        finally:
            await close_stream(events)

    async def partial_object_stream(self):
        partials = self.partial_objects()
        try:
            async for partial in partials:
                yield partial
        finally:
            await close_stream(partials)

    async def final_object(self):
        if self._final_object is not _FINAL_OBJECT_UNSET:
            return self._final_object
        if self._final_error is not None:
            raise self._final_error

        async for _event in self._consume_run("final_object"):
            pass
        if self._final_object is not _FINAL_OBJECT_UNSET:
            return self._final_object
        if self._final_error is not None:
            raise self._final_error
        raise RuntimeError("Slot object stream ended without a final object.")

    async def to_sse(self, *, source: SlotObjectStreamSource = "completed"):
        async for payload in stream_payloads(self._consume_run("to_sse"), source):
            yield format_payload(payload, "sse")

    async def to_ndjson(self, *, source: SlotObjectStreamSource = "completed"):
        async for payload in stream_payloads(self._consume_run("to_ndjson"), source):
            yield format_payload(payload, "ndjson")

    async def _consume_run(self, consumer: str):
        self._claim(consumer)

        events = self._create_events()
        try:
            async for event in events:
                if event["type"] == "done":
                    self._final_object = event["state"]
                yield event
            if self._final_object is _FINAL_OBJECT_UNSET:
                raise RuntimeError(
                    "Slot object stream source completed without a done event."
                )
        except Exception as error:
            self._final_error = error
            raise
        finally:
            await close_stream(events)
            if (
                self._final_object is _FINAL_OBJECT_UNSET
                and self._final_error is None
            ):
                self._final_error = RuntimeError(
                    "Slot object stream cancelled before a final object."
                )

    def _claim(self, consumer: str):
        if self._consumed_by is None:
            self._consumed_by = consumer
            return

        raise RuntimeError(
            "Slot object stream is already being consumed by "
            f"{self._consumed_by}. Choose one stream view per run."
        )


def create_slot_object_event_stream(
    source: AsyncIterable[dict[str, Any]] | SlotObjectEventSource,
) -> SlotObjectStream:
    if callable(source):
        create_events = cast("SlotObjectEventSource", source)
    else:
        def create_events() -> AsyncIterable[dict[str, Any]]:
            return source

    return SlotObjectStream(create_events)
