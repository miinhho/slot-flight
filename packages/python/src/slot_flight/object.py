from __future__ import annotations

import json
from collections.abc import AsyncIterable, Callable
from dataclasses import dataclass
from enum import Enum
from typing import Any, Literal, cast, get_args, get_origin

from pydantic import BaseModel, TypeAdapter

from ._streams import close_stream
from .engine import SlotFlight
from .errors import SlotFlightConfigurationError
from .types import Prompt, SlotDefinition, SlotGenerator, SlotMode


@dataclass(frozen=True)
class SlotObjectOutput:
    model: type[BaseModel]
    slots: list[SlotDefinition]
    prompt: Prompt | None = None
    max_retries: int = 1


@dataclass(frozen=True)
class CompletedSlot:
    slot: str
    value: Any
    state: Any
    attempt: int


SlotObjectStreamSource = Literal["completed", "partial", "events"]
SlotObjectStreamFormat = Literal["sse", "ndjson"]
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
            async for event in events:
                if event["type"] == "slot-complete":
                    yield CompletedSlot(
                        slot=event["slot"],
                        value=event["value"],
                        state=event["state"],
                        attempt=event["attempt"],
                    )
        finally:
            await close_stream(events)

    async def completed_slot_stream(self):
        async for slot in self.completed_slots():
            yield slot

    async def partial_objects(self):
        events = self._consume_run()
        try:
            async for event in events:
                if _event_has_state(event):
                    yield event["state"]
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
        async for payload in self._payloads(source):
            yield _format_payload(payload, "sse")

    async def to_ndjson(self, *, source: SlotObjectStreamSource = "completed"):
        async for payload in self._payloads(source):
            yield _format_payload(payload, "ndjson")

    async def _payloads(self, source: SlotObjectStreamSource):
        events = self._consume_run()
        try:
            async for event in events:
                if source == "partial":
                    if _event_has_state(event):
                        yield {"event": "partial", "data": event["state"]}
                    continue

                if source == "events":
                    yield {
                        "event": event["type"],
                        "data": _serialize_event(event),
                    }
                    continue

                if _is_completed_output_event(event):
                    yield _completed_event_payload(event)
        finally:
            await close_stream(events)

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


def slot_object(
    model: type[BaseModel],
    *,
    prompt: Prompt | None = None,
    max_retries: int = 1,
) -> SlotObjectOutput:
    if not isinstance(model, type) or not issubclass(model, BaseModel):
        raise SlotFlightConfigurationError("slot_object() requires a Pydantic model.")

    slots = _infer_slots(model)
    if not slots:
        raise SlotFlightConfigurationError(
            "slot_object() requires at least one field with a description."
        )
    return SlotObjectOutput(
        model=model,
        slots=slots,
        prompt=prompt,
        max_retries=max_retries,
    )


def create_slot_object_stream(
    *,
    output: SlotObjectOutput,
    generate: SlotGenerator,
    prompt: Prompt | None = None,
    max_retries: int | None = None,
) -> SlotObjectStream:
    def create_events():
        return SlotFlight(
            slots=output.slots,
            generate=generate,
            prompt=prompt if prompt is not None else output.prompt,
            max_retries=max_retries if max_retries is not None else output.max_retries,
            validate_final=output.model,
        ).run()

    return SlotObjectStream(create_events)


def create_slot_object_event_stream(
    source: AsyncIterable[dict[str, Any]] | SlotObjectEventSource,
) -> SlotObjectStream:
    if callable(source):
        create_events = cast("SlotObjectEventSource", source)
    else:
        def create_events() -> AsyncIterable[dict[str, Any]]:
            return source

    return SlotObjectStream(create_events)


def _event_has_state(event: dict[str, Any]) -> bool:
    return event["type"] in {"slot-delta", "slot-complete", "done"}


def _is_completed_output_event(event: dict[str, Any]) -> bool:
    return event["type"] in {"slot-complete", "slot-retry", "slot-error", "done"}


def _completed_event_payload(event: dict[str, Any]) -> dict[str, Any]:
    if event["type"] == "slot-complete":
        return {
            "event": "slot",
            "data": {
                "slot": event["slot"],
                "value": event["value"],
                "state": event["state"],
            },
        }

    if event["type"] == "done":
        return {"event": "done", "data": {"state": event["state"]}}

    return {"event": event["type"], "data": _serialize_event(event)}


def _format_payload(
    payload: dict[str, Any],
    output_format: SlotObjectStreamFormat,
) -> str:
    event = payload["event"]
    data = _jsonable(payload["data"])
    if output_format == "ndjson":
        return json.dumps(
            {"type": event, "data": data},
            ensure_ascii=False,
            separators=(",", ":"),
        ) + "\n"
    return (
        f"event: {event}\n"
        f"data: {json.dumps(data, ensure_ascii=False, separators=(',', ':'))}\n\n"
    )


def _serialize_event(event: dict[str, Any]) -> dict[str, Any]:
    if event["type"] not in {"slot-error", "slot-retry"}:
        return event

    serialized = dict(event)
    serialized["error"] = _jsonable(event["error"])
    return serialized


def _jsonable(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, Exception):
        return {"name": value.__class__.__name__, "message": str(value)}
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    return value


def _infer_slots(model: type[BaseModel], prefix: str = "") -> list[SlotDefinition]:
    slots: list[SlotDefinition] = []
    for name, field in model.model_fields.items():
        path = f"{prefix}.{name}" if prefix else name
        annotation = field.annotation
        description = field.description

        if description:
            slots.append(
                SlotDefinition(
                    path=path,
                    prompt=description,
                    validate=TypeAdapter(annotation).validate_python,
                    mode=_slot_mode(annotation),
                )
            )
            continue

        nested = _model_type(annotation)
        if nested is not None:
            slots.extend(_infer_slots(nested, path))
            continue

        raise SlotFlightConfigurationError(
            f'Pydantic field "{path}" must use Field(description=...) '
            "to become a slot."
        )
    return slots


def _slot_mode(annotation: Any) -> SlotMode:
    if _is_text_annotation(annotation):
        return "text"
    return "json"


def _is_text_annotation(annotation: Any) -> bool:
    if annotation is str:
        return True

    origin = get_origin(annotation)
    if origin is Literal:
        args = get_args(annotation)
        return bool(args) and all(isinstance(arg, str) for arg in args)

    if isinstance(annotation, type) and issubclass(annotation, str):
        return True
    if isinstance(annotation, type) and issubclass(annotation, Enum):
        return issubclass(annotation, str)
    return False


def _model_type(annotation: Any) -> type[BaseModel] | None:
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return annotation
    return None
