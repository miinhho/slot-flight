from __future__ import annotations

import asyncio
import os

from openai import AsyncOpenAI
from pydantic import BaseModel, Field

from slot_flight import slot_object
from slot_flight.adapters.openai import stream_slot_object


class Triage(BaseModel):
    summary: str = Field(description="Write one concise operational summary.")
    priority: str = Field(description="Write exactly one of: low, medium, high.")
    tags: list[str] = Field(description="Write a JSON array of exactly 3 tags.")


async def main() -> None:
    client = AsyncOpenAI()
    output = slot_object(Triage)

    stream = stream_slot_object(
        client=client,
        model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
        messages=[
            {
                "role": "user",
                "content": """
Classify this customer feedback for the support triage queue:

The export job has failed twice today. The dashboard still shows stale data,
and the customer needs a reliable ETA before their billing review.
""",
            }
        ],
        output=output,
        temperature=0.2,
    )

    async for slot in stream.completed_slots():
        print(slot.slot, slot.value)

    result = await stream.final_object()
    print(result.model_dump_json(indent=2))


if __name__ == "__main__":
    asyncio.run(main())
