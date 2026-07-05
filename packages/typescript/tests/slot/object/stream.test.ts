import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { streamSlotObject } from "../../../src/adapters/vercel.js";
import type { SlotGenerator } from "../../../src/core.js";
import { slotFlight } from "../../../src/core.js";
import { createSlotObjectStream, slotObject } from "../../../src/slot/index.js";
import type { SlotFlightEvent } from "../../../src/types.js";
import { collectEvents, firstSlot, textChunks } from "../../helpers.js";

describe("SlotObjectStream web output", () => {
  it("returns an SSE Response for completed slots by default", async () => {
    const stream = streamSlotObject({
      streamText: () => ({
        textStream: textChunks([
          "<1>Delayed first field.\n</1>",
          "<2>high\n</2>"
        ])
      }),
      model: "model-ref",
      messages: [{ role: "user", content: "Analyze feedback." }],
      output: slotObject({
        schema: z.object({
          summary: z.string().min(1).describe("Write one sentence."),
          priority: z
            .enum(["low", "medium", "high"])
            .describe("Write exactly one allowed priority.")
        })
      })
    });

    const response = stream.toResponse();
    const body = await response.text();

    expect(response.headers.get("content-type")).toBe(
      "text/event-stream; charset=utf-8"
    );
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(body).toContain('event: slot\ndata: {"slot":"summary"');
    expect(body).toContain('event: slot\ndata: {"slot":"priority"');
    expect(body).toContain('event: done\ndata: {"state":');
  });

  it("can stream completed slots as NDJSON", async () => {
    const stream = streamSlotObject({
      streamText: () => ({
        textStream: textChunks(["<1>mixed\n</1>"])
      }),
      model: "model-ref",
      messages: [{ role: "user", content: "Analyze feedback." }],
      output: slotObject({
        schema: z.object({
          sentiment: z
            .enum(["positive", "neutral", "negative", "mixed"])
            .describe("Write exactly one allowed sentiment.")
        })
      })
    });

    const response = stream.toResponse({ format: "ndjson" });
    const lines = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(response.headers.get("content-type")).toBe(
      "application/x-ndjson; charset=utf-8"
    );
    expect(lines).toEqual([
      {
        type: "slot",
        data: {
          slot: "sentiment",
          value: "mixed",
          state: { sentiment: "mixed" }
        }
      },
      {
        type: "done",
        data: { state: { sentiment: "mixed" } }
      }
    ]);
  });

  it("can expose low-level slot events", async () => {
    const generate: SlotGenerator = async function* (request) {
      const slot = firstSlot(request);
      yield `<${slot.id}>ok\n</${slot.id}>`;
    };

    const stream = slotObjectStreamFromGenerator(generate);
    const body = await new Response(
      stream.toReadableStream({ source: "events", format: "ndjson" })
    ).text();
    const eventTypes = body
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).type);

    expect(eventTypes).toEqual([
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
    expect(partials).not.toContainEqual({
      metadata: expect.any(String)
    });
  });

  it("can return an HTTP Response over low-level slot events", async () => {
    const generate: SlotGenerator = async function* (request) {
      const slot = firstSlot(request);
      yield `<${slot.id}>ok\n</${slot.id}>`;
    };

    const stream = slotObjectStreamFromGenerator(generate);
    const lines = (
      await stream.toResponse({ source: "events", format: "ndjson" }).text()
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(lines.map((line) => line.type)).toEqual([
      "slot-start",
      "slot-delta",
      "slot-complete",
      "done"
    ]);
  });

  it("serializes retry errors in completed SSE output", async () => {
    const generate: SlotGenerator = async function* (request) {
      const slot = firstSlot(request);
      const value = slot.attempt === 1 ? "" : "ok";
      yield `<${slot.id}>${value}\n</${slot.id}>`;
    };

    const stream = slotObjectStreamFromGenerator(generate);
    const body = await stream.toResponse().text();

    expect(body).toContain("event: slot-retry");
    expect(body).toContain('"message"');
    expect(body).toContain('event: slot\ndata: {"slot":"status","value":"ok"');
  });

  it("starts the source when the first consumer subscribes", async () => {
    let started = false;
    const source = async function* (): AsyncGenerator<SlotFlightEvent> {
      started = true;
      yield { type: "done", state: { status: "ok" } };
    };

    const stream = createSlotObjectStream<{ status: string }>(source());

    expect(started).toBe(false);

    const events = await collectEvents(stream.slotEventStream);

    expect(started).toBe(true);
    expect(events).toEqual([{ type: "done", state: { status: "ok" } }]);
  });

  it("rejects a second live view after finalObject starts consuming", async () => {
    const source = async function* (): AsyncGenerator<SlotFlightEvent> {
      yield { type: "slot-start", slot: "status", attempt: 1, state: {} };
      yield {
        type: "slot-delta",
        slot: "status",
        attempt: 1,
        delta: "ok",
        value: "ok",
        state: { status: "ok" }
      };
      yield {
        type: "slot-complete",
        slot: "status",
        attempt: 1,
        value: "ok",
        state: { status: "ok" }
      };
      yield { type: "done", state: { status: "ok" } };
    };

    const stream = createSlotObjectStream<{ status: string }>(source());

    await stream.finalObject;

    await expect(collectEvents(stream.slotEventStream)).rejects.toThrow(
      "already being consumed by finalObject"
    );

    const completedSlots: unknown[] = [];
    await expect(
      (async () => {
        for await (const slot of stream.completedSlotStream) {
          completedSlots.push(slot);
        }
      })()
    ).rejects.toThrow("already being consumed by finalObject");
    expect(completedSlots).toEqual([]);
  });

  it("rejects finalObject if a custom source completes without done", async () => {
    const source = async function* (): AsyncGenerator<SlotFlightEvent> {
      yield {
        type: "slot-complete",
        slot: "status",
        attempt: 1,
        value: "ok",
        state: { status: "ok" }
      };
    };

    const stream = createSlotObjectStream<{ status: string }>(source());

    await expect(stream.finalObject).rejects.toThrow("without a done event");
  });

  it("closes the live event subscription when a ReadableStream is cancelled", async () => {
    let reads = 0;
    let closed = false;
    let cancelled = false;
    const source: AsyncIterable<SlotFlightEvent> = {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<SlotFlightEvent>> {
            reads += 1;
            if (reads === 1) {
              return {
                done: false,
                value: {
                  type: "slot-start",
                  slot: "status",
                  attempt: 1,
                  state: {}
                }
              };
            }
            return new Promise<IteratorResult<SlotFlightEvent>>(
              () => undefined
            );
          },
          async return() {
            closed = true;
            return { done: true, value: undefined };
          }
        };
      }
    };

    const stream = createSlotObjectStream<{ status: string }>(source, {
      cancel: () => {
        cancelled = true;
      }
    });
    const reader = stream
      .toReadableStream({ source: "events", format: "ndjson" })
      .getReader();

    await expect(reader.read()).resolves.toMatchObject({ done: false });
    await reader.cancel();

    expect(cancelled).toBe(true);
    expect(closed).toBe(true);
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
