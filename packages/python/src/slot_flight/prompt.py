from __future__ import annotations

from collections.abc import Callable
from textwrap import dedent
from typing import cast

from .types import Prompt, SlotFlightRequest, SlotFrameRequest


def create_slot_frame_prompt(
    slots: list[SlotFrameRequest], prompt: Prompt | None = None
) -> str:
    request = SlotFlightRequest(
        prompt="",
        slots=slots,
        attempt=max(slot.attempt for slot in slots),
    )
    if isinstance(prompt, str):
        return prompt
    if prompt is not None:
        return cast("Callable[[SlotFlightRequest], str]", prompt)(request)
    return default_slot_frame_prompt(slots)


def default_slot_frame_prompt(slots: list[SlotFrameRequest]) -> str:
    slot_list = "\n\n".join(_format_slot_prompt_entry(slot) for slot in slots)
    return dedent(
        f"""\
        You are filling slots for a server-owned JSON object.
        Do not emit JSON.
        The server owns the object shape, paths, validation, retries, and assembly.

        OUTPUT CONTRACT
        - Emit exactly one frame for each requested slot.
        - Emit frames in the same order as the slot list.
        - Copy each open and close tag exactly.
        - Put each closing tag on its own line with no other text on that line.
        - Do not emit unrequested ids, JSON paths, markdown, code fences, commentary, bullets, or explanations.
        - Do not omit a frame. If a value is uncertain, make the best valid value for that slot.

        FRAME SHAPE
        <1>
        raw slot value only
        </1>
        - The parser only treats a closing tag as a delimiter when it is the whole line.
        - Inline text like "hello </1> world" is value text, not a delimiter.

        VALUE RULES
        - For mode: text, emit the raw value only. Do not wrap it in quotes unless quotes are part of the value.
        - For mode: json, emit one syntactically valid JSON value inside the frame body and nothing else.
        - JSON strings, arrays, and objects must use valid JSON syntax with double-quoted strings.
        - Respect each slot instruction, especially enum labels, length limits, item counts, and requested language.
        - A retry attempt means the previous frame or value for that slot failed parsing, protocol checks, or validation. Produce a corrected value only for the requested retry slot.

        SLOTS
        {slot_list}
        """
    )


def _format_slot_prompt_entry(slot: SlotFrameRequest) -> str:
    lines = [
        f"- id: {slot.id}",
        f"  path: {slot.path}",
        f"  mode: {slot.mode}",
        f"  attempt: {slot.attempt}",
        f"  open: <{slot.id}>",
        f"  close: </{slot.id}>",
    ]
    if slot.prompt:
        lines.append(f"  instruction: {slot.prompt}")
    return "\n".join(lines)
