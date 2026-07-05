from __future__ import annotations

import re
from typing import Any, Literal, TypedDict

from .errors import SlotFlightConfigurationError


class Token(TypedDict):
    type: Literal["property", "index"]
    value: str | int


def expand_slot_path(path: str, count: int | None = None) -> list[str]:
    tokens = _parse_template(path)
    wildcard_count = sum(1 for token in tokens if token == "[]")

    if wildcard_count == 0:
        return [path]
    if wildcard_count > 1:
        raise SlotFlightConfigurationError(
            f'Slot path "{path}" has multiple [] wildcards. '
            "Define one repeated dimension per slot."
        )
    if count is None or not isinstance(count, int) or count < 0:
        raise SlotFlightConfigurationError(
            f'Slot path "{path}" requires a non-negative count.'
        )

    concrete_paths: list[str] = []
    for index in range(count):
        segments = [f"[{index}]" if token == "[]" else token for token in tokens]
        concrete_paths.append(".".join(segments).replace(".[", "["))
    return concrete_paths


def count_array_wildcards(path: str) -> int:
    return sum(1 for token in _parse_template(path) if token == "[]")


def is_append_template_path(path: str) -> bool:
    return _parse_template(path)[-1] == "[]"


def array_wildcard_path(path: str) -> str:
    wildcard_index = path.find("[]")
    if wildcard_index == -1:
        raise SlotFlightConfigurationError(
            f'Slot path "{path}" does not contain an array wildcard.'
        )
    return path[:wildcard_index]


def concrete_path_for_array_item(path: str, index: int) -> str:
    if not isinstance(index, int) or index < 0:
        raise SlotFlightConfigurationError(
            "Array item index must be a non-negative integer."
        )
    if count_array_wildcards(path) != 1:
        raise SlotFlightConfigurationError(
            f'Slot path "{path}" must contain exactly one [] wildcard.'
        )
    return path.replace("[]", f"[{index}]", 1)


def set_path_value(target: dict[str, Any], path: str, value: Any) -> None:
    tokens = parse_concrete_path(path)
    current: Any = target

    for index, token in enumerate(tokens):
        is_last = index == len(tokens) - 1
        if token["type"] == "property":
            key = str(token["value"])
            if not isinstance(current, dict):
                raise SlotFlightConfigurationError(
                    f'Cannot set property "{key}" in "{path}".'
                )
            if is_last:
                current[key] = value
                return
            if key not in current or current[key] is None:
                current[key] = [] if tokens[index + 1]["type"] == "index" else {}
            current = current[key]
            continue

        array_index = int(token["value"])
        if not isinstance(current, list):
            raise SlotFlightConfigurationError(
                f'Cannot set array index {array_index} in "{path}".'
            )
        while len(current) <= array_index:
            current.append(None)
        if is_last:
            current[array_index] = value
            return
        if current[array_index] is None:
            current[array_index] = (
                [] if tokens[index + 1]["type"] == "index" else {}
            )
        current = current[array_index]

    raise SlotFlightConfigurationError(f'Cannot set value for path "{path}".')


def clear_template_path_values(target: dict[str, Any], path: str) -> None:
    tokens = _parse_template(path)
    wildcard_count = sum(1 for token in tokens if token == "[]")
    if wildcard_count != 1:
        raise SlotFlightConfigurationError(
            f'Slot path "{path}" must contain exactly one [] wildcard.'
        )
    _clear_template_tokens(target, tokens, 0)


def has_path_value(target: dict[str, Any], path: str) -> bool:
    tokens = parse_concrete_path(path)
    current: Any = target

    for token in tokens:
        if token["type"] == "property":
            key = str(token["value"])
            if not isinstance(current, dict) or key not in current:
                return False
            current = current[key]
            continue

        array_index = int(token["value"])
        if not isinstance(current, list) or array_index >= len(current):
            return False
        current = current[array_index]

    return True


def _clear_template_tokens(current: Any, tokens: list[str], index: int) -> None:
    if index >= len(tokens):
        return

    token = tokens[index]
    if token != "[]":
        if not isinstance(current, dict) or token not in current:
            return
        if index == len(tokens) - 1:
            del current[token]
            return
        _clear_template_tokens(current[token], tokens, index + 1)
        return

    if not isinstance(current, list):
        return
    if index == len(tokens) - 1:
        current.clear()
        return

    for item in current:
        _clear_template_tokens(item, tokens, index + 1)


def parse_concrete_path(path: str) -> list[Token]:
    if path.strip() == "":
        raise SlotFlightConfigurationError("Concrete path cannot be empty.")

    tokens: list[Token] = []
    for segment in path.split("."):
        if segment == "":
            raise SlotFlightConfigurationError(f'Invalid concrete path "{path}".')

        match = re.match(r"^(?P<key>[^\[\]]+)(?P<indexes>(\[\d+\])*)$", segment)
        if match is None:
            raise SlotFlightConfigurationError(
                f'Invalid concrete path segment "{segment}".'
            )

        tokens.append({"type": "property", "value": match.group("key")})
        for raw_index in re.findall(r"\[(\d+)\]", match.group("indexes")):
            tokens.append({"type": "index", "value": int(raw_index)})

    return tokens


def _parse_template(path: str) -> list[str]:
    if path.strip() == "":
        raise SlotFlightConfigurationError("Slot path cannot be empty.")

    tokens: list[str] = []
    for segment in path.split("."):
        if segment == "":
            raise SlotFlightConfigurationError(f'Invalid slot path "{path}".')
        if segment.endswith("[]"):
            key = segment[:-2]
            if key == "":
                raise SlotFlightConfigurationError(
                    f'Invalid array segment "{segment}" in "{path}".'
                )
            tokens.extend([key, "[]"])
            continue
        if "[" in segment or "]" in segment:
            raise SlotFlightConfigurationError(
                f'Template path "{path}" must use [] wildcards, '
                "not concrete indexes."
            )
        tokens.append(segment)
    return tokens
