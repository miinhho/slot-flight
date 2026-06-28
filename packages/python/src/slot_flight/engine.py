from __future__ import annotations

import copy
import inspect
import json
from dataclasses import dataclass
from typing import Any

from .errors import (
    SlotFlightConfigurationError,
    SlotFlightJsonParseError,
    SlotFlightSlotProtocolError,
    SlotFlightStreamError,
    SlotFlightValidationError,
)
from .frame import SlotFrameParser
from .path import expand_slot_path, set_path_value
from .prompt import create_slot_frame_prompt
from .types import (
    Prompt,
    SlotDefinition,
    SlotFlightRequest,
    SlotFrameRequest,
    SlotGenerator,
)


@dataclass(frozen=True)
class CompiledSlot:
    definition: SlotDefinition
    path: str


class SlotFlight:
    def __init__(
        self,
        *,
        slots: list[SlotDefinition],
        generate: SlotGenerator,
        prompt: Prompt | None = None,
        max_retries: int = 1,
        validate_final: Any | None = None,
    ):
        self._slots = _compile_slot_plan(slots)
        self._generate = generate
        self._prompt = prompt
        self._max_retries = max_retries
        self._validate_final = validate_final

    async def run(self):
        state: dict[str, Any] = {}
        attempts = {slot.path: 1 for slot in self._slots}
        pending = list(self._slots)

        while pending:
            request_slots = _create_slot_frame_requests(pending, attempts)
            request_prompt = create_slot_frame_prompt(request_slots, self._prompt)
            request = SlotFlightRequest(
                prompt=request_prompt,
                slots=request_slots,
                attempt=max(slot.attempt for slot in request_slots),
            )
            slots_by_path = {slot.path: slot for slot in pending}
            completed: set[str] = set()
            failures: dict[str, Exception] = {}
            parser = SlotFrameParser({slot.id: slot.path for slot in request_slots})

            try:
                stream = self._generate(request)
                if inspect.isawaitable(stream):
                    stream = await stream
                async for chunk in stream:
                    for event in parser.push(chunk):
                        if event.type == "slot-start":
                            yield {
                                "type": "slot-start",
                                "slot": event.slot,
                                "attempt": attempts[event.slot],
                                "state": copy.deepcopy(state),
                            }
                        elif event.type == "slot-delta":
                            yield {
                                "type": "slot-delta",
                                "slot": event.slot,
                                "attempt": attempts[event.slot],
                                "delta": event.delta,
                                "value": event.value,
                                "state": copy.deepcopy(state),
                            }
                        elif event.type == "slot-complete":
                            slot = slots_by_path[event.slot]
                            try:
                                value = _parse_slot_value(slot.definition, event.value)
                                set_path_value(state, event.slot, value)
                                completed.add(event.slot)
                                yield {
                                    "type": "slot-complete",
                                    "slot": event.slot,
                                    "attempt": attempts[event.slot],
                                    "value": value,
                                    "state": copy.deepcopy(state),
                                }
                            except Exception as error:  # noqa: BLE001
                                failures[event.slot] = _validation_error(error)
                parser.finish()
            except SlotFlightSlotProtocolError as error:
                if not error.retryable:
                    raise
                for slot in pending:
                    if slot.path not in completed:
                        failures.setdefault(slot.path, error)
            except Exception as error:
                raise SlotFlightStreamError(str(error)) from error

            for slot in pending:
                if slot.path not in completed and slot.path not in failures:
                    failures[slot.path] = SlotFlightSlotProtocolError(
                        f'Slot "{slot.path}" was not completed by the frame stream.',
                        True,
                    )

            next_pending: list[CompiledSlot] = []
            for slot in pending:
                failure = failures.get(slot.path)
                if failure is None:
                    continue
                limit = slot.definition.max_retries
                if limit is None:
                    limit = self._max_retries
                attempt = attempts[slot.path]
                if attempt <= limit:
                    yield {
                        "type": "slot-retry",
                        "slot": slot.path,
                        "attempt": attempt,
                        "error": failure,
                        "state": copy.deepcopy(state),
                    }
                    attempts[slot.path] = attempt + 1
                    next_pending.append(slot)
                else:
                    yield {
                        "type": "slot-error",
                        "slot": slot.path,
                        "attempt": attempt,
                        "error": failure,
                        "state": copy.deepcopy(state),
                    }
                    raise failure
            pending = next_pending

        final_state = _validate_final(self._validate_final, state)
        yield {"type": "done", "state": copy.deepcopy(final_state)}


def slot_flight(**options: Any) -> SlotFlight:
    return SlotFlight(**options)


def _compile_slot_plan(definitions: list[SlotDefinition]) -> list[CompiledSlot]:
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


def _create_slot_frame_requests(
    slots: list[CompiledSlot], attempts: dict[str, int]
) -> list[SlotFrameRequest]:
    requests: list[SlotFrameRequest] = []
    for index, slot in enumerate(slots, start=1):
        request = SlotFrameRequest(
            id=str(index),
            path=slot.path,
            template_path=slot.definition.path,
            prompt="",
            attempt=attempts[slot.path],
            mode=slot.definition.mode,
        )
        prompt = slot.definition.prompt
        request = SlotFrameRequest(
            id=request.id,
            path=request.path,
            template_path=request.template_path,
            prompt=prompt(request) if callable(prompt) else prompt,
            attempt=request.attempt,
            mode=request.mode,
        )
        requests.append(request)
    return requests


def _parse_slot_value(definition: SlotDefinition, raw_value: str) -> Any:
    value: Any = raw_value
    if definition.mode == "json":
        try:
            value = json.loads(raw_value)
        except json.JSONDecodeError as error:
            raise SlotFlightJsonParseError(str(error)) from error
    if definition.validate is not None:
        return definition.validate(value)
    return value


def _validation_error(error: Exception) -> Exception:
    if isinstance(error, (SlotFlightJsonParseError, SlotFlightValidationError)):
        return error
    return SlotFlightValidationError(str(error))


def _validate_final(validator: Any | None, state: dict[str, Any]) -> Any:
    if validator is None:
        return state
    if callable(validator):
        return validator(state)
    if hasattr(validator, "model_validate"):
        return validator.model_validate(state)
    if hasattr(validator, "parse_obj"):
        return validator.parse_obj(state)
    raise SlotFlightConfigurationError(
        "validate_final must be callable or a Pydantic-style model."
    )
