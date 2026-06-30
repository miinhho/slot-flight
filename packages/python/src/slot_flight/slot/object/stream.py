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


class SlotObjectStream:
    def __init__(self, create_events: SlotObjectEventSource):
        self._create_events = create_events
        self._events: list[dict[str, Any]] = []
        self._final_object: Any | None = None
        self._consumed = False
        self._running = False

    async def events(self):
        events = self._consume_run()
        try:
            async for event in events:
                yield event
        finally:
            await close_stream(events)

    async def slot_event_stream(self):
        async for event in self.events():
            yield event

    async def completed_slots(self):
        events = self._consume_run()
        try:
            async for slot in completed_slot_iterator(events):
                yield slot
        finally:
            await close_stream(events)

    async def completed_slot_stream(self):
        async for slot in self.completed_slots():
            yield slot

    async def partial_objects(self):
        events = self._consume_run()
        try:
            async for partial in partial_object_iterator(events):
                yield partial
        finally:
            await close_stream(events)

    async def partial_object_stream(self):
        async for partial in self.partial_objects():
            yield partial

    async def final_object(self):
        if self._final_object is not None:
            return self._final_object

        async for event in self._consume_run():
            if event["type"] == "done":
                return event["state"]
        raise RuntimeError("Slot object stream ended without a final object.")

    async def to_sse(self, *, source: SlotObjectStreamSource = "completed"):
        async for payload in stream_payloads(self._consume_run(), source):
            yield format_payload(payload, "sse")

    async def to_ndjson(self, *, source: SlotObjectStreamSource = "completed"):
        async for payload in stream_payloads(self._consume_run(), source):
            yield format_payload(payload, "ndjson")

    async def _consume_run(self):
        if self._consumed:
            for event in self._events:
                yield event
            return

        if self._running:
            raise RuntimeError("Slot object stream already has a live consumer.")

        self._running = True
        events = self._create_events()
        try:
            async for event in events:
                self._events.append(event)
                if event["type"] == "done":
                    self._final_object = event["state"]
                yield event
        finally:
            await close_stream(events)
            self._running = False
            self._consumed = True


def create_slot_object_event_stream(
    source: AsyncIterable[dict[str, Any]] | SlotObjectEventSource,
) -> SlotObjectStream:
    if callable(source):
        create_events = cast("SlotObjectEventSource", source)
    else:
        def create_events() -> AsyncIterable[dict[str, Any]]:
            return source

    return SlotObjectStream(create_events)
