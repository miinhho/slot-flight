# slot-flight Python

Python SDK for slot-wise LLM value streaming with server-owned JSON assembly.

This package implements the same slot frame protocol used by the TypeScript SDK.
The core engine is provider-independent, and the public object API is Pydantic
first. Provider/framework adapters are available for OpenAI, Anthropic, and
LangChain. Runnable examples live in `examples/`.

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
    api_key=(
        os.getenv("API_KEY")
        or os.getenv("NVIDIA_API_KEY")
        or os.getenv("OPENAI_API_KEY")
    ),
    base_url=os.getenv("API_BASE_URL") or os.getenv("OPENAI_BASE_URL"),
)

stream = stream_slot_object(
    client=openai,
    model=os.getenv("MODEL", "openai/gpt-oss-20b"),
    messages=[{"role": "user", "content": "Classify this feedback."}],
    output=slot_object(Triage),
)

result = await stream.final_object()
```

## Examples

```sh
uv run --extra openai examples/openai_compatible.py
uv run --extra anthropic examples/anthropic_sdk.py
uv run --extra langchain examples/langchain_runnable.py
```

The OpenAI example works with OpenAI-compatible endpoints such as NVIDIA NIM:
set `API_KEY`, `API_BASE_URL`, and `MODEL` as shown in the root `.env.example`.

## Development

```sh
uv sync --all-extras --dev
uv run ruff check .
uv run ty check
uv run pytest
uv build
```
