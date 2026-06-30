from __future__ import annotations

from collections.abc import Callable
from typing import cast

from ...errors import SlotFlightConfigurationError
from ...path import expand_slot_path
from ...prompt import create_slot_frame_prompt
from ...types import Prompt, SlotDefinition, SlotFlightRequest, SlotFrameRequest
from .types import CompiledSlot


def compile_slot_plan(definitions: list[SlotDefinition]) -> list[CompiledSlot]:
    slots: list[CompiledSlot] = []
    seen: set[str] = set()
    for definition in definitions:
        for path in expand_slot_path(definition.path, definition.count):
            if path in seen:
                raise SlotFlightConfigurationError(f'Duplicate slot path "{path}".')
            seen.add(path)
            slots.append(CompiledSlot(definition=definition, path=path))
    if not slots:
        raise SlotFlightConfigurationError("SlotFlight requires at least one slot.")
    return slots


def build_slot_flight_request(
    pending: list[CompiledSlot],
    attempts: dict[str, int],
    prompt: Prompt | None,
) -> SlotFlightRequest:
    request_slots = build_slot_frame_requests(pending, attempts)
    request_prompt = create_slot_frame_prompt(request_slots, prompt)
    return SlotFlightRequest(
        prompt=request_prompt,
        slots=request_slots,
        attempt=max(slot.attempt for slot in request_slots),
    )


def build_slot_frame_requests(
    slots: list[CompiledSlot],
    attempts: dict[str, int],
) -> list[SlotFrameRequest]:
    requests: list[SlotFrameRequest] = []
    for index, slot in enumerate(slots, start=1):
        # Prompt factories need the slot id, path, attempt, and mode. Build the
        # request once, then replace only the resolved prompt text.
        request = SlotFrameRequest(
            id=str(index),
            path=slot.path,
            template_path=slot.definition.path,
            prompt="",
            attempt=attempts[slot.path],
            mode=slot.definition.mode,
        )
        prompt = slot.definition.prompt
        prompt_text = (
            prompt
            if isinstance(prompt, str)
            else cast("Callable[[SlotFrameRequest], str]", prompt)(request)
        )
        requests.append(
            SlotFrameRequest(
                id=request.id,
                path=request.path,
                template_path=request.template_path,
                prompt=prompt_text,
                attempt=request.attempt,
                mode=request.mode,
            )
        )
    return requests
