from __future__ import annotations

from collections.abc import AsyncIterable
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class CompletedSlot:
    slot: str
    value: Any
    state: Any
    attempt: int


async def partial_object_iterator(events: AsyncIterable[dict[str, Any]]):
    async for event in events:
        if event_has_state(event):
            yield event["state"]


async def completed_slot_iterator(events: AsyncIterable[dict[str, Any]]):
    async for event in events:
        if event["type"] == "slot-complete":
            yield CompletedSlot(
                slot=event["slot"],
                value=event["value"],
                state=event["state"],
                attempt=event["attempt"],
            )


async def completed_event_iterator(events: AsyncIterable[dict[str, Any]]):
    async for event in events:
        if is_completed_output_event(event):
            yield event


def event_has_state(event: dict[str, Any]) -> bool:
    return event["type"] in {"slot-delta", "slot-complete", "done"}


def is_completed_output_event(event: dict[str, Any]) -> bool:
    return event["type"] in {"slot-complete", "slot-retry", "slot-error", "done"}
