# slot-flight TypeScript

TypeScript SDK for slot-wise LLM value streaming with server-owned JSON
assembly.

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

Provider adapters are available from:

- `slot-flight/adapters/openai`
- `slot-flight/adapters/vercel`
- `slot-flight/adapters/stream`

Advanced engine usage is available from `slot-flight/core`.
