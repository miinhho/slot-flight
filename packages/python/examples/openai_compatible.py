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
    client = _create_client()
    output = slot_object(Triage)

    stream = stream_slot_object(
        client=client,
        model=os.getenv("MODEL") or os.getenv("OPENAI_MODEL", "openai/gpt-oss-20b"),
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
        max_tokens=4096,
        temperature=1,
        top_p=1,
    )

    async for slot in stream.completed_slots():
        print(slot.slot, slot.value)

    result = await stream.final_object()
    print(result.model_dump_json(indent=2))


def _create_client() -> AsyncOpenAI:
    api_key = _first_env("API_KEY", "NVIDIA_API_KEY", "OPENAI_API_KEY")
    base_url = _first_env("API_BASE_URL", "OPENAI_BASE_URL")

    if api_key and base_url:
        return AsyncOpenAI(api_key=api_key, base_url=base_url)
    if api_key:
        return AsyncOpenAI(api_key=api_key)
    if base_url:
        return AsyncOpenAI(base_url=base_url)
    return AsyncOpenAI()


def _first_env(*names: str) -> str | None:
    for name in names:
        value = os.getenv(name)
        if value:
            return value
    return None


if __name__ == "__main__":
    asyncio.run(main())
