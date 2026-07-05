# slot-flight

Slot-wise LLM value streaming with server-owned JSON assembly.

`slot-flight` does not ask the model to stream a valid JSON document. The model
streams compact slot frames, and an SDK maps those frame ids to JSON paths,
validates each value, retries failed slots, and assembles the final object
itself.

```text
<1>
Alice
</1>
<2>
Senior Engineer
</2>
<3:0>
streaming
</3:0>
<3:1>
json assembly
</3:1>
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

TypeScript-specific docs and examples live in the
[TypeScript SDK guide](docs/typescript/README.md) and `packages/typescript`.

## Python

```sh
uv add slot-flight
```

Optional adapter dependencies:
```sh 
uv add "slot-flight[openai]"
uv add "slot-flight[openai-compatible]"
uv add "slot-flight[langchain]"
```


The Python SDK provides a Pydantic-first object API plus provider/framework
adapters for the OpenAI SDK, OpenAI-compatible HTTP endpoints, and LangChain.

```py
from pydantic import BaseModel, Field
from slot_flight import slot_object
from slot_flight.adapters.openai import stream_slot_object


class Triage(BaseModel):
    summary: str = Field(description="Write one concise operational summary.")
    tags: list[str] = Field(description="Write exactly 3 tags, one per frame.")


stream = stream_slot_object(
    client=openai,
    model="gpt-4.1-mini",
    messages=[{"role": "user", "content": "Classify this feedback."}],
    output=slot_object(Triage),
)

async for slot in stream.completed_slot_stream():
    print(slot.slot, slot.value)

result = await stream.final_object()
```

Python package details and provider examples live in the
[Python SDK guide](docs/python/README.md) and `packages/python`.

## Protocol

The shared protocol is documented in
`docs/protocol/slot-frame-protocol.md`.

## Contributing

Contribution, local verification, CI, and release notes are documented in
`CONTRIBUTING.md`.
