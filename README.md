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

The Python SDK currently provides the provider-independent core engine. It
accepts an async generator that yields text chunks, then parses slot frames,
validates values, retries failed slots, and emits progressive events.

```py
from slot_flight import SlotDefinition, SlotFlight


def non_empty_string(value):
    if not isinstance(value, str) or value == "":
        raise ValueError("expected non-empty string")
    return value


async def generate(request):
    values = {
        "summary": "Streaming JSON assembly without model-owned JSON.",
        "tags": '["llm", "json", "streaming"]',
    }
    for slot in request.slots:
        yield f"<{slot.id}>{values[slot.path]}</{slot.id}>"


flight = SlotFlight(
    slots=[
        SlotDefinition(
            path="summary",
            prompt="Write one concise operational summary.",
            validate=non_empty_string,
        ),
        SlotDefinition(
            path="tags",
            prompt="Write a JSON array of exactly 3 short tags.",
            mode="json",
            validate=lambda value: value,
        ),
    ],
    generate=generate,
)

async for event in flight.run():
    print(event)
```

Python package details live in `packages/python`.

## Protocol

The shared protocol is documented in
`docs/protocol/slot-frame-protocol.md`.

## Development

```sh
bun run test
bun run typecheck
bun run build
```
