from __future__ import annotations

from typing import Any

from ...errors import SlotFlightSlotProtocolError
from ...path import clear_template_path_values
from .state import snapshot_state
from .types import CompiledSlot, SlotAttemptOutcome


def mark_protocol_failure_for_unfinished_slots(
    pending: list[CompiledSlot],
    outcome: SlotAttemptOutcome,
    error: Exception,
) -> None:
    for slot in pending:
        if slot.path not in outcome.completed:
            outcome.failures.setdefault(slot.path, error)


def mark_missing_slots_as_failures(
    pending: list[CompiledSlot],
    outcome: SlotAttemptOutcome,
) -> None:
    for slot in pending:
        if slot.repeat != "none":
            continue
        if slot.path not in outcome.completed and slot.path not in outcome.failures:
            outcome.failures[slot.path] = SlotFlightSlotProtocolError(
                f'Slot "{slot.path}" was not completed by the frame stream.',
                True,
            )


def slot_failure_events(
    *,
    pending: list[CompiledSlot],
    attempts: dict[str, int],
    outcome: SlotAttemptOutcome,
    state: dict[str, Any],
    default_max_retries: int,
):
    for slot in pending:
        failure = outcome.failures.get(slot.path)
        if failure is None:
            continue

        limit = slot.definition.max_retries
        if limit is None:
            limit = default_max_retries

        attempt = attempts[slot.path]
        if attempt <= limit:
            if slot.repeat != "none":
                clear_template_path_values(state, slot.path)
            event = {
                "type": "slot-retry",
                "slot": slot.path,
                "attempt": attempt,
                "error": failure,
                "state": snapshot_state(state),
            }
            attempts[slot.path] = attempt + 1
            yield event, slot
            continue

        yield {
            "type": "slot-error",
            "slot": slot.path,
            "attempt": attempt,
            "error": failure,
            "state": snapshot_state(state),
        }, None
        raise failure
