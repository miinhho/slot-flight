from __future__ import annotations

from dataclasses import dataclass

from ...types import SlotDefinition, SlotRepeat


@dataclass(frozen=True)
class CompiledSlot:
    definition: SlotDefinition
    path: str
    repeat: SlotRepeat = "none"
    array_path: str | None = None


@dataclass
class SlotAttemptOutcome:
    completed: set[str]
    failures: dict[str, Exception]
