from __future__ import annotations

from typing import Any

from ...errors import SlotFlightSlotProtocolError, SlotFlightValidationError
from ...path import set_path_value
from .paths import SlotPathResolver
from .state import snapshot_state
from .types import CompiledSlot, SlotAttemptOutcome
from .values import decode_and_validate_slot_value


def apply_frame_event_to_state(
    *,
    frame_event: Any,
    slots_by_path: dict[str, CompiledSlot],
    attempts: dict[str, int],
    paths: SlotPathResolver,
    state: dict[str, Any],
    outcome: SlotAttemptOutcome,
) -> dict[str, Any] | None:
    slot = slots_by_path[frame_event.slot]

    if frame_event.type == "slot-start":
        concrete_path = paths.start(slot, frame_event.index)
        return {
            "type": "slot-start",
            "slot": concrete_path,
            "attempt": attempts[slot.path],
            "state": snapshot_state(state),
        }

    if frame_event.type == "slot-delta":
        concrete_path = paths.current(slot, frame_event.index)
        set_path_value(state, concrete_path, frame_event.value)
        return {
            "type": "slot-delta",
            "slot": concrete_path,
            "attempt": attempts[slot.path],
            "delta": frame_event.delta,
            "value": frame_event.value,
            "state": snapshot_state(state),
        }

    if frame_event.type != "slot-complete":
        return None

    concrete_path = paths.current(slot, frame_event.index)
    if concrete_path in outcome.completed:
        raise SlotFlightSlotProtocolError(
            f'Received duplicate slot "{concrete_path}".',
            False,
        )

    try:
        value = decode_and_validate_slot_value(slot.definition, frame_event.value)
    except SlotFlightValidationError as error:
        outcome.failures[frame_event.slot] = error
        outcome.completed.add(concrete_path)
        paths.complete(slot, frame_event.index)
        return None
    except Exception as error:  # noqa: BLE001
        # User validators may raise arbitrary exceptions. Convert them into the
        # slot-flight validation error shape so retry handling stays uniform.
        outcome.failures[frame_event.slot] = SlotFlightValidationError(str(error))
        outcome.completed.add(concrete_path)
        paths.complete(slot, frame_event.index)
        return None

    set_path_value(state, concrete_path, value)
    outcome.completed.add(concrete_path)
    paths.complete(slot, frame_event.index)
    return {
        "type": "slot-complete",
        "slot": concrete_path,
        "attempt": attempts[slot.path],
        "value": value,
        "state": snapshot_state(state),
    }
