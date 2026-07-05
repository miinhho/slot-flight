from __future__ import annotations

from dataclasses import dataclass
from typing import Any, get_args, get_origin

from pydantic import BaseModel, TypeAdapter

from ...errors import SlotFlightConfigurationError
from ...types import Prompt, SlotDefinition, SlotGenerator
from ..execution import SlotFlight
from .stream import SlotObjectStream


@dataclass(frozen=True)
class SlotObjectOutput:
    model: type[BaseModel]
    slots: list[SlotDefinition]
    prompt: Prompt | None = None
    max_retries: int = 1


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
    def create_events():
        return SlotFlight(
            slots=output.slots,
            generate=generate,
            prompt=prompt if prompt is not None else output.prompt,
            max_retries=max_retries if max_retries is not None else output.max_retries,
            validate_final=output.model,
        ).run()

    return SlotObjectStream(create_events)


def _infer_slots(
    model: type[BaseModel],
    prefix: str = "",
    inherited_prompts: tuple[str, ...] = (),
) -> list[SlotDefinition]:
    slots: list[SlotDefinition] = []
    for name, field in model.model_fields.items():
        path = f"{prefix}.{name}" if prefix else name
        annotation = field.annotation
        prompts = inherited_prompts
        if field.description:
            prompts = (*prompts, field.description)

        slots.extend(
            _infer_annotation_slots(
                annotation=annotation,
                path=path,
                prompts=prompts,
            )
        )
    return slots


def _infer_annotation_slots(
    *,
    annotation: Any,
    path: str,
    prompts: tuple[str, ...],
) -> list[SlotDefinition]:
    nested = _model_type(annotation)
    if nested is not None:
        return _infer_slots(nested, path, prompts)

    item_annotation = _list_item_annotation(annotation)
    if item_annotation is not None:
        nested_item = _model_type(item_annotation)
        if nested_item is not None:
            return _infer_slots(nested_item, f"{path}[]", prompts)
        if _list_item_annotation(item_annotation) is not None:
            raise SlotFlightConfigurationError(
                f'Array field "{path}" cannot infer structural slots '
                "for nested array items."
            )
        return _leaf_slot(
            path=f"{path}[]",
            annotation=item_annotation,
            prompts=prompts,
        )

    return _leaf_slot(path=path, annotation=annotation, prompts=prompts)


def _leaf_slot(
    *,
    path: str,
    annotation: Any,
    prompts: tuple[str, ...],
) -> list[SlotDefinition]:
    prompt = "\n".join(prompts)
    if prompt == "":
        raise SlotFlightConfigurationError(
            f'Pydantic field "{path}" must use Field(description=...) '
            "to become a slot."
        )
    return [
        SlotDefinition(
            path=path,
            prompt=prompt,
            validate=TypeAdapter(annotation).validate_python,
        )
    ]


def _list_item_annotation(annotation: Any) -> Any | None:
    origin = get_origin(annotation)
    if origin is list:
        args = get_args(annotation)
        return args[0] if args else Any
    return None


def _model_type(annotation: Any) -> type[BaseModel] | None:
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return annotation
    return None
