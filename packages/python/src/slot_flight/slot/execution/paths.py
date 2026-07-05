from __future__ import annotations

from ...errors import SlotFlightSlotProtocolError
from ...path import concrete_path_for_array_item
from .types import CompiledSlot


class SlotPathResolver:
    def __init__(self):
        self._active_paths: dict[str, str] = {}

    def start(self, slot: CompiledSlot, index: int | None) -> str:
        concrete_path = self._resolve_start(slot, index)
        self._active_paths[_frame_key(slot.path, index)] = concrete_path
        return concrete_path

    def current(self, slot: CompiledSlot, index: int | None) -> str:
        key = _frame_key(slot.path, index)
        concrete_path = self._active_paths.get(key)
        if concrete_path is None:
            raise SlotFlightSlotProtocolError(
                f'Received value for slot "{key}" before its frame started.',
                False,
            )
        return concrete_path

    def complete(self, slot: CompiledSlot, index: int | None) -> None:
        self._active_paths.pop(_frame_key(slot.path, index), None)

    def _resolve_start(self, slot: CompiledSlot, index: int | None) -> str:
        if slot.repeat == "none":
            if index is not None:
                raise SlotFlightSlotProtocolError(
                    f'Received indexed frame for fixed slot "{slot.path}".',
                    True,
                )
            return slot.path

        if index is None:
            raise SlotFlightSlotProtocolError(
                f'Repeatable slot "{slot.path}" must use an indexed frame tag.',
                True,
            )

        if slot.array_path is None:
            raise SlotFlightSlotProtocolError(
                f'Repeatable slot "{slot.path}" is missing its array path.',
                False,
            )

        return concrete_path_for_array_item(slot.path, index)


def _frame_key(path: str, index: int | None) -> str:
    return path if index is None else f"{path}:{index}"
