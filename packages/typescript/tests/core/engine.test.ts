import { describe, expect, it } from "bun:test";
import { z } from "zod";
import type { SlotGenerator } from "../../src/core.js";
import {
  SlotFlightConfigurationError,
  SlotFlightJsonParseError,
  SlotFlightSlotProtocolError,
  slotFlight
} from "../../src/core.js";
import { collectEvents, firstSlot } from "../helpers.js";

const articleSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  tags: z.array(z.string().min(1)).length(2),
  metadata: z.object({
    audience: z.string()
  })
});

describe("SlotFlight", () => {
  it("assembles server-owned JSON from one multi-slot frame stream", async () => {
    const generate: SlotGenerator = async function* (request) {
      const valueByPath: Record<string, string> = {
        title: "Slot-wise JSON",
        summary: "Generate values, not documents.",
        "tags[0]": "llm",
        "tags[1]": "json",
        "metadata.audience": "backend engineers"
      };

      for (const slot of request.slots) {
        const value = valueByPath[slot.path];
        if (value === undefined) {
          throw new Error(`Missing fixture value for slot "${slot.path}".`);
        }
        yield `<${slot.id}>\n`;
        yield value.slice(0, 4);
        yield value.slice(4);
        yield `\n</${slot.id}>\n`;
      }
    };

    const events = await collectEvents(
      slotFlight({
        schema: articleSchema,
        generate,
        slots: [
          { path: "title", schema: z.string() },
          { path: "summary", schema: z.string() },
          { path: "tags[]", count: 2, schema: z.string() },
          {
            path: "metadata.audience",
            schema: z.string()
          }
        ]
      }).run()
    );

    const done = events.at(-1);
    expect(done).toMatchObject({
      type: "done",
      state: {
        title: "Slot-wise JSON",
        summary: "Generate values, not documents.",
        tags: ["llm", "json"],
        metadata: { audience: "backend engineers" }
      }
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "slot-delta",
        slot: "tags[1]",
        value: "json",
        state: expect.objectContaining({
          tags: ["llm", "json"]
        })
      })
    );
  });

  it("retries only failed slots after Zod validation fails", async () => {
    const requests: string[][] = [];
    const generate: SlotGenerator = async function* (request) {
      requests.push(
        request.slots.map((slot) => `${slot.path}:${slot.attempt}`)
      );

      for (const slot of request.slots) {
        const value =
          slot.path === "title" && slot.attempt === 1 ? "" : "valid";
        yield `<${slot.id}>\n${value}\n</${slot.id}>\n`;
      }
    };

    const events = await collectEvents(
      slotFlight({
        schema: z.object({
          title: z.string().min(1),
          summary: z.string().min(1)
        }),
        generate,
        slots: [
          { path: "title", schema: z.string().min(1) },
          { path: "summary", schema: z.string().min(1) }
        ],
        maxRetries: 1
      }).run()
    );

    expect(requests).toEqual([["title:1", "summary:1"], ["title:2"]]);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "slot-retry", slot: "title", attempt: 1 })
    );
  });

  it("assembles a whole array from one JSON slot", async () => {
    const generate: SlotGenerator = async function* (request) {
      expect(request.slots).toEqual([
        expect.objectContaining({
          path: "tags",
          mode: "json"
        })
      ]);
      const slot = firstSlot(request);
      yield `<${slot.id}>["billing","latency","dashboard"]</${slot.id}>`;
    };

    const events = await collectEvents(
      slotFlight({
        schema: z.object({
          tags: z.array(z.string().min(1)).length(3)
        }),
        generate,
        slots: [
          {
            path: "tags",
            schema: z.array(z.string().min(1)).length(3),
            mode: "json"
          }
        ]
      }).run()
    );

    expect(events.at(-1)).toMatchObject({
      type: "done",
      state: {
        tags: ["billing", "latency", "dashboard"]
      }
    });
  });

  it("retries only a JSON slot when its body is invalid JSON", async () => {
    const requests: string[][] = [];
    const generate: SlotGenerator = async function* (request) {
      requests.push(
        request.slots.map((slot) => `${slot.path}:${slot.attempt}`)
      );

      for (const slot of request.slots) {
        const value =
          slot.path === "tags" && slot.attempt === 1
            ? '["billing",'
            : '["billing","latency"]';
        yield `<${slot.id}>${value}</${slot.id}>`;
      }
    };

    const events = await collectEvents(
      slotFlight({
        schema: z.object({
          tags: z.array(z.string().min(1)).length(2),
          summary: z.string().min(1)
        }),
        generate,
        slots: [
          {
            path: "tags",
            schema: z.array(z.string().min(1)).length(2),
            mode: "json"
          },
          { path: "summary", schema: z.string().min(1) }
        ],
        maxRetries: 1
      }).run()
    );

    expect(requests).toEqual([["tags:1", "summary:1"], ["tags:2"]]);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "slot-retry", slot: "tags", attempt: 1 })
    );
    expect(
      events.find(
        (event) => event.type === "slot-retry" && event.slot === "tags"
      )
    ).toMatchObject({
      error: expect.any(SlotFlightJsonParseError)
    });
  });

  it("rejects duplicate concrete slot paths before generation", () => {
    const generate: SlotGenerator = async function* () {
      yield "";
    };

    expect(() =>
      slotFlight({
        schema: z.object({ title: z.string() }),
        generate,
        slots: [
          { path: "title", schema: z.string() },
          { path: "title", schema: z.string() }
        ]
      })
    ).toThrow(SlotFlightConfigurationError);
  });

  it("retries only slots missing from a completed frame stream", async () => {
    const requests: string[][] = [];
    const generate: SlotGenerator = async function* (request) {
      requests.push(
        request.slots.map((slot) => `${slot.path}:${slot.attempt}`)
      );

      for (const slot of request.slots) {
        if (slot.path === "summary" && slot.attempt === 1) {
          continue;
        }
        yield `<${slot.id}>${slot.path} value</${slot.id}>`;
      }
    };

    const events = await collectEvents(
      slotFlight({
        schema: z.object({
          title: z.string().min(1),
          summary: z.string().min(1)
        }),
        generate,
        slots: [
          { path: "title", schema: z.string().min(1) },
          { path: "summary", schema: z.string().min(1) }
        ],
        maxRetries: 1
      }).run()
    );

    expect(requests).toEqual([["title:1", "summary:1"], ["summary:2"]]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "slot-retry",
        slot: "summary",
        attempt: 1
      })
    );
    expect(
      events.find(
        (event) => event.type === "slot-retry" && event.slot === "summary"
      )
    ).toMatchObject({
      error: expect.any(SlotFlightSlotProtocolError)
    });
    expect(events.at(-1)).toMatchObject({
      type: "done",
      state: {
        title: "title value",
        summary: "summary value"
      }
    });
  });

  it("rejects an unregistered slot frame", async () => {
    let calls = 0;
    const generate: SlotGenerator = async function* (_request) {
      calls += 1;
      yield "<2>\nvalue\n</2>";
    };

    await expect(
      collectEvents(
        slotFlight({
          schema: z.object({ title: z.string() }),
          generate,
          maxRetries: 1,
          slots: [{ path: "title", schema: z.string() }]
        }).run()
      )
    ).rejects.toThrow('Received unregistered slot id "2"');
    expect(calls).toBe(1);
  });

  it("rejects a duplicate slot frame", async () => {
    let calls = 0;
    const generate: SlotGenerator = async function* (request) {
      calls += 1;
      const slot = firstSlot(request);
      yield `<${slot.id}>\nfirst\n</${slot.id}>\n<${slot.id}>\nsecond\n</${slot.id}>`;
    };

    await expect(
      collectEvents(
        slotFlight({
          schema: z.object({ title: z.string() }),
          generate,
          maxRetries: 1,
          slots: [{ path: "title", schema: z.string() }]
        }).run()
      )
    ).rejects.toThrow('Received duplicate slot "title"');
    expect(calls).toBe(1);
  });

  it("does not retry provider stream failures as slot failures", async () => {
    let calls = 0;
    const generate: SlotGenerator = () => ({
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          calls += 1;
          throw new Error("provider disconnected");
        }
      })
    });

    await expect(
      collectEvents(
        slotFlight({
          schema: z.object({ title: z.string() }),
          generate,
          maxRetries: 2,
          slots: [{ path: "title", schema: z.string() }]
        }).run()
      )
    ).rejects.toThrow("provider disconnected");
    expect(calls).toBe(1);
  });

  it("retries retryable slot protocol failures without retrying completed slots", async () => {
    const requests: string[][] = [];
    const generate: SlotGenerator = async function* (request) {
      requests.push(
        request.slots.map((slot) => `${slot.path}:${slot.attempt}`)
      );

      for (const slot of request.slots) {
        if (slot.path === "summary" && slot.attempt === 1) {
          yield `<${slot.id}>unfinished`;
          continue;
        }
        yield `<${slot.id}>${slot.path} ok</${slot.id}>`;
      }
    };

    const events = await collectEvents(
      slotFlight({
        schema: z.object({
          title: z.string().min(1),
          summary: z.string().min(1)
        }),
        generate,
        maxRetries: 1,
        slots: [
          { path: "title", schema: z.string().min(1) },
          { path: "summary", schema: z.string().min(1) }
        ]
      }).run()
    );

    expect(requests).toEqual([["title:1", "summary:1"], ["summary:2"]]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "slot-retry",
        slot: "summary",
        attempt: 1
      })
    );
    expect(events.at(-1)).toMatchObject({
      type: "done",
      state: {
        title: "title ok",
        summary: "summary ok"
      }
    });
  });

  it("cancels an in-flight frame stream", async () => {
    const controller = new AbortController();
    const generate: SlotGenerator = async function* (request) {
      const slot = firstSlot(request);
      yield `<${slot.id}>\npart`;
      controller.abort(new Error("user cancelled"));
      yield " after abort";
    };

    await expect(
      collectEvents(
        slotFlight({
          schema: z.object({ title: z.string() }),
          generate,
          slots: [{ path: "title", schema: z.string() }]
        }).run({ signal: controller.signal })
      )
    ).rejects.toThrow("user cancelled");
  });

  it("closes the underlying stream when a frame stream is aborted", async () => {
    const controller = new AbortController();
    let cleanedUp = false;
    const generate: SlotGenerator = async function* (request) {
      const slot = firstSlot(request);
      try {
        yield `<${slot.id}>\n`;
        controller.abort(new Error("stop"));
        yield "ignored";
      } finally {
        cleanedUp = true;
      }
    };

    await expect(
      collectEvents(
        slotFlight({
          schema: z.object({ title: z.string() }),
          generate,
          slots: [{ path: "title", schema: z.string() }]
        }).run({ signal: controller.signal })
      )
    ).rejects.toThrow("stop");
    expect(cleanedUp).toBe(true);
  });
});
