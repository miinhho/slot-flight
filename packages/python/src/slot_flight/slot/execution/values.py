from __future__ import annotations

from typing import Any

from ...errors import SlotFlightConfigurationError
from ...types import SlotDefinition


def decode_and_validate_slot_value(definition: SlotDefinition, raw_value: str) -> Any:
    value: Any = raw_value
    if definition.validate is not None:
        return definition.validate(value)
    return value


def apply_final_state_validator(validator: Any | None, state: dict[str, Any]) -> Any:
    if validator is None:
        return state
    if hasattr(validator, "model_validate"):
        return validator.model_validate(state)
    if hasattr(validator, "parse_obj"):
        return validator.parse_obj(state)
    if callable(validator):
        return validator(state)
    raise SlotFlightConfigurationError(
        "validate_final must be callable or a Pydantic-style model."
    )
