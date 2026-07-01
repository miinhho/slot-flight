from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from .errors import SlotFlightSlotProtocolError


@dataclass(frozen=True)
class SlotFrameParserEvent:
    type: Literal["slot-start", "slot-delta", "slot-complete"]
    slot: str
    delta: str = ""
    value: str = ""


class SlotFrameParser:
    def __init__(self, slots_by_id: dict[str, str]):
        self._slots_by_id = slots_by_id
        self._state: Literal["headers", "value"] = "headers"
        self._buffer = ""
        self._current: dict[str, str] | None = None
        self._completed: set[str] = set()

    def push(self, chunk: str) -> list[SlotFrameParserEvent]:
        self._buffer += chunk
        events: list[SlotFrameParserEvent] = []

        while True:
            if self._state == "headers":
                self._drop_leading_blank_lines()
                if self._buffer == "":
                    return events

                header_match = re.match(r"^<(?P<id>\d+)>", self._buffer)
                if header_match is None:
                    if self._might_be_partial_header():
                        return events
                    line_end = self._buffer.find("\n")
                    received = (
                        self._buffer if line_end == -1 else self._buffer[:line_end]
                    )
                    raise SlotFlightSlotProtocolError(
                        f'Expected slot id header but received "{received}".',
                        True,
                    )

                slot_id = header_match.group("id")
                path = self._slots_by_id.get(slot_id)
                if path is None:
                    raise SlotFlightSlotProtocolError(
                        f'Received unregistered slot id "{slot_id}".',
                        False,
                    )
                if path in self._completed:
                    raise SlotFlightSlotProtocolError(
                        f'Received duplicate slot "{path}".',
                        False,
                    )

                self._current = {"id": slot_id, "path": path, "value": ""}
                self._buffer = self._buffer[len(header_match.group(0)) :]
                if self._buffer.startswith("\r\n"):
                    self._buffer = self._buffer[2:]
                elif self._buffer.startswith("\n"):
                    self._buffer = self._buffer[1:]
                self._state = "value"
                events.append(SlotFrameParserEvent(type="slot-start", slot=path))

            if self._state == "value":
                frame_events, completed_frame = self._flush_value()
                events.extend(frame_events)
                if not completed_frame:
                    return events

    def finish(self) -> None:
        self._drop_leading_blank_lines()
        if self._state != "headers" or self._current is not None:
            raise SlotFlightSlotProtocolError(
                "Slot stream ended before closing delimiter.",
                True,
            )
        if self._buffer:
            raise SlotFlightSlotProtocolError(
                f'Unexpected trailing content after slot frames: "{self._buffer}".',
                True,
            )

    def _flush_value(self) -> tuple[list[SlotFrameParserEvent], bool]:
        if self._current is None:
            return [], False

        events: list[SlotFrameParserEvent] = []
        closing = f"</{self._current['id']}>"
        closing_index = _find_line_delimited_closing(self._buffer, closing)

        if closing_index != -1:
            delta = _strip_one_trailing_line_break(self._buffer[:closing_index])
            if delta:
                self._current["value"] += delta
                events.append(
                    SlotFrameParserEvent(
                        type="slot-delta",
                        slot=self._current["path"],
                        delta=delta,
                        value=self._current["value"],
                    )
                )
            events.append(
                SlotFrameParserEvent(
                    type="slot-complete",
                    slot=self._current["path"],
                    value=self._current["value"],
                )
            )
            self._completed.add(self._current["path"])
            self._buffer = self._buffer[closing_index + len(closing) :]
            self._current = None
            self._state = "headers"
            return events, True

        keep_start = _find_value_flush_boundary(self._buffer, closing)
        if keep_start == 0:
            return events, False

        delta = self._buffer[:keep_start]
        self._buffer = self._buffer[keep_start:]
        self._current["value"] += delta
        events.append(
            SlotFrameParserEvent(
                type="slot-delta",
                slot=self._current["path"],
                delta=delta,
                value=self._current["value"],
            )
        )
        return events, False

    def _drop_leading_blank_lines(self) -> None:
        while self._buffer.startswith("\n") or self._buffer.startswith("\r\n"):
            self._buffer = (
                self._buffer[2:]
                if self._buffer.startswith("\r\n")
                else self._buffer[1:]
            )

    def _might_be_partial_header(self) -> bool:
        return re.match(r"^<\d*$", self._buffer) is not None


def _strip_one_trailing_line_break(value: str) -> str:
    if value.endswith("\r\n"):
        return value[:-2]
    if value.endswith("\n"):
        return value[:-1]
    return value


def _find_line_delimited_closing(buffer: str, closing: str) -> int:
    search_from = 0
    while True:
        index = buffer.find(closing, search_from)
        if index == -1:
            return -1

        starts_line = index == 0 or buffer[index - 1] == "\n"
        after_index = index + len(closing)
        at_line_end = (
            after_index == len(buffer)
            or buffer[after_index] == "\n"
            or (
                buffer[after_index] == "\r"
                and after_index + 1 < len(buffer)
                and buffer[after_index + 1] == "\n"
            )
        )
        if starts_line and at_line_end:
            return index

        search_from = index + 1


def _find_value_flush_boundary(buffer: str, closing: str) -> int:
    last_line_break = buffer.rfind("\n")
    if last_line_break != -1:
        if last_line_break > 0 and buffer[last_line_break - 1] == "\r":
            return last_line_break - 1
        return last_line_break

    if closing.startswith(buffer):
        return 0

    if buffer.startswith(f"{closing}\r"):
        return 0

    if buffer.endswith("\r"):
        return len(buffer) - 1

    return len(buffer)
