from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from .errors import SlotFlightSlotProtocolError

_PROTOCOL_ERROR_PREVIEW_LENGTH = 160
_HEADER_PATTERN = re.compile(r"^<(?P<id>\d+)(?::(?P<index>\d+))?>")
_PARTIAL_ID_HEADER_PATTERN = re.compile(r"^<\d*$")
_PARTIAL_INDEXED_HEADER_PATTERN = re.compile(r"^<(?P<id>\d+):(?P<index>\d*)$")


@dataclass(frozen=True)
class SlotFrameParserEvent:
    type: Literal["slot-start", "slot-delta", "slot-complete"]
    slot: str
    index: int | None = None
    delta: str = ""
    value: str = ""


@dataclass
class _CurrentFrame:
    tag: str
    path: str
    index: int | None = None
    value: str = ""
    allows_immediate_closing: bool = False


class SlotFrameParser:
    def __init__(
        self,
        slots_by_id: dict[str, str],
        repeatable_slots: set[str] | None = None,
    ):
        self._slots_by_id = slots_by_id
        self._repeatable_slots = repeatable_slots or set()
        self._state: Literal["headers", "value"] = "headers"
        self._buffer = ""
        self._current: _CurrentFrame | None = None
        self._completed: set[str] = set()
        self._next_repeat_indexes: dict[str, int] = {}
        self._max_slot_id_digits = max(1, *(len(slot_id) for slot_id in slots_by_id))

    def push(self, chunk: str) -> list[SlotFrameParserEvent]:
        self._buffer += chunk
        events: list[SlotFrameParserEvent] = []

        while True:
            if self._state == "headers":
                self._drop_leading_blank_lines()
                if self._buffer == "":
                    return events

                header_match = _HEADER_PATTERN.match(self._buffer)
                if header_match is None:
                    if self._might_be_partial_header():
                        return events
                    preview = self._header_preview()
                    self._buffer = ""
                    raise SlotFlightSlotProtocolError(
                        "Expected slot id header but received "
                        f"{_format_protocol_preview(preview)}.",
                        True,
                    )

                slot_id = header_match.group("id")
                raw_index = header_match.group("index")
                path = self._slots_by_id.get(slot_id)
                if path is None:
                    raise SlotFlightSlotProtocolError(
                        f'Received unregistered slot id "{slot_id}".',
                        False,
                    )

                repeatable = path in self._repeatable_slots
                if raw_index is not None and not repeatable:
                    raise SlotFlightSlotProtocolError(
                        f'Received indexed frame for fixed slot "{path}".',
                        True,
                    )
                if raw_index is None and repeatable:
                    raise SlotFlightSlotProtocolError(
                        f'Repeatable slot "{path}" must use indexed tags '
                        f"like <{slot_id}:0>.",
                        True,
                    )
                frame_index = (
                    None
                    if raw_index is None
                    else self._parse_expected_repeat_index(path, raw_index)
                )

                completed_key = _frame_key(path, frame_index)
                if completed_key in self._completed:
                    raise SlotFlightSlotProtocolError(
                        f'Received duplicate slot "{completed_key}".',
                        False,
                    )

                tag = header_match.group(0)[1:-1]
                self._current = _CurrentFrame(
                    tag=tag,
                    path=path,
                    index=frame_index,
                    allows_immediate_closing=self._consume_opening_line_break(
                        len(header_match.group(0))
                    ),
                )
                self._state = "value"
                events.append(
                    SlotFrameParserEvent(
                        type="slot-start",
                        slot=path,
                        index=frame_index,
                    )
                )

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
                "Unexpected trailing content after slot frames: "
                f"{_format_protocol_preview(self._buffer)}.",
                True,
            )

    def _flush_value(self) -> tuple[list[SlotFrameParserEvent], bool]:
        if self._current is None:
            return [], False

        events: list[SlotFrameParserEvent] = []
        closing = f"</{self._current.tag}>"
        closing_index = _find_line_delimited_closing(
            self._buffer,
            closing,
            self._current.allows_immediate_closing,
        )

        if closing_index != -1:
            delta = _strip_one_trailing_line_break(self._buffer[:closing_index])
            if delta:
                self._current.value += delta
                events.append(
                    SlotFrameParserEvent(
                        type="slot-delta",
                        slot=self._current.path,
                        index=self._current.index,
                        delta=delta,
                        value=self._current.value,
                    )
                )
            events.append(
                SlotFrameParserEvent(
                    type="slot-complete",
                    slot=self._current.path,
                    index=self._current.index,
                    value=self._current.value,
                )
            )
            self._completed.add(_frame_key(self._current.path, self._current.index))
            if self._current.index is not None:
                self._next_repeat_indexes[self._current.path] = (
                    self._current.index + 1
                )
            self._buffer = self._buffer[closing_index + len(closing) :]
            self._current = None
            self._state = "headers"
            return events, True

        keep_start = _find_value_flush_boundary(self._buffer, closing)
        if keep_start == 0:
            return events, False

        delta = self._buffer[:keep_start]
        self._buffer = self._buffer[keep_start:]
        self._current.value += delta
        events.append(
            SlotFrameParserEvent(
                type="slot-delta",
                slot=self._current.path,
                index=self._current.index,
                delta=delta,
                value=self._current.value,
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
        if (
            len(self._buffer) <= self._max_slot_id_digits + 1
            and _PARTIAL_ID_HEADER_PATTERN.match(self._buffer) is not None
        ):
            return True

        indexed = _PARTIAL_INDEXED_HEADER_PATTERN.match(self._buffer)
        if indexed is None:
            return False

        slot_id = indexed.group("id")
        if len(slot_id) > self._max_slot_id_digits:
            return False

        path = self._slots_by_id.get(slot_id)
        if path is None or path not in self._repeatable_slots:
            return False

        expected_index = str(self._next_repeat_indexes.get(path, 0))
        return expected_index.startswith(indexed.group("index"))

    def _parse_expected_repeat_index(self, path: str, raw_index: str) -> int:
        expected_index = self._next_repeat_indexes.get(path, 0)
        expected = str(expected_index)
        if raw_index != expected:
            raise SlotFlightSlotProtocolError(
                f'Expected repeat index {expected} for slot "{path}" but received '
                f"{_format_index_for_error(raw_index)}.",
                True,
            )
        return expected_index

    def _header_preview(self) -> str:
        line_end = self._buffer.find("\n")
        return self._buffer if line_end == -1 else self._buffer[:line_end]

    def _consume_opening_line_break(self, header_length: int) -> bool:
        self._buffer = self._buffer[header_length:]
        if self._buffer.startswith("\r\n"):
            self._buffer = self._buffer[2:]
            return True
        if self._buffer.startswith("\n"):
            self._buffer = self._buffer[1:]
            return True
        return False


def _frame_key(path: str, index: int | None) -> str:
    return path if index is None else f"{path}:{index}"


def _strip_one_trailing_line_break(value: str) -> str:
    if value.endswith("\r\n"):
        return value[:-2]
    if value.endswith("\n"):
        return value[:-1]
    return value


def _find_line_delimited_closing(
    buffer: str,
    closing: str,
    allow_at_start: bool,
) -> int:
    search_from = 0
    while True:
        index = buffer.find(closing, search_from)
        if index == -1:
            return -1

        starts_line = (index == 0 and allow_at_start) or buffer[index - 1] == "\n"
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


def _format_protocol_preview(value: str) -> str:
    escaped = value.replace("\r", "\\r").replace("\n", "\\n")
    if len(escaped) <= _PROTOCOL_ERROR_PREVIEW_LENGTH:
        return f'"{escaped}"'
    return f'"{escaped[:_PROTOCOL_ERROR_PREVIEW_LENGTH]}..." (length {len(value)})'


def _format_index_for_error(value: str) -> str:
    if len(value) <= _PROTOCOL_ERROR_PREVIEW_LENGTH:
        return value
    return f"{value[:_PROTOCOL_ERROR_PREVIEW_LENGTH]}... (length {len(value)})"
