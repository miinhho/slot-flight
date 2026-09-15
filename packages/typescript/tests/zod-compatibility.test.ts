import { describe, expect, it } from "bun:test";
import * as z3 from "zod/v3";
import * as z4 from "zod/v4";
import { streamSlotObject as openAIStreamSlotObject } from "../src/adapters/openai.js";
import { streamSlotObject as vercelStreamSlotObject } from "../src/adapters/vercel.js";
import { SlotFlightConfigurationError, slotFlight } from "../src/core.js";
import { slotObject } from "../src/index.js";
import type { SchemaOutput } from "../src/schema.js";
import { collectEvents } from "./helpers.js";

const fixtures = [
  {
    version: "Zod 3",
    schema: z3.object({
      title: z3.string().min(1).optional().describe("Write a title."),
      metadata: z3
        .object({ audience: z3.string().describe("Write the audience.") })
        .nullable()
        .describe("Write metadata."),
      tags: z3
        .array(z3.string().min(1))
        .length(2)
        .default([])
        .describe("Write 2 tags."),
      sections: z3
        .array(z3.object({ heading: z3.string() }).readonly())
        .describe("Write sections.")
    }),
    invalid: [
      z3.object({
        value: z3.record(z3.string(), z3.string()).describe("Write values.")
      }),
      z3.object({
        value: z3.map(z3.string(), z3.string()).describe("Write values.")
      }),
      z3.object({
        value: z3.array(z3.array(z3.string())).describe("Write values.")
      })
    ],
    transformed: z3
      .object({ title: z3.string() })
      .transform((value) => value.title.length),
    title: z3.string()
  },
  {
    version: "Zod 4",
    schema: z4.object({
      title: z4.string().min(1).optional().describe("Write a title."),
      metadata: z4
        .object({ audience: z4.string().describe("Write the audience.") })
        .nullable()
        .describe("Write metadata."),
      tags: z4
        .array(z4.string().min(1))
        .length(2)
        .default([])
        .describe("Write 2 tags."),
      sections: z4
        .array(z4.object({ heading: z4.string() }).readonly())
        .describe("Write sections.")
    }),
    invalid: [
      z4.object({
        value: z4.record(z4.string(), z4.string()).describe("Write values.")
      }),
      z4.object({
        value: z4.map(z4.string(), z4.string()).describe("Write values.")
      }),
      z4.object({
        value: z4.array(z4.array(z4.string())).describe("Write values.")
      })
    ],
    transformed: z4
      .object({ title: z4.string() })
      .transform((value) => value.title.length),
    title: z4.string()
  }
] as const;

for (const { version, schema, invalid, transformed, title } of fixtures) {
  describe(`${version} compatibility`, () => {
    it("infers nested and repeatable slots through wrappers", () => {
      const output = slotObject({ schema });
      expect(output.schema).toBe(schema);
      expect(
        output.slots.map(({ path, prompt }) => ({ path, prompt }))
      ).toEqual([
        { path: "title", prompt: "Write a title." },
        {
          path: "metadata.audience",
          prompt: "Write metadata.\nWrite the audience."
        },
        { path: "tags[]", prompt: "Write 2 tags." },
        { path: "sections[].heading", prompt: "Write sections." }
      ]);
      expect(output.slots[0]?.schema.safeParse(undefined).success).toBe(true);
      expect(output.slots[2]?.schema.safeParse("").success).toBe(false);
    });

    it("retries leaf and final array validation failures independently", async () => {
      const requests: string[][] = [];
      const events = await collectEvents(
        slotFlight({
          ...slotObject({ schema }),
          generate: async function* (request) {
            requests.push(request.slots.map((slot) => slot.path));
            for (const slot of request.slots) {
              if (slot.path === "tags[]") {
                const values = slot.attempt === 1 ? ["one"] : ["one", "two"];
                for (const [index, value] of values.entries()) {
                  yield `<${slot.id}:${index}>\n${value}\n</${slot.id}:${index}>\n`;
                }
              } else if (slot.path === "sections[].heading") {
                yield `<${slot.id}:0>\nIntro\n</${slot.id}:0>\n`;
              } else {
                const value =
                  slot.path === "title" && slot.attempt === 1 ? "" : "valid";
                yield `<${slot.id}>\n${value}\n</${slot.id}>\n`;
              }
            }
          }
        }).run()
      );
      expect(requests).toEqual([
        ["title", "metadata.audience", "tags[]", "sections[].heading"],
        ["title"],
        ["tags[]"]
      ]);
      expect(events.at(-1)).toEqual({
        type: "done",
        state: {
          title: "valid",
          metadata: { audience: "valid" },
          tags: ["one", "two"],
          sections: [{ heading: "Intro" }]
        }
      });
    });

    it("rejects dynamic structures and nested arrays", () => {
      for (const schema of invalid) {
        expect(() => slotObject({ schema })).toThrow(
          SlotFlightConfigurationError
        );
      }
    });

    it("preserves transformed output types in the engine and adapters", async () => {
      const output = {
        schema: transformed,
        slots: [{ path: "title", schema: title }]
      };
      const engine = slotFlight({
        ...output,
        generate: async function* () {
          yield "<1>\nabc\n</1>\n";
        }
      });
      const openAI = openAIStreamSlotObject({
        client: { chat: { completions: { create: () => [] } } },
        model: "test",
        output
      });
      const vercel = vercelStreamSlotObject({
        streamText: () => ({ textStream: [] }),
        output
      });
      // An unknown or any output must fail these assertions, not merely remain
      // assignable to the expected result.
      type Equal<A, B> =
        (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
          ? true
          : false;
      type GeneratorResult<T> =
        T extends AsyncGenerator<unknown, infer R> ? R : never;
      const engineType: Equal<
        GeneratorResult<ReturnType<typeof engine.run>>["state"],
        number
      > = true;
      const outputType: Equal<SchemaOutput<typeof transformed>, number> = true;
      const openAIType: Equal<
        Awaited<typeof openAI.finalObject>,
        number
      > = true;
      const vercelType: Equal<
        Awaited<typeof vercel.finalObject>,
        number
      > = true;
      expect([engineType, outputType, openAIType, vercelType]).toEqual([
        true,
        true,
        true,
        true
      ]);
      const iterator = engine.run();
      let result = await iterator.next();
      while (!result.done) result = await iterator.next();
      const state: number = result.value.state;
      expect(state).toBe(3);
    });
  });
}

it("infers Zod 4 prefault and nonoptional structural wrappers", () => {
  const output = slotObject({
    schema: z4.object({
      metadata: z4
        .object({ title: z4.string() })
        .prefault({ title: "default" })
        .describe("Write metadata."),
      sections: z4
        .array(z4.object({ heading: z4.string() }).optional().nonoptional())
        .describe("Write sections.")
    })
  });
  expect(output.slots.map((slot) => slot.path)).toEqual([
    "metadata.title",
    "sections[].heading"
  ]);
});
