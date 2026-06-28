# slot-flight

Slot-wise LLM value streaming with server-owned JSON assembly.

`slot-flight` does not ask the model to stream a valid JSON document. The model
streams compact slot frames, and the server maps those frame ids to JSON paths,
validates each value with Zod, retries failed slots, and assembles the final
object itself.

```text
<1>Alice</1>
<2>Senior Engineer</2>
<3>Builds streaming JSON assembly engines.</3>
```

## Install

```sh
bun add slot-flight zod
```

Provider SDKs stay in your application:

```sh
bun add openai
# or
bun add ai @ai-sdk/openai
```

## Quick Start

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

## Schema Contract

`slotObject()` uses the Zod schema as the single source of truth.

- Fields with `.describe()` become slots.
- Nested objects without `.describe()` are traversed until described fields are
  found.
- Described arrays and described objects become JSON slots, so coordinated
  structured values are generated and validated as one value.
- Fields without `.describe()` are rejected instead of silently inventing
  prompts.

```ts
const output = slotObject({
  schema: z.object({
    title: z.string().min(1).describe("Write a short title."),
    metadata: z.object({
      audience: z.string().describe("Write the intended audience.")
    }),
    tags: z
      .array(z.string().min(1))
      .length(3)
      .describe("Write a JSON array of exactly 3 short tags.")
  })
});
```

Text slots are treated as raw values. JSON slots are parsed with `JSON.parse()`
before Zod validation.

## Adapters

### OpenAI-Compatible

```ts
import { streamSlotObject } from "slot-flight/adapters/openai";

const stream = streamSlotObject({
  client: openai,
  model: "openai/gpt-oss-20b",
  messages,
  output
});
```

The OpenAI adapter keeps the call shaped like a normal
`chat.completions.create` request. It forces `stream: true`, appends the
generated slot-frame prompt as the final message, passes `AbortSignal` into the
SDK call, and extracts `choices[].delta.content`.

Optional client enhancer:

```ts
import { withSlotFlight } from "slot-flight/adapters/openai";

const client = withSlotFlight(openai);
const stream = client.chat.completions.streamSlotObject({
  model: "openai/gpt-oss-20b",
  messages,
  output
});
```

### Vercel AI SDK

```ts
import { streamText } from "ai";
import { streamSlotObject } from "slot-flight/adapters/vercel";

const stream = streamSlotObject({
  streamText,
  model,
  messages,
  output
});
```

The Vercel adapter keeps `streamText` as the generation primitive and consumes
its `textStream`.

### Generic Streams

For any SDK that returns async chunks:

```ts
import { createChunkStreamGenerator } from "slot-flight/adapters/stream";

const generate = createChunkStreamGenerator({
  stream: (request) => someSdk.stream({ prompt: request.prompt }),
  text: (chunk) => chunk.text
});
```

Advanced engine usage is available from `slot-flight/core` when you want to
provide your own `SlotGenerator` directly.

## Stream Outputs

`streamSlotObject()` returns a `SlotObjectStream`:

- `completedSlotStream`: validated slot values, one event per completed slot.
- `finalObject`: final Zod-validated object.
- `toResponse()`: SSE or NDJSON over completed slot output.
- `debug`: partial snapshots and low-level slot events.

Each `SlotObjectStream` owns one live model run. Choose one live view per run:
`completedSlotStream`, `toResponse()`, one `debug` stream, or `finalObject` by
itself. After a live view finishes, `finalObject` can still be awaited for the
validated result.

For HTTP handlers:

```ts
export async function POST() {
  const stream = streamSlotObject({
    client: openai,
    model: "openai/gpt-oss-20b",
    messages,
    output
  });

  return stream.toResponse();
}
```

`toResponse()` defaults to SSE over completed slots. Use
`stream.toResponse({ format: "ndjson" })` for newline-delimited JSON.

Low-level events are intentionally behind `debug`:

```ts
for await (const event of stream.debug.slotEventStream) {
  console.log(event.type);
}
```

## Reliability Scope

`slot-flight` owns reliability only where it has slot-level information:

- retry failed or missing slots after parsing and Zod validation
- retry recoverable slot protocol failures such as an unfinished frame
- cancel one frame stream through `AbortSignal`

It does not implement provider retry policy, backoff, rate limiting, queues,
failover, or agent orchestration. Leave those in your LLM SDK or application
workflow.

## Custom Errors

Custom error classes are exported from `slot-flight/core` for consumers that
need to branch on engine failures:

```ts
import {
  SlotFlightError,
  SlotFlightJsonParseError,
  SlotFlightValidationError
} from "slot-flight/core";
```

Use these for slot-level failures reported by the engine. Adapter shape errors
remain normal `TypeError`s, caller cancellation remains an `AbortError`, and
provider stream failures are surfaced without provider retry policy.