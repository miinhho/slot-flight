from __future__ import annotations

import asyncio
import os

from anthropic import AsyncAnthropic
from pydantic import BaseModel, Field

from slot_flight import slot_object
from slot_flight.adapters.anthropic import stream_slot_object


class ReleaseNote(BaseModel):
    title: str = Field(description="Write a short release note title.")
    audience: str = Field(description="Write the primary reader audience.")
    changes: list[str] = Field(description="Write a JSON array of exactly 3 changes.")


async def main() -> None:
    client = AsyncAnthropic()
    output = slot_object(ReleaseNote)

    stream = stream_slot_object(
        client=client,
        model=os.getenv("ANTHROPIC_MODEL", "claude-3-5-haiku-latest"),
        messages=[
            {
                "role": "user",
                "content": """
Draft release note fields from this changelog:

- Added provider stream cleanup on early cancellation.
- Strengthened OpenAI, Anthropic, and LangChain adapter contract tests.
- Kept slot-wise JSON assembly server-owned.
""",
            }
        ],
        output=output,
        max_tokens=512,
    )

    async for slot in stream.completed_slots():
        print(slot.slot, slot.value)

    result = await stream.final_object()
    print(result.model_dump_json(indent=2))


if __name__ == "__main__":
    asyncio.run(main())
