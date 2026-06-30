from __future__ import annotations

from dataclasses import dataclass

from ...types import SlotDefinition


@dataclass(frozen=True)
class CompiledSlot:
    definition: SlotDefinition
    path: str


@dataclass
class SlotAttemptOutcome:
    completed: set[str]
    failures: dict[str, Exception]
