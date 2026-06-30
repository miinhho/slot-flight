from __future__ import annotations

import json
from collections.abc import AsyncIterable
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel

from .projections import completed_event_iterator, partial_object_iterator

SlotObjectStreamSource = Literal["completed", "partial", "events"]
SlotObjectStreamFormat = Literal["sse", "ndjson"]


async def stream_payloads(
    events: AsyncIterable[dict[str, Any]],
    source: SlotObjectStreamSource,
):
    if source == "partial":
        async for partial in partial_object_iterator(events):
            yield {"event": "partial", "data": partial}
        return

    if source == "events":
        async for event in events:
            yield {"event": event["type"], "data": serialize_event(event)}
        return

    async for event in completed_event_iterator(events):
        yield completed_event_payload(event)


def format_payload(
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


def completed_event_payload(event: dict[str, Any]) -> dict[str, Any]:
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

    return {"event": event["type"], "data": serialize_event(event)}


def serialize_event(event: dict[str, Any]) -> dict[str, Any]:
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
