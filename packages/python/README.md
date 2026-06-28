# slot-flight Python

Python SDK for slot-wise LLM value streaming with server-owned JSON assembly.

This package implements the same slot frame protocol used by the TypeScript SDK.
The core engine is provider-independent: pass an async generator that yields text
chunks, and `SlotFlight` parses frames, validates slot values, retries failed
slots, and assembles the final object.

```py
from slot_flight import SlotDefinition, SlotFlight


async def generate(request):
    for slot in request.slots:
        yield f"<{slot.id}>Alice</{slot.id}>"


flight = SlotFlight(
    slots=[
        SlotDefinition(
            path="name",
            prompt="Write the person's name.",
            validate=lambda value: str(value),
        )
    ],
    generate=generate,
)

async for event in flight.run():
    print(event)
```
