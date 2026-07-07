import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { SlotFlightConfigurationError } from "../../../src/core.js";
import { slotObject } from "../../../src/index.js";

describe("slotObject definitions", () => {
  it("infers slots from described Zod fields", () => {
    const output = slotObject({
      schema: z.object({
        title: z.string().describe("Write a title."),
        metadata: z.object({
          audience: z.string().min(1).describe("Write the intended audience.")
        })
      })
    });

    expect(output.slots).toEqual([
      expect.objectContaining({
        path: "title",
        prompt: "Write a title."
      }),
      expect.objectContaining({
        path: "metadata.audience",
        prompt: "Write the intended audience."
      })
    ]);
    expect(output.slots[1]?.schema.safeParse("")).toMatchObject({
      success: false
    });
  });

  it("expands described array and object fields into structural slots", () => {
    const output = slotObject({
      schema: z.object({
        tags: z
          .array(z.string().min(1))
          .length(3)
          .describe("Write exactly 3 tags."),
        metadata: z
          .object({
            audience: z.string(),
            priority: z.enum(["low", "high"])
          })
          .describe("Write the metadata object.")
      })
    });

    expect(output.slots).toEqual([
      expect.objectContaining({
        path: "tags[]",
        prompt: "Write exactly 3 tags."
      }),
      expect.objectContaining({
        path: "metadata.audience",
        prompt: "Write the metadata object."
      }),
      expect.objectContaining({
        path: "metadata.priority",
        prompt: "Write the metadata object."
      })
    ]);
  });

  it("follows common Zod wrappers when inferring structural slots", () => {
    const output = slotObject({
      schema: z.object({
        title: z.string().min(1).optional().describe("Write a title."),
        metadata: z
          .object({
            audience: z.string().describe("Write the audience.")
          })
          .nullable()
          .describe("Write metadata."),
        tags: z.array(z.string().min(1)).default([]).describe("Write tags.")
      })
    });

    expect(output.slots).toEqual([
      expect.objectContaining({
        path: "title",
        prompt: "Write a title."
      }),
      expect.objectContaining({
        path: "metadata.audience",
        prompt: "Write metadata.\nWrite the audience."
      }),
      expect.objectContaining({
        path: "tags[]",
        prompt: "Write tags."
      })
    ]);
    expect(output.slots[0]?.schema.safeParse(undefined)).toMatchObject({
      success: true
    });
    expect(output.slots[2]?.schema.safeParse("")).toMatchObject({
      success: false
    });
  });

  it("rejects fields that are not described", () => {
    expect(() =>
      slotObject({
        schema: z.object({
          title: z.string()
        })
      })
    ).toThrow(SlotFlightConfigurationError);
  });

  it("rejects dynamic object fields", () => {
    expect(() =>
      slotObject({
        schema: z.object({
          payload: z
            .record(z.string(), z.string())
            .describe("Write payload fields.")
        })
      })
    ).toThrow(SlotFlightConfigurationError);
  });

  it("rejects nested arrays and dynamic array items", () => {
    expect(() =>
      slotObject({
        schema: z.object({
          matrix: z.array(z.array(z.string())).describe("Write matrix rows.")
        })
      })
    ).toThrow(SlotFlightConfigurationError);

    expect(() =>
      slotObject({
        schema: z.object({
          payloads: z
            .array(z.record(z.string(), z.string()))
            .describe("Write payloads.")
        })
      })
    ).toThrow(SlotFlightConfigurationError);
  });
});
