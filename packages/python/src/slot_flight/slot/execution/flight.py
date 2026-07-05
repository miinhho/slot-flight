from __future__ import annotations

import inspect
from typing import Any, cast

from ..._streams import close_stream, iterate_stream
from ...errors import SlotFlightSlotProtocolError, SlotFlightStreamError
from ...frame import SlotFrameParser
from ...path import has_path_value, set_path_value
from ...types import Prompt, SlotDefinition, SlotFlightRequest, SlotGenerator
from .events import apply_frame_event_to_state
from .failures import (
    mark_missing_slots_as_failures,
    mark_protocol_failure_for_unfinished_slots,
    slot_failure_events,
)
from .paths import SlotPathResolver
from .request import build_slot_flight_request, compile_slot_plan
from .state import snapshot_state
from .types import CompiledSlot, SlotAttemptOutcome
from .values import apply_final_state_validator


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
        self._slots = compile_slot_plan(slots)
        self._generate = generate
        self._prompt = prompt
        self._max_retries = max_retries
        self._final_state_validator = validate_final

    async def run(self):
        state: dict[str, Any] = {}
        attempts = {slot.path: 1 for slot in self._slots}
        pending = list(self._slots)

        while pending:
            request = build_slot_flight_request(pending, attempts, self._prompt)
            outcome = SlotAttemptOutcome(completed=set(), failures={})

            attempt_events = self._run_attempt(
                request=request,
                pending=pending,
                attempts=attempts,
                state=state,
                outcome=outcome,
            )
            try:
                async for event in attempt_events:
                    yield event
            finally:
                await close_stream(attempt_events)

            mark_missing_slots_as_failures(pending, outcome)

            # Retry scope is slot-level: completed slots stay in state and only
            # failed or missing slots are requested again.
            next_pending: list[CompiledSlot] = []
            for event, retry_slot in slot_failure_events(
                pending=pending,
                attempts=attempts,
                outcome=outcome,
                state=state,
                default_max_retries=self._max_retries,
            ):
                yield event
                if retry_slot is not None:
                    next_pending.append(retry_slot)
            pending = next_pending

        _ensure_repeatable_arrays(state, self._slots)
        final_state = apply_final_state_validator(self._final_state_validator, state)
        yield {"type": "done", "state": snapshot_state(final_state)}

    async def _run_attempt(
        self,
        *,
        request: SlotFlightRequest,
        pending: list[CompiledSlot],
        attempts: dict[str, int],
        state: dict[str, Any],
        outcome: SlotAttemptOutcome,
    ):
        parser = SlotFrameParser(
            {slot.id: slot.path for slot in request.slots},
            {slot.path for slot in pending if slot.repeat != "none"},
        )
        slots_by_path = {slot.path: slot for slot in pending}
        paths = SlotPathResolver()

        try:
            chunks = await self._open_chunk_stream(request)
            try:
                async for chunk in chunks:
                    chunk = cast(str, chunk)
                    for frame_event in parser.push(chunk):
                        event = apply_frame_event_to_state(
                            frame_event=frame_event,
                            slots_by_path=slots_by_path,
                            attempts=attempts,
                            paths=paths,
                            state=state,
                            outcome=outcome,
                        )
                        if event is not None:
                            yield event
            finally:
                await close_stream(chunks)
            parser.finish()
        except SlotFlightSlotProtocolError as error:
            if not error.retryable:
                raise
            mark_protocol_failure_for_unfinished_slots(pending, outcome, error)
        except Exception as error:
            raise SlotFlightStreamError(str(error)) from error

    async def _open_chunk_stream(self, request: SlotFlightRequest):
        stream = self._generate(request)
        if inspect.isawaitable(stream):
            stream = await stream
        return iterate_stream(
            stream,
            error_message="Slot generator must return an iterable stream.",
        )


def slot_flight(**options: Any) -> SlotFlight:
    return SlotFlight(**options)


def _ensure_repeatable_arrays(
    state: dict[str, Any],
    slots: list[CompiledSlot],
) -> None:
    array_paths = {
        slot.array_path
        for slot in slots
        if slot.repeat != "none" and slot.array_path is not None
    }
    for path in array_paths:
        if not has_path_value(state, path):
            set_path_value(state, path, [])
