from __future__ import annotations

import copy
from typing import Any


def snapshot_state(state: dict[str, Any]) -> dict[str, Any]:
    # Events expose immutable snapshots from the consumer's point of view; the
    # engine keeps mutating its internal state as later slots complete.
    return copy.deepcopy(state)
