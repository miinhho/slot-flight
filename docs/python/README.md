# Python SDK

Python SDK for slot-wise LLM value streaming with server-owned JSON assembly.

The Python package is Pydantic-first. Provider/framework adapters are available
for the OpenAI SDK, OpenAI-compatible HTTP endpoints, and LangChain.

## Install

```sh
uv add slot-flight
uv add "slot-flight[openai]"
uv add "slot-flight[openai-compatible]"
uv add "slot-flight[langchain]"
```

## Object API

`slot_object()` accepts a Pydantic v2 model. Every generated leaf field must use
`Field(description=...)`; that description becomes the model-facing instruction
for the slot.

```py
from pydantic import BaseModel, Field
from slot_flight import slot_object


class Triage(BaseModel):
    summary: str = Field(description="Write one concise operational summary.")
    tags: list[str] = Field(description="Write exactly 3 tags, one per frame.")


output = slot_object(Triage, max_retries=1)
```

The model always emits raw slot values, not JSON objects or arrays. Pydantic
objects and arrays are expanded into structural slots such as
`metadata.audience`, `tags[]`, and `sections[].heading`; repeat values use
indexed frames such as `<2:0>...</2:0>`, and the engine maps those indexes to
JSON paths during assembly.

Failed slot validation retries only the failed slots up to `max_retries`.

## Stream Views

Python keeps method-style APIs while matching the TypeScript stream concepts:

```py
async for slot in stream.completed_slot_stream():
    print(slot.slot, slot.value)

async for partial in stream.partial_object_stream():
    ...

async for event in stream.slot_event_stream():
    ...

result = await stream.final_object()
```

`final_object()`, `completed_slot_stream()`, `partial_object_stream()`, and
`slot_event_stream()` consume one underlying model run. After the run finishes,
later consumers replay cached events. A second live consumer is rejected while a
run is still active.

If you already have a slot event stream, wrap it with
`create_slot_object_event_stream()`:

```py
from slot_flight import create_slot_object_event_stream

stream = create_slot_object_event_stream(existing_events)
```

## HTTP Streaming

`to_sse()` and `to_ndjson()` are framework-neutral async iterators.

```py
from starlette.responses import StreamingResponse


async def route():
    stream = stream_slot_object(...)
    return StreamingResponse(
        stream.to_sse(source="completed"),
        media_type="text/event-stream",
    )
```

Stream sources:

- `completed`: completed slot updates plus retry/error/done events
- `partial`: draft object snapshots
- `events`: low-level slot lifecycle events

## Adapters

OpenAI SDK:

```py
from openai import AsyncOpenAI
from slot_flight.adapters.openai import stream_slot_object

client = AsyncOpenAI(api_key=os.getenv("API_KEY"), base_url=os.getenv("API_BASE_URL"))
stream = stream_slot_object(
    client=client,
    model=os.getenv("MODEL", "openai/gpt-oss-20b"),
    messages=[{"role": "user", "content": "Classify this feedback."}],
    output=slot_object(Triage),
)
```

OpenAI-compatible HTTP without the OpenAI SDK:

```py
from slot_flight.adapters.openai_compatible import stream_slot_object

stream = stream_slot_object(
    base_url=os.getenv("API_BASE_URL", "https://integrate.api.nvidia.com/v1"),
    api_key=os.getenv("API_KEY"),
    model=os.getenv("MODEL", "minimaxai/minimax-m3"),
    messages=[{"role": "user", "content": "Classify this feedback."}],
    output=slot_object(Triage),
    timeout=60.0,
)
```

The raw HTTP adapter creates an `httpx.AsyncClient` with a bounded timeout by
default. Pass `timeout=None` to disable that timeout, or pass your own
`client` when you want to own HTTPX timeouts, limits, proxies, or transport
configuration directly.

LangChain:

```py
from slot_flight.adapters.langchain import stream_slot_object

stream = stream_slot_object(
    runnable=chat_model,
    messages=[("human", "Classify this feedback.")],
    output=slot_object(Triage),
)
```
