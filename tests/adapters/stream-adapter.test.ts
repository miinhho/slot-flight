import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { createChunkStreamGenerator } from "../../src/adapters/stream.js";
import { slotFlight } from "../../src/core.js";
import { collectEvents } from "../helpers.js";

describe("stream adapter", () => {
  it("adapts arbitrary SDK chunks into a SlotGenerator", async () => {
    const generate = createChunkStreamGenerator({
      stream: async function* () {
        yield { text: "<1>Ali" };
        yield { text: "ce</1>" };
      },
      text: (chunk: { text: string }) => chunk.text
    });

    const events = await collectEvents(
      slotFlight({
        schema: z.object({ name: z.string().min(1) }),
        generate,
        slots: [{ path: "name", schema: z.string().min(1) }]
      }).run()
    );

    expect(events.at(-1)).toMatchObject({
      type: "done",
      state: { name: "Alice" }
    });
  });

  it("ignores chunks whose text extractor returns an empty string", async () => {
    const generate = createChunkStreamGenerator({
      stream: async function* () {
        yield { text: "<1>Ali" };
        yield { text: undefined };
        yield { text: "ce</1>" };
      },
      text: (chunk: { text?: string }) => chunk.text ?? ""
    });

    const events = await collectEvents(
      slotFlight({
        schema: z.object({ name: z.string().min(1) }),
        generate,
        slots: [{ path: "name", schema: z.string().min(1) }]
      }).run()
    );

    expect(events.at(-1)).toMatchObject({
      type: "done",
      state: { name: "Alice" }
    });
  });
});
