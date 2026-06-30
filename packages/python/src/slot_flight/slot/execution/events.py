from __future__ import annotations

from typing import Any

from ...errors import (
    SlotFlightJsonParseError,
    SlotFlightValidationError,
)
from ...path import set_path_value
from .state import snapshot_state
from .types import CompiledSlot, SlotAttemptOutcome
from .values import decode_and_validate_slot_value


def apply_frame_event_to_state(
    *,
    frame_event: Any,
    slots_by_path: dict[str, CompiledSlot],
    attempts: dict[str, int],
    state: dict[str, Any],
    outcome: SlotAttemptOutcome,
) -> dict[str, Any] | None:
    if frame_event.type == "slot-start":
        return {
            "type": "slot-start",
            "slot": frame_event.slot,
            "attempt": attempts[frame_event.slot],
            "state": snapshot_state(state),
        }

    if frame_event.type == "slot-delta":
        return {
            "type": "slot-delta",
            "slot": frame_event.slot,
            "attempt": attempts[frame_event.slot],
            "delta": frame_event.delta,
            "value": frame_event.value,
            "state": snapshot_state(state),
        }

    if frame_event.type != "slot-complete":
        return None

    slot = slots_by_path[frame_event.slot]
    try:
        value = decode_and_validate_slot_value(slot.definition, frame_event.value)
    except (SlotFlightJsonParseError, SlotFlightValidationError) as error:
        outcome.failures[frame_event.slot] = error
        return None
    except Exception as error:  # noqa: BLE001
        # User validators may raise arbitrary exceptions. Convert them into the
        # slot-flight validation error shape so retry handling stays uniform.
        outcome.failures[frame_event.slot] = SlotFlightValidationError(str(error))
        return None

    set_path_value(state, frame_event.slot, value)
    outcome.completed.add(frame_event.slot)
    return {
        "type": "slot-complete",
        "slot": frame_event.slot,
        "attempt": attempts[frame_event.slot],
        "value": value,
        "state": snapshot_state(state),
    }
