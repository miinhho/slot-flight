from __future__ import annotations

import asyncio

from langchain_core.runnables import RunnableLambda
from pydantic import BaseModel, Field

from slot_flight import slot_object
from slot_flight.adapters.langchain import stream_slot_object


class Summary(BaseModel):
    title: str = Field(description="Write a short title.")
    bullets: list[str] = Field(description="Write a JSON array of exactly 3 bullets.")


async def main() -> None:
    output = slot_object(Summary)

    runnable = RunnableLambda(
        lambda messages: "<1>Adapter contract</1><2>["
        '"uses LangChain Runnable streams",'
        '"keeps JSON assembly server-owned",'
        '"works with provider chat models"'
        "]</2>"
    )

    stream = stream_slot_object(
        runnable=runnable,
        messages=[
            (
                "human",
                """
Summarize the adapter behavior for a Python SDK user.
""",
            )
        ],
        output=output,
    )

    async for slot in stream.completed_slots():
        print(slot.slot, slot.value)

    result = await stream.final_object()
    print(result.model_dump_json(indent=2))


if __name__ == "__main__":
    asyncio.run(main())
