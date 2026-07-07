import { describe, expect, it } from "bun:test";
import { createSlotObjectStream } from "../../../src/slot/index.js";
import type { SlotFlightEvent } from "../../../src/types.js";
import { collectEvents } from "../../helpers.js";

describe("SlotObjectStream lifecycle", () => {
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

  it("does not pull readable stream events before the reader asks", async () => {
    let reads = 0;
    let closed = false;

    const source = async function* (): AsyncGenerator<SlotFlightEvent> {
      try {
        reads += 1;
        yield { type: "done", state: { status: "ok" } };
      } finally {
        closed = true;
      }
    };

    const stream = createSlotObjectStream<{ status: string }>(source());
    const readable = stream.toReadableStream({ source: "events" });

    await Promise.resolve();
    expect(reads).toBe(0);

    const reader = readable.getReader();
    await Promise.resolve();
    expect(reads).toBe(0);

    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(reads).toBe(1);

    await reader.cancel();
    expect(closed).toBe(true);
  });

  it("rejects finalObject when a readable stream is cancelled before reading", async () => {
    let started = false;
    const source = async function* (): AsyncGenerator<SlotFlightEvent> {
      started = true;
      yield { type: "done", state: { status: "ok" } };
    };

    const stream = createSlotObjectStream<{ status: string }>(source());
    const readable = stream.toReadableStream({ source: "events" });

    await readable.cancel();

    expect(started).toBe(false);
    await expect(stream.finalObject).rejects.toThrow("Stream cancelled");
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
