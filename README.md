# slot-flight

Slot-wise LLM value streaming with server-owned JSON assembly.

`slot-flight` does not ask the model to stream a valid JSON document. The model
streams compact slot frames, and an SDK maps those frame ids to JSON paths,
validates each value, retries failed slots, and assembles the final object
itself.

```text
<1>Alice</1>
<2>Senior Engineer</2>
<3>Builds streaming JSON assembly engines.</3>
```

## Repository Layout

This repository is organized as a multi-language SDK workspace:

- `docs/protocol`: language-neutral slot frame protocol
- `packages/typescript`: TypeScript SDK and provider adapters
- `packages/python`: Python SDK core

Each SDK should keep the same protocol behavior while using language-native
schema and provider integration patterns.

## TypeScript

```sh
bun add slot-flight zod
```

Provider SDKs stay in your application:

```sh
bun add openai
# or
bun add ai @ai-sdk/openai
```

Define the output shape with Zod. Every generated field is registered through
`.describe()`, which becomes the model-facing slot instruction.

```ts
import OpenAI from "openai";
import { z } from "zod";
import { slotObject } from "slot-flight";
import { streamSlotObject } from "slot-flight/adapters/openai";

const openai = new OpenAI({
  apiKey: process.env.API_KEY,
  baseURL: "https://integrate.api.nvidia.com/v1"
});

const stream = streamSlotObject({
  client: openai,
  model: "openai/gpt-oss-20b",
  messages: [
    {
      role: "user",
      content: "Classify this customer support feedback for a triage queue."
    }
  ],
  temperature: 0.2,
  output: slotObject({
    schema: z.object({
      summary: z
        .string()
        .min(1)
        .describe("Write one concise operational summary."),
      sentiment: z
        .enum(["positive", "neutral", "negative", "mixed"])
        .describe("Write exactly one of: positive, neutral, negative, mixed."),
      priority: z
        .enum(["low", "medium", "high"])
        .describe("Write exactly one of: low, medium, high.")
    })
  })
});

for await (const slot of stream.completedSlotStream) {
  console.log(slot.slot, slot.value);
}

const finalObject = await stream.finalObject;
```

TypeScript-specific docs and examples live in
`packages/typescript`.

## Python

The Python SDK provides a Pydantic-first object API plus provider/framework
adapters for OpenAI, Anthropic, and LangChain.

```py
from pydantic import BaseModel, Field
from slot_flight import slot_object


class Triage(BaseModel):
    summary: str = Field(description="Write one concise operational summary.")
    tags: list[str] = Field(description="Write a JSON array of exactly 3 tags.")


output = slot_object(Triage)
```

Python package details live in `packages/python`.

## Protocol

The shared protocol is documented in
`docs/protocol/slot-frame-protocol.md`.

## Development

```sh
cd packages/typescript
bun run test
bun run typecheck
bun run build
```

Language-specific checks:

```sh
(cd packages/typescript && bun run test)
(cd packages/python && uv sync --all-extras --dev)
(cd packages/python && uv run ruff check .)
(cd packages/python && uv run pytest)
```

CI is split by changed paths:

- TypeScript CI runs for `packages/typescript/**`, shared protocol docs, and
  TypeScript workflow changes.
- Python CI runs for `packages/python/**`, shared protocol docs, and Python
  workflow changes.

Release tags are language-scoped:

- `typescript-v*` publishes `packages/typescript` to npm.
- `python-v*` builds and publishes `packages/python` to PyPI.
