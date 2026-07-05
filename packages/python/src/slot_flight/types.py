from __future__ import annotations

from collections.abc import AsyncIterable, Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal, TypeAlias

Validator: TypeAlias = Callable[[Any], Any]
PromptFactory: TypeAlias = Callable[["SlotFrameRequest"], str]
Prompt: TypeAlias = str | Callable[["SlotFlightRequest"], str]
SlotRepeat: TypeAlias = Literal["none", "append", "item-field"]
SlotGenerator: TypeAlias = Callable[
    ["SlotFlightRequest"], AsyncIterable[str] | Awaitable[AsyncIterable[str]]
]


@dataclass(frozen=True)
class SlotDefinition:
    path: str
    prompt: str | PromptFactory = ""
    validate: Validator | None = None
    count: int | None = None
    max_retries: int | None = None


@dataclass(frozen=True)
class SlotFrameRequest:
    id: str
    path: str
    template_path: str
    prompt: str
    attempt: int
    repeat: SlotRepeat = "none"


@dataclass(frozen=True)
class SlotFlightRequest:
    prompt: str
    slots: list[SlotFrameRequest]
    attempt: int
