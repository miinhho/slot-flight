from __future__ import annotations

import asyncio
import os

from pydantic import BaseModel, Field

from slot_flight import slot_object
from slot_flight.adapters.openai_compatible import stream_slot_object


class Triage(BaseModel):
    summary: str = Field(description="Write one concise operational summary.")
    priority: str = Field(description="Write exactly one of: low, medium, high.")
    tags: list[str] = Field(description="Write a JSON array of exactly 3 tags.")


async def main() -> None:
    api_key = os.getenv("API_KEY")
    if not api_key:
        raise RuntimeError("Set API_KEY")

    stream = stream_slot_object(
        base_url=os.getenv("API_BASE_URL", "https://integrate.api.nvidia.com/v1"),
        api_key=api_key,
        model=os.getenv("MODEL", "minimaxai/minimax-m3"),
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
        output=slot_object(Triage),
        max_tokens=8192,
        temperature=1,
        top_p=0.95,
    )

    async for slot in stream.completed_slot_stream():
        print(slot.slot, slot.value)

    result = await stream.final_object()
    print(result.model_dump_json(indent=2))


if __name__ == "__main__":
    asyncio.run(main())
