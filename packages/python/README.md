# slot-flight Python

Python SDK for slot-wise LLM value streaming with server-owned JSON assembly.

This package implements the same slot frame protocol used by the TypeScript SDK.
The core engine is provider-independent, and the public object API is Pydantic
first. Provider/framework adapters are available for OpenAI, Anthropic, and
LangChain.

```py
from openai import AsyncOpenAI
from pydantic import BaseModel, Field
from slot_flight import slot_object
from slot_flight.adapters.openai import stream_slot_object


class Triage(BaseModel):
    summary: str = Field(description="Write one concise operational summary.")
    tags: list[str] = Field(description="Write a JSON array of exactly 3 tags.")


openai = AsyncOpenAI()

stream = stream_slot_object(
    client=openai,
    model="gpt-4.1-mini",
    messages=[{"role": "user", "content": "Classify this feedback."}],
    output=slot_object(Triage),
)

result = await stream.final_object()
```

## Development

```sh
uv sync --all-extras --dev
uv run ruff check .
uv run ty check
uv run pytest
uv build
```
