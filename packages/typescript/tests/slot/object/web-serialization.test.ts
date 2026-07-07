import { describe, expect, it } from "bun:test";
import { z } from "zod";
import type { SlotGenerator } from "../../../src/core.js";
import { slotFlight } from "../../../src/core.js";
import { createSlotObjectStream } from "../../../src/slot/index.js";
import type { SlotFlightEvent } from "../../../src/types.js";

describe("SlotObjectStream web serialization", () => {
  it("returns an SSE Response for completed slots by default", async () => {
    const stream = createSlotObjectStream(
      slotFlight({
        schema: z.object({
          summary: z.string().min(1),
          priority: z.enum(["low", "medium", "high"])
        }),
        generate: async function* (request) {
          const [summary, priority] = request.slots;
          yield `<${summary?.id}>Delayed first field.\n</${summary?.id}>`;
          yield `<${priority?.id}>high\n</${priority?.id}>`;
        },
        slots: [
          { path: "summary", schema: z.string().min(1) },
          { path: "priority", schema: z.enum(["low", "medium", "high"]) }
        ]
      }).run()
    );

    const response = stream.toResponse();
    const events = parseSse(await response.text());

    expect(response.headers.get("content-type")).toBe(
      "text/event-stream; charset=utf-8"
    );
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(events).toEqual([
      {
        event: "slot",
        data: {
          slot: "summary",
          value: "Delayed first field.",
          state: { summary: "Delayed first field." }
        }
      },
      {
        event: "slot",
        data: {
          slot: "priority",
          value: "high",
          state: {
            summary: "Delayed first field.",
            priority: "high"
          }
        }
      },
      {
        event: "done",
        data: {
          state: {
            summary: "Delayed first field.",
            priority: "high"
          }
        }
      }
    ]);
  });

  it("streams completed slots as NDJSON", async () => {
    const stream = slotObjectStreamFromGenerator(async function* (request) {
      const slot = request.slots[0];
      yield `<${slot?.id}>mixed\n</${slot?.id}>`;
    });

    const response = stream.toResponse({ format: "ndjson" });
    const lines = parseNdjson(await response.text());

    expect(response.headers.get("content-type")).toBe(
      "application/x-ndjson; charset=utf-8"
    );
    expect(lines).toEqual([
      {
        type: "slot",
        data: {
          slot: "status",
          value: "mixed",
          state: { status: "mixed" }
        }
      },
      {
        type: "done",
        data: { state: { status: "mixed" } }
      }
    ]);
  });

  it("serializes low-level slot events as NDJSON", async () => {
    const stream = slotObjectStreamFromGenerator(async function* (request) {
      const slot = request.slots[0];
      yield `<${slot?.id}>ok\n</${slot?.id}>`;
    });

    const lines = parseNdjson(
      await new Response(
        stream.toReadableStream({ source: "events", format: "ndjson" })
      ).text()
    );

    expect(lines.map((line) => line.type)).toEqual([
      "slot-start",
      "slot-delta",
      "slot-complete",
      "done"
    ]);
    expect(lines[2]).toMatchObject({
      type: "slot-complete",
      data: {
        slot: "status",
        value: "ok",
        state: { status: "ok" }
      }
    });
  });

  it("returns an HTTP Response over low-level slot events", async () => {
    const stream = slotObjectStreamFromGenerator(async function* (request) {
      const slot = request.slots[0];
      yield `<${slot?.id}>ok\n</${slot?.id}>`;
    });

    const lines = parseNdjson(
      await stream.toResponse({ source: "events", format: "ndjson" }).text()
    );

    expect(lines.map((line) => line.type)).toEqual([
      "slot-start",
      "slot-delta",
      "slot-complete",
      "done"
    ]);
  });

  it("serializes partial object stream as NDJSON", async () => {
    const source = async function* (): AsyncGenerator<SlotFlightEvent> {
      yield {
        type: "slot-delta",
        slot: "status",
        attempt: 1,
        delta: "o",
        value: "o",
        state: { status: "o" }
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

    const lines = parseNdjson(
      await stream.toResponse({ source: "partial", format: "ndjson" }).text()
    );

    expect(lines).toEqual([
      { type: "partial", data: { status: "o" } },
      { type: "partial", data: { status: "ok" } },
      { type: "partial", data: { status: "ok" } }
    ]);
  });

  it("serializes retry errors in completed SSE output", async () => {
    const stream = slotObjectStreamFromGenerator(async function* (request) {
      const slot = request.slots[0];
      const value = slot?.attempt === 1 ? "" : "ok";
      yield `<${slot?.id}>${value}\n</${slot?.id}>`;
    });

    const events = parseSse(await stream.toResponse().text());

    expect(events.map((event) => event.event)).toEqual([
      "slot-retry",
      "slot",
      "done"
    ]);
    expect(events[0]).toMatchObject({
      event: "slot-retry",
      data: {
        error: {
          message: expect.any(String)
        }
      }
    });
    expect(events[1]).toMatchObject({
      event: "slot",
      data: {
        slot: "status",
        value: "ok",
        state: { status: "ok" }
      }
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

function parseNdjson(body: string): Array<{ type: string; data: unknown }> {
  return body
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function parseSse(body: string): Array<{ event: string; data: unknown }> {
  return body
    .trim()
    .split("\n\n")
    .filter(Boolean)
    .map((chunk) => {
      const eventLine = chunk
        .split("\n")
        .find((line) => line.startsWith("event: "));
      const dataLine = chunk
        .split("\n")
        .find((line) => line.startsWith("data: "));

      if (eventLine === undefined || dataLine === undefined) {
        throw new Error(`Invalid SSE chunk: ${chunk}`);
      }

      return {
        event: eventLine.slice("event: ".length),
        data: JSON.parse(dataLine.slice("data: ".length))
      };
    });
}
