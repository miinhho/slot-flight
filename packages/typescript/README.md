# slot-flight TypeScript

TypeScript SDK for slot-wise LLM value streaming with server-owned JSON
assembly.

Full TypeScript SDK notes live in the
[TypeScript SDK guide](../../docs/typescript/README.md).

```sh
bun add slot-flight zod
```

```ts
import OpenAI from "openai";
import { z } from "zod";
import { slotObject } from "slot-flight";
import { streamSlotObject } from "slot-flight/adapters/openai";

const openai = new OpenAI({ apiKey: process.env.API_KEY });

const stream = streamSlotObject({
  client: openai,
  model: "gpt-4.1-mini",
  messages: [{ role: "user", content: "Classify this feedback." }],
  output: slotObject({
    schema: z.object({
      summary: z.string().min(1).describe("Write one concise summary."),
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

Objects and arrays are expanded into structural slots such as
`metadata.audience`, `tags[]`, and `sections[].heading`; the model emits raw
slot values in indexed repeat frames such as `<2:0>...</2:0>`, while the engine
maps those indexes to JSON paths and owns final assembly.

`streamSlotObject()` exposes one live model run through several views:

- `completedSlotStream`: validated slot values, one event per completed slot.
- `slotEventStream`: low-level slot lifecycle events, including raw draft
  deltas before validation.
- `partialObjectStream`: draft object snapshots for low-level consumers. Values
  may include raw, unvalidated slot text before a slot completes.
- `finalObject`: final Zod-validated object.
- `toResponse()`: SSE or NDJSON over completed slot output, partial snapshots,
  or raw slot events.

Choose one live view per run. After a live view finishes, `finalObject` can
still be awaited for the validated result.

Low-level events can drive draft UI:

```ts
for await (const event of stream.slotEventStream) {
  if (event.type === "slot-delta") {
    renderDraft(event.slot, event.value);
  }
  if (event.type === "slot-complete") {
    commitField(event.slot, event.value);
  }
  if (event.type === "slot-retry") {
    clearDraft(event.slot);
  }
}
```

Use `stream.toResponse({ source: "events" })` or
`stream.toReadableStream({ source: "events" })` when an HTTP stream needs raw
slot lifecycle events instead of completed slots.

Provider adapters are available from:

- `slot-flight/adapters/openai`
- `slot-flight/adapters/vercel`
- `slot-flight/adapters/stream`

Advanced engine usage is available from `slot-flight/core`.
