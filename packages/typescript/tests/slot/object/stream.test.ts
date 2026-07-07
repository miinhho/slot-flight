import { describe, expect, it } from "bun:test";
import { z } from "zod";
import type { SlotGenerator } from "../../../src/core.js";
import { slotFlight } from "../../../src/core.js";
import { createSlotObjectStream, slotObject } from "../../../src/slot/index.js";
import { collectEvents, firstSlot } from "../../helpers.js";

describe("SlotObjectStream views", () => {
  it("exposes low-level slot events", async () => {
    const generate: SlotGenerator = async function* (request) {
      const slot = firstSlot(request);
      yield `<${slot.id}>ok\n</${slot.id}>`;
    };

    const stream = slotObjectStreamFromGenerator(generate);
    const events = await collectEvents(stream.slotEventStream);

    expect(events.map((event) => event.type)).toEqual([
      "slot-start",
      "slot-delta",
      "slot-complete",
      "done"
    ]);
  });

  it("keeps described nested objects structured during partial streaming", async () => {
    const generate: SlotGenerator = async function* (request) {
      const audience = request.slots.find(
        (slot) => slot.path === "metadata.audience"
      );
      const priority = request.slots.find(
        (slot) => slot.path === "metadata.priority"
      );
      expect(audience).toBeDefined();
      expect(priority).toBeDefined();

      yield `<${audience?.id}>backend`;
      yield ` engineers\n</${audience?.id}>`;
      yield `<${priority?.id}>high\n</${priority?.id}>`;
    };

    const stream = createSlotObjectStream<{
      metadata: { audience: string; priority: "low" | "high" };
    }>(
      slotFlight({
        schema: z.object({
          metadata: z
            .object({
              audience: z.string().min(1),
              priority: z.enum(["low", "high"])
            })
            .describe("Write the metadata object.")
        }),
        generate,
        slots: slotObject({
          schema: z.object({
            metadata: z
              .object({
                audience: z.string().min(1),
                priority: z.enum(["low", "high"])
              })
              .describe("Write the metadata object.")
          })
        }).slots
      }).run()
    );

    const partials: unknown[] = [];
    for await (const partial of stream.partialObjectStream) {
      partials.push(partial);
    }

    expect(partials).toContainEqual({
      metadata: { audience: "backend engineers" }
    });
    expect(partials).toContainEqual({
      metadata: { audience: "backend engineers", priority: "high" }
    });
  });
});

function slotObjectStreamFromGenerator(generate: SlotGenerator) {
  return createSlotObjectStream(
    slotFlight({
      schema: z.object({ status: z.string().min(1) }),
      generate,
      slots: [{ path: "status", schema: z.string().min(1) }]
    }).run()
  );
}
