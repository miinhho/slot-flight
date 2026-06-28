from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from enum import Enum
from typing import Any, Literal, get_args, get_origin

from pydantic import BaseModel, TypeAdapter

from .engine import SlotFlight
from .errors import SlotFlightConfigurationError
from .types import Prompt, SlotDefinition, SlotGenerator, SlotMode


@dataclass(frozen=True)
class SlotObjectOutput:
    model: type[BaseModel]
    slots: list[SlotDefinition]
    prompt: Prompt | None = None
    max_retries: int = 1


@dataclass(frozen=True)
class CompletedSlot:
    slot: str
    value: Any
    state: Any
    attempt: int


class SlotObjectStream:
    def __init__(self, create_flight: Callable[[], SlotFlight]):
        self._create_flight = create_flight

    async def events(self):
        async for event in self._create_flight().run():
            yield event

    async def completed_slots(self):
        async for event in self.events():
            if event["type"] == "slot-complete":
                yield CompletedSlot(
                    slot=event["slot"],
                    value=event["value"],
                    state=event["state"],
                    attempt=event["attempt"],
                )

    async def final_object(self):
        async for event in self.events():
            if event["type"] == "done":
                return event["state"]
        raise RuntimeError("Slot object stream ended without a final object.")


def slot_object(
    model: type[BaseModel],
    *,
    prompt: Prompt | None = None,
    max_retries: int = 1,
) -> SlotObjectOutput:
    if not isinstance(model, type) or not issubclass(model, BaseModel):
        raise SlotFlightConfigurationError("slot_object() requires a Pydantic model.")

    slots = _infer_slots(model)
    if not slots:
        raise SlotFlightConfigurationError(
            "slot_object() requires at least one field with a description."
        )
    return SlotObjectOutput(
        model=model,
        slots=slots,
        prompt=prompt,
        max_retries=max_retries,
    )


def create_slot_object_stream(
    *,
    output: SlotObjectOutput,
    generate: SlotGenerator,
    prompt: Prompt | None = None,
    max_retries: int | None = None,
) -> SlotObjectStream:
    def create_flight() -> SlotFlight:
        return SlotFlight(
            slots=output.slots,
            generate=generate,
            prompt=prompt if prompt is not None else output.prompt,
            max_retries=max_retries if max_retries is not None else output.max_retries,
            validate_final=output.model,
        )

    return SlotObjectStream(create_flight)


def _infer_slots(model: type[BaseModel], prefix: str = "") -> list[SlotDefinition]:
    slots: list[SlotDefinition] = []
    for name, field in model.model_fields.items():
        path = f"{prefix}.{name}" if prefix else name
        annotation = field.annotation
        description = field.description

        if description:
            slots.append(
                SlotDefinition(
                    path=path,
                    prompt=description,
                    validate=TypeAdapter(annotation).validate_python,
                    mode=_slot_mode(annotation),
                )
            )
            continue

        nested = _model_type(annotation)
        if nested is not None:
            slots.extend(_infer_slots(nested, path))
            continue

        raise SlotFlightConfigurationError(
            f'Pydantic field "{path}" must use Field(description=...) '
            "to become a slot."
        )
    return slots


def _slot_mode(annotation: Any) -> SlotMode:
    if _is_text_annotation(annotation):
        return "text"
    return "json"


def _is_text_annotation(annotation: Any) -> bool:
    if annotation is str:
        return True

    origin = get_origin(annotation)
    if origin is Literal:
        args = get_args(annotation)
        return bool(args) and all(isinstance(arg, str) for arg in args)

    if isinstance(annotation, type) and issubclass(annotation, str):
        return True
    if isinstance(annotation, type) and issubclass(annotation, Enum):
        return issubclass(annotation, str)
    return False


def _model_type(annotation: Any) -> type[BaseModel] | None:
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return annotation
    return None
