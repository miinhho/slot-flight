# slot-flight Python

Python SDK for slot-wise LLM value streaming with server-owned JSON assembly.

This package implements the same slot frame protocol used by the TypeScript SDK.
The core engine is provider-independent, and the public object API is Pydantic
first. Provider/framework adapters are available for the OpenAI SDK,
OpenAI-compatible HTTP endpoints, and LangChain. Runnable examples live in
`examples/`.

Full Python SDK notes live in the
[Python SDK guide](../../docs/python/README.md).

```py
import os

from openai import AsyncOpenAI
from pydantic import BaseModel, Field
from slot_flight import slot_object
from slot_flight.adapters.openai import stream_slot_object


class Triage(BaseModel):
    summary: str = Field(description="Write one concise operational summary.")
    tags: list[str] = Field(description="Write a JSON array of exactly 3 tags.")


openai = AsyncOpenAI(
    api_key=os.getenv("API_KEY"),
    base_url=os.getenv("API_BASE_URL"),
)

stream = stream_slot_object(
    client=openai,
    model=os.getenv("MODEL", "openai/gpt-oss-20b"),
    messages=[{"role": "user", "content": "Classify this feedback."}],
    output=slot_object(Triage),
)

async for slot in stream.completed_slot_stream():
    print(slot.slot, slot.value)

result = await stream.final_object()
```

## Slot Object API

`slot_object()` accepts a Pydantic v2 model. Every generated leaf field must use
`Field(description=...)`; that description becomes the model-facing instruction
for the slot.

```py
class Triage(BaseModel):
    summary: str = Field(description="Write one concise operational summary.")
    tags: list[str] = Field(description="Write a JSON array of exactly 3 tags.")
```

String fields, string enums, and string literals use text slots. Other described
fields use JSON slots and are parsed before Pydantic validates the value. A
nested model without its own field description is expanded into nested slots; a
nested model with a description becomes one JSON slot.

Failed slot validation retries only the failed slots up to `max_retries`:

```py
output = slot_object(Triage, max_retries=1)
```

The object stream exposes the same views as the TypeScript SDK, using Python
method names:

```py
async for event in stream.slot_event_stream():
    ...

async for partial in stream.partial_object_stream():
    ...

async for chunk in stream.to_sse(source="completed"):
    ...

async for line in stream.to_ndjson(source="events"):
    ...
```

`final_object()`, `completed_slot_stream()`, `partial_object_stream()`, and
`slot_event_stream()` consume one underlying model run. After the run finishes,
later consumers replay cached events. A second live consumer is rejected while a
run is still active.

If you already have a slot event stream, wrap it with
`create_slot_object_event_stream()` to reuse the same object-stream views:

```py
from slot_flight import create_slot_object_event_stream

stream = create_slot_object_event_stream(existing_events)
```

## HTTP Streaming

`to_sse()` and `to_ndjson()` are framework-neutral async iterators. In FastAPI or
Starlette, pass them to `StreamingResponse`:

```py
from starlette.responses import StreamingResponse


async def route():
    stream = stream_slot_object(...)
    return StreamingResponse(
        stream.to_sse(source="completed"),
        media_type="text/event-stream",
    )
```

`source="completed"` emits completed slot updates plus retry/error/done events.
`source="partial"` emits draft object snapshots. `source="events"` emits the
low-level slot lifecycle events.

## Examples

```sh
uv run --extra openai examples/openai_compatible.py
uv run --extra openai-compatible examples/openai_compatible_httpx.py
uv run --extra langchain examples/langchain_runnable.py
```

The OpenAI SDK example and raw OpenAI-compatible HTTP example both work with
endpoints such as NVIDIA NIM: set `API_KEY`, `API_BASE_URL`, and `MODEL` as
shown in the root `.env.example`. The raw HTTP adapter uses a bounded HTTPX
timeout by default; pass `timeout=None` to disable it, or pass a custom
`httpx.AsyncClient` as `client` when you want to own HTTP settings directly.

## Development

```sh
uv sync --all-extras --dev
uv run ruff check .
uv run ty check
uv run pytest
uv build
```
