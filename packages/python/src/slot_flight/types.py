from __future__ import annotations

from collections.abc import AsyncIterable, Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal, TypeAlias

SlotMode: TypeAlias = Literal["text", "json"]
Validator: TypeAlias = Callable[[Any], Any]
PromptFactory: TypeAlias = Callable[["SlotFrameRequest"], str]
Prompt: TypeAlias = str | Callable[["SlotFlightRequest"], str]
SlotGenerator: TypeAlias = Callable[
    ["SlotFlightRequest"], AsyncIterable[str] | Awaitable[AsyncIterable[str]]
]


@dataclass(frozen=True)
class SlotDefinition:
    path: str
    prompt: str | PromptFactory = ""
    validate: Validator | None = None
    mode: SlotMode = "text"
    count: int | None = None
    max_retries: int | None = None


@dataclass(frozen=True)
class SlotFrameRequest:
    id: str
    path: str
    template_path: str
    prompt: str
    attempt: int
    mode: SlotMode


@dataclass(frozen=True)
class SlotFlightRequest:
    prompt: str
    slots: list[SlotFrameRequest]
    attempt: int
