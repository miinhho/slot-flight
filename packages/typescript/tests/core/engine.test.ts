import { describe, expect, it } from "bun:test";
import { z } from "zod";
import type { SlotGenerator } from "../../src/core.js";
import {
  SlotFlightConfigurationError,
  SlotFlightSlotProtocolError,
  SlotFlightValidationError,
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

  it("appends an unknown-length array from repeated slot frames", async () => {
    const generate: SlotGenerator = async function* (request) {
      expect(request.slots).toEqual([
        expect.objectContaining({
          path: "tags[]",
          repeat: "append"
        })
      ]);
      const slot = firstSlot(request);
      yield `<${slot.id}:0>billing\n</${slot.id}:0>`;
      yield `<${slot.id}:1>latency\n</${slot.id}:1>`;
      yield `<${slot.id}:2>dashboard\n</${slot.id}:2>`;
    };

    const events = await collectEvents(
      slotFlight({
        schema: z.object({
          tags: z.array(z.string().min(1)).length(3)
        }),
        generate,
        slots: [
          {
            path: "tags[]",
            schema: z.string().min(1)
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

  it("retries a repeatable field as a full sequence and clears stale items", async () => {
    const requests: string[][] = [];
    const generate: SlotGenerator = async function* (request) {
      requests.push(
        request.slots.map((slot) => `${slot.path}:${slot.attempt}`)
      );
      const slot = firstSlot(request);
      if (slot.attempt === 1) {
        yield `<${slot.id}:0>old-first\n</${slot.id}:0>`;
        yield `<${slot.id}:1>\n</${slot.id}:1>`;
        yield `<${slot.id}:2>stale-third\n</${slot.id}:2>`;
        return;
      }
      yield `<${slot.id}:0>new-first\n</${slot.id}:0>`;
      yield `<${slot.id}:1>new-second\n</${slot.id}:1>`;
    };

    const events = await collectEvents(
      slotFlight({
        schema: z.object({
          tags: z.array(z.string().min(1)).length(2)
        }),
        generate,
        slots: [
          {
            path: "tags[]",
            schema: z.string().min(1)
          }
        ],
        maxRetries: 1
      }).run()
    );

    expect(requests).toEqual([["tags[]:1"], ["tags[]:2"]]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "slot-retry",
        slot: "tags[]",
        error: expect.any(SlotFlightValidationError)
      })
    );
    expect(events.at(-1)).toMatchObject({
      type: "done",
      state: {
        tags: ["new-first", "new-second"]
      }
    });
  });

  it("retries a repeatable field when final array validation fails", async () => {
    const requests: string[][] = [];
    const generate: SlotGenerator = async function* (request) {
      requests.push(
        request.slots.map((slot) => `${slot.path}:${slot.attempt}`)
      );
      const slot = firstSlot(request);
      yield `<${slot.id}:0>first\n</${slot.id}:0>`;
      if (slot.attempt === 2) {
        yield `<${slot.id}:1>second\n</${slot.id}:1>`;
      }
    };

    const events = await collectEvents(
      slotFlight({
        schema: z.object({
          tags: z.array(z.string().min(1)).length(2)
        }),
        generate,
        slots: [
          {
            path: "tags[]",
            schema: z.string().min(1)
          }
        ],
        maxRetries: 1
      }).run()
    );

    expect(requests).toEqual([["tags[]:1"], ["tags[]:2"]]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "slot-retry",
        slot: "tags[]"
      })
    );
    expect(events.at(-1)).toMatchObject({
      type: "done",
      state: { tags: ["first", "second"] }
    });
  });

  it("streams object array fields without JSON blob slots", async () => {
    const generate: SlotGenerator = async function* (request) {
      expect(request.slots).toEqual([
        expect.objectContaining({
          path: "sections[].heading",
          repeat: "item-field"
        }),
        expect.objectContaining({
          path: "sections[].body",
          repeat: "item-field"
        })
      ]);

      const [heading, body] = request.slots;
      yield `<${heading?.id}:0>Intro\n</${heading?.id}:0>`;
      yield `<${heading?.id}:1>Details\n</${heading?.id}:1>`;
      yield `<${body?.id}:0>Opening paragraph\n</${body?.id}:0>`;
      yield `<${body?.id}:1>More detail\n</${body?.id}:1>`;
    };

    const events = await collectEvents(
      slotFlight({
        schema: z.object({
          sections: z
            .array(
              z.object({
                heading: z.string().min(1),
                body: z.string().min(1)
              })
            )
            .length(2)
        }),
        generate,
        slots: [
          {
            path: "sections[].heading",
            schema: z.string().min(1)
          },
          {
            path: "sections[].body",
            schema: z.string().min(1)
          }
        ]
      }).run()
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "slot-delta",
        slot: "sections[1].body",
        state: {
          sections: [
            { heading: "Intro", body: "Opening paragraph" },
            { heading: "Details", body: "More detail" }
          ]
        }
      })
    );
    expect(events.at(-1)).toMatchObject({
      type: "done",
      state: {
        sections: [
          { heading: "Intro", body: "Opening paragraph" },
          { heading: "Details", body: "More detail" }
        ]
      }
    });
  });

  it("retries only the failed object-array field sequence", async () => {
    const requests: string[][] = [];
    const generate: SlotGenerator = async function* (request) {
      requests.push(
        request.slots.map((slot) => `${slot.path}:${slot.attempt}`)
      );

      const heading = request.slots.find(
        (slot) => slot.path === "sections[].heading"
      );
      const body = request.slots.find(
        (slot) => slot.path === "sections[].body"
      );

      if (heading !== undefined && body !== undefined && body.attempt === 1) {
        yield `<${body.id}:0>Old opening\n</${body.id}:0>`;
        yield `<${heading.id}:0>Intro\n</${heading.id}:0>`;
        yield `<${heading.id}:1>Details\n</${heading.id}:1>`;
        yield `<${body.id}:1>\n</${body.id}:1>`;
      }
      if (body !== undefined && body.attempt === 2) {
        yield `<${body.id}:0>New opening\n</${body.id}:0>`;
        yield `<${body.id}:1>New detail\n</${body.id}:1>`;
      }
    };

    const events = await collectEvents(
      slotFlight({
        schema: z.object({
          sections: z
            .array(
              z.object({
                heading: z.string().min(1),
                body: z.string().min(1)
              })
            )
            .length(2)
        }),
        generate,
        maxRetries: 1,
        slots: [
          {
            path: "sections[].heading",
            schema: z.string().min(1)
          },
          {
            path: "sections[].body",
            schema: z.string().min(1)
          }
        ]
      }).run()
    );

    expect(requests).toEqual([
      ["sections[].heading:1", "sections[].body:1"],
      ["sections[].body:2"]
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "done",
      state: {
        sections: [
          { heading: "Intro", body: "New opening" },
          { heading: "Details", body: "New detail" }
        ]
      }
    });
  });

  it("retries a missing object-array field from final validation", async () => {
    const requests: string[][] = [];
    const generate: SlotGenerator = async function* (request) {
      requests.push(
        request.slots.map((slot) => `${slot.path}:${slot.attempt}`)
      );
      const heading = request.slots.find(
        (slot) => slot.path === "sections[].heading"
      );
      const body = request.slots.find(
        (slot) => slot.path === "sections[].body"
      );

      if (heading !== undefined) {
        yield `<${heading.id}:0>Intro\n</${heading.id}:0>`;
        yield `<${heading.id}:1>Details\n</${heading.id}:1>`;
      }
      if (body !== undefined) {
        yield `<${body.id}:0>Opening\n</${body.id}:0>`;
        if (body.attempt === 2) {
          yield `<${body.id}:1>More detail\n</${body.id}:1>`;
        }
      }
    };

    const events = await collectEvents(
      slotFlight({
        schema: z.object({
          sections: z
            .array(
              z.object({
                heading: z.string().min(1),
                body: z.string().min(1)
              })
            )
            .length(2)
        }),
        generate,
        maxRetries: 1,
        slots: [
          {
            path: "sections[].heading",
            schema: z.string().min(1)
          },
          {
            path: "sections[].body",
            schema: z.string().min(1)
          }
        ]
      }).run()
    );

    expect(requests).toEqual([
      ["sections[].heading:1", "sections[].body:1"],
      ["sections[].body:2"]
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "done",
      state: {
        sections: [
          { heading: "Intro", body: "Opening" },
          { heading: "Details", body: "More detail" }
        ]
      }
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
        yield `<${slot.id}>${slot.path} value\n</${slot.id}>`;
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
        yield `<${slot.id}>${slot.path} ok\n</${slot.id}>`;
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
